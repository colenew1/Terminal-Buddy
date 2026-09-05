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
import Buddy from './components/Buddy'

export default function App(): React.JSX.Element {
  const ready = useStore((s) => s.ready)
  const sidebarOpen = useStore((s) => s.sidebarOpen)
  const paletteOpen = useStore((s) => s.paletteOpen)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const broadcast = useStore((s) => s.broadcast)
  const toast = useStore((s) => s.toast)
  const settings = useStore((s) => s.settings)
  const waiting = useStore((s) => s.sessions.filter((x) => x.attention).length)
  const total = useStore((s) => s.sessions.length)
  const prevWaiting = useRef(0)

  const [searchOpen, setSearchOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void useStore.getState().boot()
  }, [])

  // One pty bridge for every pane, rather than a listener per terminal.
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
    const offProgress = window.buddy.catalog.onProgress((p) => useStore.setState({ scanProgress: p }))
    const offFolder = window.buddy.app.onOpenFolder((dir) => {
      void useStore.getState().openSession({ cwd: dir })
    })
    const offNew = window.buddy.app.onNewTerminal(() => {
      const s = useStore.getState()
      const active = s.sessions.find((x) => x.id === s.activeId)
      void window.buddy.app.paths().then((p) => s.openSession({ cwd: active?.cwd ?? p.home }))
    })
    return () => {
      offData()
      offExit()
      offInfo()
      offProgress()
      offFolder()
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
      if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false)
        const id = useStore.getState().activeId
        if (id) getTerm(id)?.search.clearDecorations()
        return
      }

      // Clipboard first: what it does depends on what has focus, and the app
      // owns these keys outright now that the default menu is gone.
      const clip = matchClipboard(e)
      if (clip) {
        // Consumed asynchronously, so claim the event up front and let the
        // handler decide; an unhandled Ctrl+C falls through as an interrupt.
        void handleClipboard(clip).then((handled) => {
          if (!handled && clip === 'copy') {
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
        case 'new': {
          const active = s.sessions.find((x) => x.id === s.activeId)
          void window.buddy.app.paths().then((p) => s.openSession({ cwd: active?.cwd ?? p.home }))
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
        case 'layout':
          s.setLayout(s.layout === 'tabs' ? 'grid' : 'tabs')
          break
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
          s.notify(s.locked ? 'Layout unlocked — drag panes to rearrange.' : 'Layout locked.')
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
    <div className={`app ${broadcast ? 'is-broadcast' : ''} ${settings.reduceMotion ? 'no-motion' : ''}`}>
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
      {paletteOpen && <Palette />}
      {settingsOpen && <SettingsPanel />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
