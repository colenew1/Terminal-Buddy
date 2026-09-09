import { create } from 'zustand'
import {
  DEFAULT_SETTINGS,
  type Catalog,
  type LayoutMode,
  type ScanProgress,
  type SessionSpec,
  type Settings,
  type FeedEvent,
  type Pos,
  type ShellDef,
  type Span,
  type ResumeRef, type RestoreItem, type PersistedSession, type Workspace, type LauncherLibrary
} from '@shared/types'
import { pickCritter, findCritter, type Critter } from '../lib/critters'
import { applyTheme } from '../lib/themes'

export interface Session {
  assistantId?: string
  assistantName?: string
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
  critter: Critter
  /** Grid footprint in cells. Only meaningful in grid view. */
  span: Span
  /** Legacy spatial position, kept for backwards-compatible workspace saves. */
  pos: Pos
  hasInput: boolean
  hasConversation: boolean
  replacing: boolean
  resume?: ResumeRef
  detached?: boolean
}

/** What a session has actually been reaching for, counted from its transcript. */
export interface ToolStat {
  key: string
  label: string
  count: number
  lastAt: number
  /** Set when the tool came from an MCP server, naming the server. */
  mcp: string | null
}

export type SidebarTab = 'chats' | 'skills' | 'projects'

interface State {
  transferBusy: boolean
  library: LauncherLibrary
  presetsOpen: boolean
  moveSessionId: string | null
  launchError: string | null
  failedSpec: SessionSpec | null
  ready: boolean
  shells: ShellDef[]
  settings: Settings
  sessions: Session[]
  activeId: string | null
  focusedSessionId: string | null
  walkthroughOpen: boolean
  linkSessionId: string | null
  pendingCloseId: string | null
  layout: LayoutMode
  gridSizes: { columns: number[]; rows: number[] }
  restoreItems: RestoreItem[] | null
  restoring: boolean
  unrestoredSessions: PersistedSession[]
  restoreActiveIndex: number

  sidebarOpen: boolean
  sidebarTab: SidebarTab
  sidebarWidth: number
  paletteOpen: boolean
  settingsOpen: boolean
  newSessionOpen: boolean
  broadcast: boolean
  /** Locked means panes take input; unlocked means you can drag them around. */
  locked: boolean
  /** Which panes are running an agent right now, refreshed on demand. */
  agents: Record<string, 'claude' | 'codex' | null>
  /** Live conversation per pane, tailed from the agent's own transcript. */
  feeds: Record<string, FeedEvent[]>
  /** Tools and MCP servers each pane has touched, most recent first. */
  toolStats: Record<string, ToolStat[]>

  catalog: Catalog | null
  catalogLoading: boolean
  scanProgress: ScanProgress | null

  toast: string | null
}

interface Actions {
  detachSession: (id: string, point?: Pos) => Promise<void>
  boot: () => Promise<void>
  openSession: (spec: SessionSpec) => Promise<string | null>
  replaceEmptySession: (id: string, spec: SessionSpec) => Promise<string | null>
  markInput: (id: string) => void
  closeSession: (id: string, confirmed?: boolean) => void
  setActive: (id: string) => void
  cycle: (dir: 1 | -1) => void
  jumpTo: (index: number) => void
  renameSession: (id: string, title: string) => void
  setLocked: (v: boolean) => void
  swapSessions: (a: string, b: string) => void
  moveSession: (from: number, to: number) => void
  setSpan: (id: string, span: Span) => void
  setGridSizes: (axis: 'columns' | 'rows', weights: number[]) => void
  setPos: (id: string, pos: Pos) => void
  refreshAgents: () => Promise<void>
  addFeedEvents: (id: string, events: FeedEvent[]) => void
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
  setNewSessionOpen: (open: boolean) => void
  toggleBroadcast: () => void

  loadCatalog: (force?: boolean) => Promise<void>
  notify: (msg: string) => void
  persist: () => void
  persistNow: () => void
  restoreSelected: (indexes: number[]) => Promise<void>
  startFresh: () => Promise<void>
  findSavedChats: () => void
}

