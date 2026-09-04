import { create } from 'zustand'
import {
  DEFAULT_SETTINGS,
  type Catalog,
  type LayoutMode,
  type ScanProgress,
  type SessionSpec,
  type Settings,
  type ShellDef
} from '@shared/types'

export interface Session {
  id: string
  cwd: string
  title: string
  shellId: string
  shellLabel: string
  pid: number
  status: 'running' | 'exited'
  exitCode?: number
  /** Set on every chunk of output; drives the "needs you" badge. */
  lastDataAt: number
  busy: boolean
  attention: boolean
  unseen: boolean
}

export type SidebarTab = 'chats' | 'skills' | 'projects'

interface State {
  ready: boolean
  shells: ShellDef[]
  settings: Settings
  sessions: Session[]
  activeId: string | null
  layout: LayoutMode

  sidebarOpen: boolean
  sidebarTab: SidebarTab
  sidebarWidth: number
  paletteOpen: boolean
  settingsOpen: boolean
  broadcast: boolean

  catalog: Catalog | null
  catalogLoading: boolean
  scanProgress: ScanProgress | null

  toast: string | null
}

interface Actions {
  boot: () => Promise<void>
  openSession: (spec: SessionSpec) => Promise<string | null>
  closeSession: (id: string) => void
  setActive: (id: string) => void
  cycle: (dir: 1 | -1) => void
  jumpTo: (index: number) => void
  renameSession: (id: string, title: string) => void
  setLayout: (m: LayoutMode) => void
  markData: (id: string) => void
  markExit: (id: string, code: number) => void
  patchSession: (id: string, patch: Partial<Session>) => void
  sweepAttention: () => void

  setSettings: (patch: Partial<Settings>) => Promise<void>
  setSidebar: (open: boolean, tab?: SidebarTab) => void
  setSidebarWidth: (w: number) => void
  setPalette: (open: boolean) => void
  setSettingsOpen: (open: boolean) => void
  toggleBroadcast: () => void

  loadCatalog: (force?: boolean) => Promise<void>
  notify: (msg: string) => void
  persist: () => void
}

let persistTimer: ReturnType<typeof setTimeout> | null = null

