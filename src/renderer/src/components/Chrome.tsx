import { shortcutLabel } from '../lib/shortcuts'
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import { shortPath } from '../lib/format'
import { fleetStatus } from '../lib/copy'
import Buddy, { type Mood } from './Buddy'
import { beginTerminalDrag } from '../lib/terminal-drag'

/** Fleet state, condensed to one of the buddy's four faces. */
export function useMood(): { mood: Mood; busy: number; waiting: number; total: number } {
  const sessions = useStore((s) => s.sessions)
  const total = sessions.length
  const busy = sessions.filter((s) => s.busy).length
  const waiting = sessions.filter((s) => s.attention).length
  const mood: Mood = total === 0 ? 'asleep' : waiting > 0 ? 'alert' : busy > 0 ? 'working' : 'calm'
  return { mood, busy, waiting, total }
}

export function TopBar(): React.JSX.Element {
  const layout = useStore((s) => s.layout)
  const setLayout = useStore((s) => s.setLayout)
  const sidebarOpen = useStore((s) => s.sidebarOpen)
  const setSidebar = useStore((s) => s.setSidebar)
  const broadcast = useStore((s) => s.broadcast)
  const toggleBroadcast = useStore((s) => s.toggleBroadcast)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const setPalette = useStore((s) => s.setPalette)
  const notify = useStore((s) => s.notify)
  const locked = useStore((s) => s.locked)
  const setLocked = useStore((s) => s.setLocked)
  const { mood, busy, waiting, total } = useMood()

  const status = fleetStatus(total, busy, waiting)

  return (
    <div className="topbar">
      <div className="brand">
        <Buddy
          mood={mood}
          title={status}
          onClick={() => {
            const first = useStore.getState().sessions.find((s) => s.attention)
            if (first) {
              useStore.getState().setActive(first.id)
              notify(`Taking you to ${first.critter.emoji} ${first.title}`)
            } else {
              notify(status)
            }
          }}
        />
        <span className="brand-name">Terminal Buddy</span>
        <span className={`brand-status ${waiting ? 'is-waiting' : ''}`}>{status}</span>
      </div>

      <div className="topbar-actions">
        <WorkspaceWindowMenu />
        <button
          className={`icon-btn ${sidebarOpen ? 'is-on' : ''}`}
          title={shortcutLabel("Catalog — skills, chats, projects (Ctrl+Shift+E)")}
          onClick={() => setSidebar(!sidebarOpen)}
        >
          ▤
        </button>
        <button className="icon-btn" title={shortcutLabel("Command palette (Ctrl+Shift+P)")} onClick={() => setPalette(true)}>
          ⌘
        </button>
        <div className="seg">
          <button
            className={layout === 'tabs' ? 'is-on' : ''}
            title={shortcutLabel("Tabs (Ctrl+Shift+G)")}
            onClick={() => setLayout('tabs')}
          >
            Tabs
          </button>
          <button
            className={layout === 'grid' ? 'is-on' : ''}
            title={shortcutLabel("Grid (Ctrl+Shift+G)")}
            onClick={() => setLayout('grid')}
          >
            Grid
          </button>
        </div>
        {(
          <button
            className={`icon-btn ${locked ? '' : 'is-warn'}`}
            title={
              locked
                ? shortcutLabel('Layout locked - click to unlock and rearrange panes (Ctrl+Shift+L)')
                : shortcutLabel('Layout unlocked - drag panes to move, or grid dividers to resize. Click to lock (Ctrl+Shift+L)')
            }
            onClick={() => {
              setLocked(!locked)
              notify(locked ? 'Unlocked — drag panes to move; drag grid dividers to resize.' : shortcutLabel('Layout locked.'))
            }}
          >
            {locked ? '🔒' : '🔓'}
          </button>
        )}
        <button
          className={`icon-btn ${broadcast ? 'is-danger' : ''}`}
          title={shortcutLabel("Broadcast typing to every terminal (Ctrl+Shift+B)")}
          onClick={toggleBroadcast}
        >
          ⇉
        </button>
        <button className="icon-btn" title={shortcutLabel("Settings (Ctrl+,)")} onClick={() => setSettingsOpen(true)}>
          ⚙
        </button>
      </div>
    </div>
  )
}

