import { useState } from 'react'
import { useStore } from '../store/useStore'
import { shortPath } from '../lib/format'
import { fleetStatus } from '../lib/copy'
import Buddy, { type Mood } from './Buddy'

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
        <span className="brand-name">Coop</span>
        <span className={`brand-status ${waiting ? 'is-waiting' : ''}`}>{status}</span>
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
          className={`icon-btn ${locked ? '' : 'is-warn'}`}
          title={
            locked
              ? 'Layout locked - click to unlock and rearrange panes (Ctrl+Shift+L)'
              : 'Layout unlocked - drag panes to swap them. Click to lock (Ctrl+Shift+L)'
          }
          onClick={() => {
            setLocked(!locked)
            notify(locked ? 'Layout unlocked — drag panes to rearrange.' : 'Layout locked.')
          }}
        >
          {locked ? '🔒' : '🔓'}
        </button>
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
  const moveSession = useStore((s) => s.moveSession)
  const [editing, setEditing] = useState<string | null>(null)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)

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
            className={`tab ${s.id === activeId ? 'is-active' : ''} ${s.status === 'exited' ? 'is-exited' : ''} ${s.attention ? 'wants-you' : ''} ${dragOver === i && dragFrom !== i ? 'is-drop-target' : ''}`}
            draggable={editing !== s.id}
            onDragStart={(e) => {
              setDragFrom(i)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragOver={(e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              setDragOver(i)
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (dragFrom !== null && dragFrom !== i) moveSession(dragFrom, i)
              setDragFrom(null)
              setDragOver(null)
            }}
            onDragEnd={() => {
              setDragFrom(null)
              setDragOver(null)
            }}
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