export const useStore = create<State & Actions>((set, get) => ({
  ready: false,
  shells: [],
  settings: DEFAULT_SETTINGS,
  sessions: [],
  activeId: null,
  layout: 'tabs',

  sidebarOpen: false,
  sidebarTab: 'chats',
  sidebarWidth: 380,
  paletteOpen: false,
  settingsOpen: false,
  broadcast: false,

  catalog: null,
  catalogLoading: false,
  scanProgress: null,

  toast: null,

  async boot() {
    const [shells, settings, workspace] = await Promise.all([
      window.buddy.shells.list(),
      window.buddy.settings.get(),
      window.buddy.workspace.get()
    ])

    // A saved default shell that no longer exists would strand every new tab.
    const defaultShellId = shells.some((s) => s.id === settings.defaultShellId)
      ? settings.defaultShellId
      : shells[0]?.id

    set({
      shells,
      settings: { ...settings, defaultShellId },
      layout: workspace.layout ?? settings.layout,
      ready: true
    })

    if (settings.restoreOnLaunch && workspace.sessions.length) {
      for (const s of workspace.sessions) {
        await get().openSession({ cwd: s.cwd, shellId: s.shellId, title: s.title })
      }
    }
    if (get().sessions.length === 0) {
      const paths = await window.buddy.app.paths()
      await get().openSession({ cwd: paths.home })
    }
    void get().loadCatalog()
  },

  async openSession(spec) {
    const { settings, sessions } = get()
    if (sessions.length >= 16) {
      get().notify('16 terminals is the cap — close one first.')
      return null
    }
    try {
      const info = await window.buddy.pty.create({
        ...spec,
        shellId: spec.shellId ?? settings.defaultShellId
      })
      const session: Session = {
        ...info,
        status: 'running',
        lastDataAt: 0,
        busy: false,
        attention: false,
        unseen: false
      }
      set((s) => ({ sessions: [...s.sessions, session], activeId: info.id }))
      get().persist()
      return info.id
    } catch (e) {
      get().notify(`Could not start a terminal: ${(e as Error).message}`)
      return null
    }
  },

  closeSession(id) {
    window.buddy.pty.kill(id)
    set((s) => {
      const idx = s.sessions.findIndex((x) => x.id === id)
      const sessions = s.sessions.filter((x) => x.id !== id)
      let activeId = s.activeId
      if (s.activeId === id) {
        const next = sessions[Math.min(idx, sessions.length - 1)]
        activeId = next ? next.id : null
      }
      return { sessions, activeId }
    })
    get().persist()
  },

  setActive(id) {
    set((s) => ({
      activeId: id,
      sessions: s.sessions.map((x) => (x.id === id ? { ...x, attention: false, unseen: false } : x))
    }))
  },

  cycle(dir) {
    const { sessions, activeId } = get()
    if (sessions.length < 2) return
    const i = sessions.findIndex((s) => s.id === activeId)
    const next = sessions[(i + dir + sessions.length) % sessions.length]
    get().setActive(next.id)
  },

  jumpTo(index) {
    const s = get().sessions[index]
    if (s) get().setActive(s.id)
  },

  renameSession(id, title) {
    set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, title } : x)) }))
    get().persist()
  },

  setLayout(layout) {
    set({ layout })
    get().persist()
  },

  markData(id) {
    const now = Date.now()
    set((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === id
          ? { ...x, lastDataAt: now, busy: true, attention: false, unseen: x.id === s.activeId ? false : true }
          : x
      )
    }))
  },

  patchSession(id, patch) {
    set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, ...patch } : x)) }))
  },

  markExit(id, code) {
    set((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === id ? { ...x, status: 'exited', exitCode: code, busy: false, attention: false } : x
      )
    }))
  },

  /**
   * A pane that was producing output and then went quiet is usually an agent
   * waiting on you. Flag it, unless you are already looking at it.
   */
  sweepAttention() {
    const { sessions, settings, activeId } = get()
    const now = Date.now()
    let changed = false
    const next = sessions.map((s) => {
      if (!s.busy || s.status !== 'running') return s
      if (now - s.lastDataAt < settings.attentionDelayMs) return s
      changed = true
      return { ...s, busy: false, attention: s.id !== activeId }
    })
    if (changed) set({ sessions: next })
  },

  async setSettings(patch) {
    const settings = { ...get().settings, ...patch }
    set({ settings })
    await window.buddy.settings.set(settings)
  },

  setSidebar(open, tab) {
    set((s) => ({ sidebarOpen: open, sidebarTab: tab ?? s.sidebarTab }))
  },
  setSidebarWidth(w) {
    set({ sidebarWidth: Math.min(720, Math.max(260, w)) })
  },
  setPalette(open) {
    set({ paletteOpen: open })
  },
  setSettingsOpen(open) {
    set({ settingsOpen: open })
  },
  toggleBroadcast() {
    const broadcast = !get().broadcast
    set({ broadcast })
    get().notify(broadcast ? 'Broadcast on — typing goes to every terminal.' : 'Broadcast off.')
  },

  async loadCatalog(force = false) {
    if (get().catalogLoading) return
    set({ catalogLoading: true })
    try {
      const catalog = force ? await window.buddy.catalog.refresh() : await window.buddy.catalog.get()
      set({ catalog })
    } catch (e) {
      get().notify(`Catalog scan failed: ${(e as Error).message}`)
    } finally {
      set({ catalogLoading: false, scanProgress: null })
    }
  },

  notify(msg) {
    set({ toast: msg })
    setTimeout(() => {
      if (get().toast === msg) set({ toast: null })
    }, 4000)
  },

  persist() {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      const { sessions, layout } = get()
      void window.buddy.workspace.set({
        sessions: sessions
          .filter((s) => s.status === 'running')
          .map((s) => ({ cwd: s.cwd, shellId: s.shellId, title: s.title })),
        layout
      })
    }, 400)
  }
}))