function WorkspaceWindowMenu(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [windows, setWindows] = useState<Awaited<ReturnType<typeof window.buddy.app.windows>>>([])
  const refresh = (): void => { void window.buddy.app.windows().then(setWindows).catch(() => setOpen(false)) }
  useEffect(() => {
    refresh()
    return window.buddy.app.onWindowsChanged(refresh)
  }, [])
  useEffect(() => {
    if (!open) return
    refresh()
    const dismiss = (event: PointerEvent): void => {
      if (!(event.target as HTMLElement).closest('.workspace-window-menu')) setOpen(false)
    }
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('pointerdown', dismiss); window.removeEventListener('keydown', escape) }
  }, [open])
  return <div className="workspace-window-menu">
    <button className="icon-btn" data-new-window aria-label="New window" title={shortcutLabel('New workspace window (Ctrl+Shift+N)')}
      onClick={() => void window.buddy.app.newWindow().catch((error) => useStore.getState().notify(error.message))}>⊞</button>
    <button className="icon-btn" data-window-menu aria-label="Switch workspace window" title="Workspace windows" aria-expanded={open}
      onClick={() => setOpen(!open)}>▾</button>
    {open && <div className="workspace-window-list" aria-label="Workspace windows">
      {windows.map((entry) => <button key={entry.id} className="btn" data-window-target={entry.id} disabled={entry.current}
        onClick={() => { setOpen(false); void window.buddy.app.focusWindow(entry.id).catch((error) => useStore.getState().notify(error.message)) }}>
        {entry.label}{entry.current ? ' · this window' : ''}<small>{entry.terminals} terminal{entry.terminals === 1 ? '' : 's'}</small>
      </button>)}
    </div>}
  </div>
}

export function TabBar(): React.JSX.Element {
  const sessions = useStore((s) => s.sessions)
  const activeId = useStore((s) => s.activeId)
  const setActive = useStore((s) => s.setActive)
  const closeSession = useStore((s) => s.closeSession)
  const setNewSessionOpen = useStore((s) => s.setNewSessionOpen)
  const renameSession = useStore((s) => s.renameSession)
  const settings = useStore((s) => s.settings)
  const [editing, setEditing] = useState<string | null>(null)

  return (
    <div className="tabbar">
      <div className="tabs">
        {sessions.map((s, i) => (
          <div
            key={s.id}
            data-session-id={s.id}
            onPointerDown={(event) => { if (editing !== s.id) beginTerminalDrag(event, s.id) }}
            className={`tab ${s.id === activeId ? 'is-active' : ''} ${s.status === 'exited' ? 'is-exited' : ''} ${s.attention ? 'wants-you' : ''}`}
            draggable={false}
            style={settings.critters ? { ['--critter' as string]: `hsl(${s.critter.hue} 70% 62%)` } : undefined}
            onMouseDown={() => setActive(s.id)}
            onDoubleClick={() => setEditing(s.id)}
            title={`${settings.critters ? `the ${s.critter.name} — ` : ''}${s.cwd}\n${s.shellLabel} · pid ${s.pid}`}
          >
            {settings.critters ? (
              <span className="tab-critter">{s.critter.emoji}</span>
            ) : (
              <span className="tab-index">{i + 1}</span>
            )}
            {editing === s.id ? (
              <input
                className="tab-rename"
                defaultValue={s.title}
                autoFocus
                onBlur={(e) => {
                  renameSession(s.id, e.target.value.trim() || s.title)
                  setEditing(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  if (e.key === 'Escape') setEditing(null)
                }}
              />
            ) : (
              <span className="tab-title">{s.title}</span>
            )}
            {s.attention && <span className="dot attention" title="Time to take a look — click to acknowledge" />}
            {!s.attention && s.unseen && <span className="dot unseen" title="New output" />}
            {s.status === 'exited' && <span className="tab-dead">exited</span>}
            <button className="tab-close" data-popout={s.id} title={s.detached ? 'Show popped-out terminal' : 'Pop out terminal'}
              onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); void useStore.getState().detachSession(s.id) }}>↗</button>
            <button
              className="tab-close"
              title={shortcutLabel("Close (Ctrl+Shift+W)")}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                closeSession(s.id)
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <button className="tab-new" title={shortcutLabel("New chat or terminal… (Ctrl+Shift+T)")} aria-label="New chat or terminal" onClick={() => setNewSessionOpen(true)}>
          +
        </button>
      </div>

      <div className="tabbar-right">
        {activeId && (
          <span className="cwd" title={sessions.find((s) => s.id === activeId)?.cwd}>
            {shortPath(sessions.find((s) => s.id === activeId)?.cwd ?? '', 3)}
          </span>
        )}
      </div>
    </div>
  )
}