/** Lay new bubbles out on a loose spiral so they never open on top of each other. */
function scatter(index: number): Pos {
  const golden = 2.399963
  const a = index * golden
  const r = 90 + 46 * Math.sqrt(index)
  return { x: Math.round(520 + Math.cos(a) * r), y: Math.round(360 + Math.sin(a) * r) }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null

export const useStore = create<State & Actions>((set, get) => ({
  async detachSession(id, point) {
    const session = get().sessions.find((s) => s.id === id)
    if (!session || session.replacing || get().restoreItems) return
    try { await window.buddy.popout.open(id, point) }
    catch (error) { get().notify('Could not pop out terminal: ' + (error as Error).message) }
  },
  transferBusy: false,
  library: { recentFolders: [], pinnedChats: [], presets: [] },
  presetsOpen: false,
  moveSessionId: null,
  launchError: null,
  failedSpec: null,
  ready: false,
  shells: [],
  settings: DEFAULT_SETTINGS,
  sessions: [],
  activeId: null,
  focusedSessionId: null,
  walkthroughOpen: false,
  linkSessionId: null,
  pendingCloseId: null,
  layout: 'tabs',
  gridSizes: { columns: [], rows: [] },
  restoreItems: null,
  restoring: false,
  unrestoredSessions: [],
  restoreActiveIndex: 0,

  sidebarOpen: false,
  sidebarTab: 'chats',
  sidebarWidth: 380,
  paletteOpen: false,
  settingsOpen: false,
  newSessionOpen: false,
  broadcast: false,
  // Always starts locked: a stray drag mid-session should never rearrange work.
  locked: true,
  agents: {},
  feeds: {},
  toolStats: {},

  catalog: null,
  catalogLoading: false,
  scanProgress: null,

  toast: null,

  async boot() {
    void window.buddy.library.get().then(library => set({ library })).catch(() => get().notify('Could not load your saved favorites and presets.'))
    const [shells, settings, workspace] = await Promise.all([
      window.buddy.shells.list(),
      window.buddy.settings.get(),
      window.buddy.workspace.get()
    ])

    // A saved default shell that no longer exists would strand every new tab.
    const defaultShellId = shells.some((s) => s.id === settings.defaultShellId)
      ? settings.defaultShellId
      : shells[0]?.id

    applyTheme(settings.theme)
    set({
      shells,
      settings: { ...settings, defaultShellId },
      walkthroughOpen: settings.walkthroughVersion < 1,
      layout: workspace.layout ?? settings.layout,
      gridSizes: workspace.gridSizes ?? { columns: [], rows: [] }
    })

    const previous = [...workspace.sessions, ...(workspace.unrestoredSessions ?? [])]
    if (settings.restoreOnLaunch && previous.length) {
      let restoreItems: RestoreItem[]
      try { restoreItems = await window.buddy.workspace.prepareRestore(previous) }
      catch { restoreItems = previous.map((session, index) => ({ session, index, available: false, description: 'Could not check this saved session. Try Saved chats.' })) }
      set({ ready: true, restoreItems, restoreActiveIndex: workspace.activeIndex ?? 0 })
      void get().loadCatalog(true)
      return
    }
    if (get().sessions.length === 0) {
      set({ newSessionOpen: true })
    }
    set({ ready: true })
    get().persist()
    void get().loadCatalog(true)
  },

  async openSession(spec) {
    if (get().transferBusy) return null
    set({ launchError: null, failedSpec: spec })
    const { settings, sessions } = get()
    if (sessions.length >= 16) {
      set({ launchError: '16 terminals is the cap — close one first.' })
      get().notify('16 terminals is the cap — close one first.')
      return null
    }
    try {
      const info = await window.buddy.pty.create({
        ...spec,
        shellId: spec.shellId ?? settings.defaultShellId
      })
      const saved = spec.critter ? findCritter(spec.critter) : undefined
      const critter = saved ?? pickCritter(settings.critterPack, sessions.map((x) => x.critter.name))
      const session: Session = {
        ...info,
        critter,
        span: spec.span ?? { cols: 1, rows: 1 },
        pos: spec.pos ?? scatter(sessions.length),
        status: 'running',
        lastDataAt: 0,
        busy: false,
        attention: false,
        unseen: false,
        hasInput: !!spec.initialCommand || !!info.assistantId, hasConversation: !!spec.transcript, replacing: false,
        resume: info.resume ?? spec.resume
      }
      set((s) => ({ sessions: [...s.sessions, session], activeId: info.id,
        unrestoredSessions: s.unrestoredSessions.filter((old) => !session.resume || old.resume?.id !== session.resume.id || old.resume?.agent !== session.resume.agent),
        agents: { ...s.agents, [info.id]: spec.agent ?? spec.transcript?.agent ?? null } }))
      void window.buddy.library.rememberFolder(info.cwd).catch(() => {})
      if (!info.assistantId) window.buddy.feed.attach(info.id, info.cwd, session.resume ? { agent: session.resume.agent, path: session.resume.path } : spec.transcript)
      get().persist()
      set({ failedSpec: null })
      return info.id
    } catch (e) {
      set({ launchError: (e as Error).message })
      get().notify(`Could not start a terminal: ${(e as Error).message}`)
      return null
    }
  },

  async replaceEmptySession(id, spec) {
    const empty = (s: Session): boolean => !s.hasConversation && !s.hasInput && !s.replacing
    const original = get().sessions.find((s) => s.id === id)
    if (!original || !empty(original)) {
      get().notify('This pane has a conversation or unsent input. Open the chat in a new terminal.')
      return null
    }
    get().patchSession(id, { replacing: true })
    try {
      // Spawn first so failure leaves the original pane and process intact.
      const info = await window.buddy.pty.create({ ...spec, shellId: original.shellId })
      const current = get().sessions.find((s) => s.id === id)
      if (!current || !empty({ ...current, replacing: false })) {
        window.buddy.pty.kill(info.id)
        get().patchSession(id, { replacing: false })
        return null
      }
      const replacement: Session = {
        ...info, critter: current.critter, span: current.span, pos: current.pos,
        status: 'running', lastDataAt: 0, busy: false, attention: false, unseen: false,
        hasInput: !!spec.initialCommand || !!info.assistantId,
        hasConversation: !!spec.transcript, replacing: false,
        resume: info.resume ?? spec.resume
      }
      window.buddy.feed.detach(id)
      window.buddy.pty.kill(id)
      set((s) => {
        const { [id]: _feed, ...feeds } = s.feeds
        const { [id]: _stats, ...toolStats } = s.toolStats
        const { [id]: _agent, ...agents } = s.agents
        return { sessions: s.sessions.map((x) => x.id === id ? replacement : x),
          activeId: info.id, feeds, toolStats,
          agents: { ...agents, [info.id]: spec.agent ?? spec.transcript?.agent ?? null } }
      })
      if (!info.assistantId) window.buddy.feed.attach(info.id, info.cwd, replacement.resume ? { agent: replacement.resume.agent, path: replacement.resume.path } : spec.transcript)
      get().persist()
      return info.id
    } catch (e) {
      get().patchSession(id, { replacing: false })
      get().notify(`Could not open the chat: ${(e as Error).message}`)
      return null
    }
  },

  markInput(id) { get().patchSession(id, { hasInput: true, attention: false, unseen: false }) },

  closeSession(id, confirmed = false) {
    const current = get().sessions.find((s) => s.id === id)
    if (
      current?.status === 'running' &&
      get().settings.confirmCloseRunning && !confirmed
    ) {
      set({ pendingCloseId: id })
      return
    }
    set({ pendingCloseId: null })
    window.buddy.pty.kill(id)
    window.buddy.feed.detach(id)
    set((s) => {
      const idx = s.sessions.findIndex((x) => x.id === id)
      const sessions = s.sessions.filter((x) => x.id !== id)
      const { [id]: _feed, ...feeds } = s.feeds
      const { [id]: _stats, ...toolStats } = s.toolStats
      const { [id]: _agent, ...agents } = s.agents
      let activeId = s.activeId
      if (s.activeId === id) {
        const next = sessions[Math.min(idx, sessions.length - 1)]
        activeId = next ? next.id : null
      }
      return { sessions, activeId, feeds, toolStats, agents }
    })
    get().persist()
  },

  setActive(id) {
    if (get().sessions.find((s) => s.id === id)?.detached) window.buddy.popout.focus(id)
    set((s) => ({
      activeId: id,
      focusedSessionId: s.focusedSessionId === id ? id : null,
      sessions: s.sessions.map((x) => (x.id === id ? { ...x, attention: false, unseen: false } : x))
    }))
    get().persist()
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
    title = title.trim().slice(0, 100)
    if (!title) return
    set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, title } : x)) }))
    window.buddy.pty.rename(id, title)
    get().persist()
  },

  setLocked(v) {
    set({ locked: v })
    if (v) return
    // Unlocking takes focus off the terminal so keystrokes cannot leak into a
    // shell while you are dragging panes around.
    ;(document.activeElement as HTMLElement | null)?.blur()
  },

  /** Drop one pane onto another: they trade places. */
  swapSessions(a, b) {
    if (a === b) return
    set((s) => {
      const next = [...s.sessions]
      const i = next.findIndex((x) => x.id === a)
      const j = next.findIndex((x) => x.id === b)
      if (i < 0 || j < 0) return {}
      ;[next[i], next[j]] = [next[j], next[i]]
      return { sessions: next }
    })
    get().persist()
  },

  setPos(id, pos) {
    set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, pos } : x)) }))
    get().persist()
  },

  setSpan(id, span) {
    const cols = Math.max(1, Math.min(4, Math.round(span.cols)))
    const rows = Math.max(1, Math.min(4, Math.round(span.rows)))
    set((s) => ({
      sessions: s.sessions.map((x) => (x.id === id ? { ...x, span: { cols, rows } } : x))
    }))
    get().persist()
  },
  setGridSizes(axis, weights) {
    set((s) => ({ gridSizes: { ...s.gridSizes, [axis]: weights } }))
    get().persist()
  },

  addFeedEvents(id, events) {
    if (!events.length) return
    set((s) => {
      if (!s.sessions.some((x) => x.id === id)) return {}
      const prev = s.feeds[id] ?? []
      // Keep the tail bounded; a long agent run can produce thousands of rows.
      const seen = new Set(prev.map(event => event.id))
      const fresh = events.filter(event => { if (seen.has(event.id)) return false; seen.add(event.id); return true })
      const next = [...prev, ...fresh].slice(-500)

      const stats = new Map((s.toolStats[id] ?? []).map((t) => [t.key, { ...t }]))
      for (const e of fresh) {
        if (e.role !== 'tool' || !e.toolName) continue
        const mcp = /^mcp__([^_]+(?:_[^_]+)*)__/.exec(e.toolName)?.[1] ?? null
        const key = mcp ? `mcp:${mcp}` : e.toolName
        const label = mcp ?? e.tool ?? e.toolName
        const cur = stats.get(key)
        if (cur) {
          cur.count += 1
          cur.lastAt = e.ts
        } else {
          stats.set(key, { key, label, count: 1, lastAt: e.ts, mcp })
        }
      }
      const toolList = [...stats.values()].sort((a, b) => b.lastAt - a.lastAt).slice(0, 8)

      return { feeds: { ...s.feeds, [id]: next }, toolStats: { ...s.toolStats, [id]: toolList },
        sessions: s.sessions.map((x) => x.id === id && events.some((e) => e.role === 'user' || e.role === 'assistant')
          ? { ...x, hasConversation: true } : x) }
    })
  },

  async refreshAgents() {
    try {
      const probed = await window.buddy.pty.probeAgents()
      // A process scan can race a launch or replacement. It must not erase the
      // conversation identity supplied by an import or resurrect closed IDs.
      set((s) => ({ agents: Object.fromEntries(s.sessions.map((session) => [
        session.id, session.assistantId ? null : probed[session.id] ?? s.agents[session.id] ?? null
      ])) }))
    } catch {
      /* leaving the map empty just means "unknown", which the UI allows */
    }
  },

  moveSession(from, to) {
    set((s) => {
      if (from === to || from < 0 || to < 0) return {}
      const next = [...s.sessions]
      if (from >= next.length || to >= next.length) return {}
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return { sessions: next }
    })
    get().persist()
  },

  setLayout(layout) {
    set({ layout, focusedSessionId: null })
    get().persist()
  },

  markData(id) {
    const now = Date.now()
    set((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === id
          ? { ...x, lastDataAt: now, busy: true, unseen: true }
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
        x.id === id ? { ...x, status: 'exited', exitCode: code, busy: false, attention: x.attention || x.hasInput, unseen: true } : x
      )
    }))
  },

  /**
   * Quiet output is a cue to inspect, not proof of completion or approval.
   * Keep that cue until the user explicitly acknowledges the terminal.
   */
  sweepAttention() {
    const { sessions, settings } = get()
    const now = Date.now()
    let changed = false
    const next = sessions.map((s) => {
      if (!s.busy || s.status !== 'running') return s
      if (now - s.lastDataAt < settings.attentionDelayMs) return s
      changed = true
      // A plain shell also emits output and then goes quiet. Flag only an
      // identified built-in agent or an explicitly launched custom assistant.
      // Latch until an explicit look/input. Further output cannot dismiss it.
      return { ...s, busy: false, attention: s.attention || (s.unseen && (!!s.assistantId || !!get().agents[s.id])) }
    })
    if (changed) set({ sessions: next })
  },

  async setSettings(patch) {
    const settings = { ...get().settings, ...patch }
    if (patch.theme) applyTheme(patch.theme)
    set({ settings })
    await window.buddy.settings.set(settings)
  },

  setSidebar(open, tab) {
    const wasOpen = get().sidebarOpen
    set((s) => ({ sidebarOpen: open, sidebarTab: tab ?? s.sidebarTab }))
    if (open && !wasOpen) void get().loadCatalog(true)
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
  setNewSessionOpen(open) {
    if (get().restoreItems || get().restoring) return
    set({ newSessionOpen: open, ...(open ? { paletteOpen: false, settingsOpen: false } : {}) })
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

  async restoreSelected(indexes) {
    if (get().restoring || !get().restoreItems) return
    const items = get().restoreItems!
    const activeIndex = get().restoreActiveIndex
    const failed = items.filter((item) => !item.available).map((item) => item.session)
    set({ restoring: true })
    let opened = 0, unlinked = 0, activeId: string | null = null
    for (const item of items) {
      if (!item.available || !indexes.includes(item.index)) continue
      try {
        const spec = await window.buddy.workspace.restoreSpec(item.session, item.folderOnly)
        const id = await get().openSession(spec)
        if (!id) throw Error('Could not open terminal')
        opened++
        if (item.folderOnly) unlinked++
        if (item.index === activeIndex) activeId = id
      } catch { failed.push(item.session) }
    }
    set({ restoring: false, restoreItems: null, unrestoredSessions: failed })
    if (activeId) get().setActive(activeId)
    get().persistNow()
    if (failed.length) get().notify(`Reopened ${opened}. ${failed.length} unavailable or unlinked — use Saved chats; their recovery entries are kept.`)
    else if (unlinked) get().notify(`Reopened ${opened}. ${unlinked} opened as folders only — use Link a chat to reconnect their conversations.`)
  },

  async startFresh() {
    if (get().restoring || !get().restoreItems) return
    set({ restoreItems: null, unrestoredSessions: [], newSessionOpen: true })
    get().persistNow()
  },

  findSavedChats() {
    if (get().restoring) return
    set({ unrestoredSessions: get().restoreItems?.map((item) => item.session) ?? get().unrestoredSessions, restoreItems: null })
    get().setSidebar(true, 'chats')
    get().persistNow()
  },

  persistNow() {
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = null }
    const state = get()
    // Opening/closing the startup chooser must never replace the recovery snapshot.
    if (state.restoreItems || state.restoring || !state.ready || state.transferBusy) return
    // An exited agent can still have a resumable conversation.
    const live = state.sessions
    const workspace: Workspace = {
      sessions: live.map((s) => ({ cwd: s.cwd, shellId: s.shellId, title: s.title, critter: s.critter.name,
        span: s.span, pos: s.pos, assistantId: s.assistantId, assistantName: s.assistantName, resume: s.resume, agent: s.resume?.agent ?? state.agents[s.id] ?? undefined })),
      layout: state.layout, gridSizes: state.gridSizes,
      activeIndex: Math.max(0, live.findIndex((s) => s.id === state.activeId)),
      unrestoredSessions: state.unrestoredSessions
    }
    const error = window.buddy.workspace.saveSync(workspace)
    if (error) get().notify('Could not save the workspace: ' + error)
  },

  persist() {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => get().persistNow(), 400)
  }
}))
