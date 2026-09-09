import { useEffect, useRef, useState } from 'react'
import { TopBar, TabBar } from './components/Chrome'
import TerminalArea from './components/TerminalArea'
import Sidebar from './components/Sidebar'
import Palette from './components/Palette'
import SettingsPanel from './components/SettingsPanel'
import { useStore } from './store/useStore'
import { matchShortcut, matchClipboard } from './lib/shortcuts'
import { handleClipboard } from './lib/clipboard'
import { get as getTerm, writeTo } from './lib/terminals'
import { greeting } from './lib/copy'
import { chime } from './lib/chime'
import { drawBadge } from './lib/badge'
import { applyTheme } from './lib/themes'
import Buddy from './components/Buddy'
import CloseSessionDialog from './components/CloseSessionDialog'
import NewSessionDialog from './components/NewSessionDialog'
import RestoreSessionDialog from './components/RestoreSessionDialog'
import Walkthrough from './components/Walkthrough'
import { connectWindowTransfers } from './lib/window-transfers'
import LaunchRecovery from './components/LaunchRecovery'
import MoveSessionDialog from './components/MoveSessionDialog'
import PresetsDialog from './components/PresetsDialog'
import LinkSessionDialog from './components/LinkSessionDialog'

export default function App(): React.JSX.Element {
  const transferBusy = useStore(s => s.transferBusy)
  const moveSessionId = useStore(s => s.moveSessionId)
  const presetsOpen = useStore(s => s.presetsOpen)
  const [transferHover, setTransferHover] = useState(false)
  useEffect(connectWindowTransfers, [])
  useEffect(() => window.buddy.catalog.onRenamed((catalog, agent, id, title) => {
    useStore.setState({ catalog })
    const store = useStore.getState()
    for (const session of store.sessions) {
      if (session.resume?.agent === agent && session.resume.id === id) store.renameSession(session.id, title)
    }
  }), [])
  useEffect(() => window.buddy.clipboard.onPaste(text => {
    if (useStore.getState().transferBusy) return
    void handleClipboard('paste', text).catch(() => useStore.getState().notify('Could not paste clipboard text. Please try again.'))
  }), [])
  useEffect(() => window.buddy.workspace.onTransferHover(setTransferHover), [])
  useEffect(() => window.buddy.library.onChanged(library => useStore.setState({ library })), [])
  const ready = useStore((s) => s.ready)
  const sidebarOpen = useStore((s) => s.sidebarOpen)
  const paletteOpen = useStore((s) => s.paletteOpen)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const newSessionOpen = useStore((s) => s.newSessionOpen)
  const restoreItems = useStore((s) => s.restoreItems)
  const walkthroughOpen = useStore((s) => s.walkthroughOpen)
  const linkSessionId = useStore((s) => s.linkSessionId)
  const broadcast = useStore((s) => s.broadcast)
  const toast = useStore((s) => s.toast)
  const settings = useStore((s) => s.settings)
  const waiting = useStore((s) => s.sessions.filter((x) => x.attention).length)
  const total = useStore((s) => s.sessions.length)
  const detachedAttention = useStore((s) => s.sessions.filter((x) => x.detached).map((x) => `${x.id}:${Number(x.attention)}`).join(','))
  const prevWaiting = useRef(0)

  const [searchOpen, setSearchOpen] = useState(false)
  useEffect(() => {
    const refresh = (): void => { if (useStore.getState().ready) void useStore.getState().loadCatalog(true) }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])
  const [searchTerm, setSearchTerm] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void useStore.getState().boot()
    const save = (): void => useStore.getState().persistNow()
    window.addEventListener('beforeunload', save)
    return () => window.removeEventListener('beforeunload', save)
  }, [])

  // One pty bridge for every pane, rather than a listener per terminal.
  useEffect(() => {
    for (const session of useStore.getState().sessions) {
      if (session.detached) window.buddy.popout.attention(session.id, session.attention)
    }
  }, [detachedAttention])

  useEffect(() => {
    return window.buddy.popout.onSeen((id) => useStore.getState().patchSession(id, { attention: false, unseen: false }))
  }, [])

  useEffect(() => window.buddy.settings.onChanged((settings) => {
    applyTheme(settings.theme)
    const shells = useStore.getState().shells
    const defaultShellId = shells.some((shell) => shell.id === settings.defaultShellId) ? settings.defaultShellId : shells[0]?.id
    useStore.setState({ settings: { ...settings, defaultShellId } })
  }), [])

  useEffect(() => {
    const offState = window.buddy.popout.onState((id, detached) => {
      const handle = getTerm(id)
      if (handle) handle.detached = detached
      useStore.getState().patchSession(id, { detached })
      if (!detached) {
        useStore.getState().setActive(id)
      }
    })
    const offSize = window.buddy.popout.onSize((id, cols, rows) => getTerm(id)?.term.resize(cols, rows))
    const offInput = window.buddy.popout.onInput((id) => useStore.getState().markInput(id))
    return () => { offState(); offSize(); offInput() }
  }, [])

  useEffect(() => {
    const offData = window.buddy.pty.onData((id, data) => {
      writeTo(id, data)
      useStore.getState().markData(id)
    })
    const offExit = window.buddy.pty.onExit((id, code) => {
      writeTo(id, `\r\n\x1b[38;5;244m[process exited with code ${code}]\x1b[0m\r\n`)
      useStore.getState().markExit(id, code)
    })
    const offInfo = window.buddy.pty.onInfo((id, patch) => useStore.getState().patchSession(id, patch))
    const offNotification = window.buddy.app.onSelectTerminal((id) => {
      const s = useStore.getState()
      if (!s.sessions.some((x) => x.id === id)) return s.notify('That terminal has already been closed.')
      s.setActive(id)
      s.setLocked(true)
      requestAnimationFrame(() => getTerm(id)?.term.focus())
    })
    const offNotificationError = window.buddy.app.onNotificationError((message) => useStore.getState().notify(message))
    const offProgress = window.buddy.catalog.onProgress((p) => useStore.setState({ scanProgress: p }))
    const offFolder = window.buddy.app.onOpenFolder((dir) => {
      void useStore.getState().openSession({ cwd: dir })
    })
    const offFeed = window.buddy.feed.onEvents((id, events) =>
      useStore.getState().addFeedEvents(id, events)
    )
    const offAgent = window.buddy.feed.onAgent((id, agent) =>
      useStore.setState((s) => ({ agents: { ...s.agents, [id]: agent } }))
    )
    const offNew = window.buddy.app.onNewTerminal(() => {
      useStore.getState().setNewSessionOpen(true)
    })
    return () => {
      offData()
      offExit()
      offInfo()
      offNotification()
      offNotificationError()
      offProgress()
      offFolder()
      offFeed()
      offAgent()
      offNew()
    }
  }, [])

  useEffect(() => {
    if (settings.chime && waiting > prevWaiting.current) chime()
    prevWaiting.current = waiting
  }, [waiting, settings.chime])

  // The tray tooltip and the taskbar overlay badge both live in main, but the
  // fleet state and the theme colours live here.
  useEffect(() => {
    window.buddy.app.setStatus(total, waiting, drawBadge(waiting))
  }, [total, waiting, settings.theme])

  // Drives the "went quiet, probably waiting on you" badge.
  useEffect(() => {
    const t = setInterval(() => useStore.getState().sweepAttention(), 400)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (useStore.getState().transferBusy || useStore.getState().moveSessionId || useStore.getState().presetsOpen || useStore.getState().pendingCloseId || useStore.getState().newSessionOpen || useStore.getState().restoreItems || useStore.getState().restoring || useStore.getState().walkthroughOpen || useStore.getState().linkSessionId) return
      if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false)
        const id = useStore.getState().activeId
        if (id) getTerm(id)?.search.clearDecorations()
        return
      }
      const state = useStore.getState()
      if (e.key === 'Escape' && !e.isComposing && state.focusedSessionId && !state.settingsOpen && !state.paletteOpen && !(e.target as HTMLElement).closest('input:not(.xterm-helper-textarea), select, [contenteditable="true"]')) {
        e.preventDefault()
        useStore.setState({ focusedSessionId: null })
        return
      }

      // Clipboard first: what it does depends on what has focus, and the app
      // owns these keys outright now that the default menu is gone.
      const clip = matchClipboard(e)
      if (clip) {
        // Consumed asynchronously, so claim the event up front and let the
        // handler decide; an unhandled Ctrl+C falls through as an interrupt.
        void handleClipboard(clip).then((handled) => {
          if (!handled && clip === 'copy' && e.ctrlKey && !e.metaKey) {
            const id = useStore.getState().activeId
            if (id) window.buddy.pty.write(id, '\x03')
          }
        })
        e.preventDefault()
        return
      }

      const hit = matchShortcut(e)
      if (!hit) return
      const s = useStore.getState()

      e.preventDefault()
      if (hit.startsWith('jump:')) return s.jumpTo(Number(hit.slice(5)))

      switch (hit) {
        case 'newWindow':
          void window.buddy.app.newWindow().catch((error) => s.notify(error.message))
          break
        case 'new': {
          s.setNewSessionOpen(true)
          break
        }
        case 'duplicate': {
          const active = s.sessions.find((x) => x.id === s.activeId)
          if (active) void s.openSession({ cwd: active.cwd, shellId: active.shellId })
          break
        }
        case 'close':
          if (s.activeId) s.closeSession(s.activeId)
          break
        case 'next':
          s.cycle(1)
          break
        case 'prev':
          s.cycle(-1)
          break
        case 'layout': {
          const order = ['tabs', 'grid'] as const
          s.setLayout(order[(order.indexOf(s.layout) + 1) % order.length])
          break
        }
        case 'sidebar':
          s.setSidebar(!s.sidebarOpen)
          break
        case 'palette':
          s.setPalette(true)
          break
        case 'settings':
          s.setSettingsOpen(true)
          break
        case 'broadcast':
          s.toggleBroadcast()
          break
        case 'lock':
          s.setLocked(!s.locked)
          s.notify(s.locked ? 'Unlocked — drag panes to move; drag grid dividers to resize.' : 'Layout locked.')
          break
        case 'search':
          setSearchOpen(true)
          setTimeout(() => searchRef.current?.select(), 0)
          break
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [searchOpen])

  const runSearch = (dir: 1 | -1): void => {
    const id = useStore.getState().activeId
    if (!id || !searchTerm) return
    const h = getTerm(id)
    if (!h) return
    if (dir === 1) h.search.findNext(searchTerm)
    else h.search.findPrevious(searchTerm)
  }

  if (!ready) {
    return (
      <div className="boot">
        <Buddy mood="calm" size={84} />
        <span className="boot-greeting">{greeting()}</span>
        <span className="boot-sub">Waking up the buddy…</span>
      </div>
    )
  }

  return (
    <div
      className={`app ${broadcast ? 'is-broadcast' : ''} ${settings.reduceMotion ? 'no-motion' : ''}`}
    >
      <TopBar />
      <div className="body">
        {sidebarOpen && <Sidebar />}
        <main className="main">
          <TabBar />
          <TerminalArea />
          {searchOpen && (
            <div className="findbar">
              <input
                ref={searchRef}
                autoFocus
                placeholder="Find in terminal"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') runSearch(e.shiftKey ? -1 : 1)
                  if (e.key === 'Escape') setSearchOpen(false)
                }}
              />
              <button className="icon-btn" onClick={() => runSearch(-1)} title="Previous">
                ↑
              </button>
              <button className="icon-btn" onClick={() => runSearch(1)} title="Next">
                ↓
              </button>
              <button className="icon-btn" onClick={() => setSearchOpen(false)} title="Close">
                ✕
              </button>
            </div>
          )}
        </main>
      </div>

      {broadcast && <div className="broadcast-strip">Broadcast on — every keystroke goes to all terminals</div>}
      {!newSessionOpen && !presetsOpen && <div className="launch-error-banner"><LaunchRecovery /></div>}
      {transferHover && <div className="transfer-hover">Release to move this terminal here</div>}
      {transferBusy && <div className="transfer-busy" role="status">Moving terminals…</div>}
      {moveSessionId && <MoveSessionDialog id={moveSessionId} />}
      {presetsOpen && <PresetsDialog />}
      {paletteOpen && <Palette />}
      {settingsOpen && <SettingsPanel />}
      <CloseSessionDialog />
      {newSessionOpen && !restoreItems && !walkthroughOpen && <NewSessionDialog />}
      {restoreItems && <RestoreSessionDialog items={restoreItems} />}
      {walkthroughOpen && !restoreItems && <Walkthrough />}
      {linkSessionId && <LinkSessionDialog sessionId={linkSessionId} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
