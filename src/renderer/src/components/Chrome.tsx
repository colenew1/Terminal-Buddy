import { useState } from 'react'
import { useStore } from '../store/useStore'
import { shortPath } from '../lib/format'

export function TopBar(): React.JSX.Element {
  const layout = useStore((s) => s.layout)
  const setLayout = useStore((s) => s.setLayout)
  const sidebarOpen = useStore((s) => s.sidebarOpen)
  const setSidebar = useStore((s) => s.setSidebar)
  const broadcast = useStore((s) => s.broadcast)
  const toggleBroadcast = useStore((s) => s.toggleBroadcast)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const setPalette = useStore((s) => s.setPalette)
  const count = useStore((s) => s.sessions.length)

  return (
    <div className="topbar">
      <div className="brand">
        <span className="brand-mark" />
        <span className="brand-name">Terminal Buddy</span>
        <span className="brand-count">{count} open</span>
      </div>

      <div className="topbar-actions">
        <button
          className={`icon-btn ${sidebarOpen ? 'is-on' : ''}`}
          title="Catalog — skills, chats, projects (Ctrl+Shift+E)"
          onClick={() => setSidebar(!sidebarOpen)}
        >
          ▤
        </button>
        <button className="icon-btn" title="Command palette (Ctrl+Shift+P)" onClick={() => setPalette(true)}>
          ⌘
        </button>
        <div className="seg">
          <button
            className={layout === 'tabs' ? 'is-on' : ''}
            title="Tabs (Ctrl+Shift+G)"
            onClick={() => setLayout('tabs')}
          >
            Tabs
          </button>
          <button
            className={layout === 'grid' ? 'is-on' : ''}
            title="Grid (Ctrl+Shift+G)"
            onClick={() => setLayout('grid')}
          >
            Grid
          </button>
        </div>
        <button
          className={`icon-btn ${broadcast ? 'is-danger' : ''}`}
          title="Broadcast typing to every terminal (Ctrl+Shift+B)"
          onClick={toggleBroadcast}
        >
          ⇉
        </button>
        <button className="icon-btn" title="Settings (Ctrl+,)" onClick={() => setSettingsOpen(true)}>
          ⚙
        </button>
      </div>
    </div>
  )
}

export function TabBar(): React.JSX.Element {
  const sessions = useStore((s) => s.sessions)
  const activeId = useStore((s) => s.activeId)
  const setActive = useStore((s) => s.setActive)
  const closeSession = useStore((s) => s.closeSession)
  const openSession = useStore((s) => s.openSession)
  const renameSession = useStore((s) => s.renameSession)
  const settings = useStore((s) => s.settings)
  const [editing, setEditing] = useState<string | null>(null)

  const newTerminal = async (): Promise<void> => {
    const active = sessions.find((s) => s.id === activeId)
    const paths = await window.buddy.app.paths()
    void openSession({ cwd: active?.cwd ?? paths.home, shellId: settings.defaultShellId })
  }

  return (
    <div className="tabbar">
      <div className="tabs">
        {sessions.map((s, i) => (
          <div
            key={s.id}
            className={`tab ${s.id === activeId ? 'is-active' : ''} ${s.status === 'exited' ? 'is-exited' : ''}`}
            onMouseDown={() => setActive(s.id)}
            onDoubleClick={() => setEditing(s.id)}
            title={`${s.cwd}\n${s.shellLabel} · pid ${s.pid}`}
          >
            <span className="tab-index">{i + 1}</span>
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
            {s.attention && <span className="dot attention" title="Went quiet — probably waiting on you" />}
            {!s.attention && s.unseen && <span className="dot unseen" title="New output" />}
            {s.status === 'exited' && <span className="tab-dead">exited</span>}
            <button
              className="tab-close"
              title="Close (Ctrl+Shift+W)"
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
        <button className="tab-new" title="New terminal (Ctrl+Shift+T)" onClick={newTerminal}>
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
