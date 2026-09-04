import { useEffect } from 'react'
import TerminalPane from './TerminalPane'
import { useStore } from '../store/useStore'
import { fitAll, focus as focusTerm } from '../lib/terminals'
import { shortPath } from '../lib/format'

/** Roughly square, biased to wider rows — terminals want columns more than lines. */
function gridColumns(n: number): number {
  if (n <= 1) return 1
  return Math.ceil(Math.sqrt(n))
}

export default function TerminalArea(): React.JSX.Element {
  const sessions = useStore((s) => s.sessions)
  const activeId = useStore((s) => s.activeId)
  const layout = useStore((s) => s.layout)
  const setActive = useStore((s) => s.setActive)
  const closeSession = useStore((s) => s.closeSession)
  const openSession = useStore((s) => s.openSession)

  // Switching layout changes every pane's box at once.
  useEffect(() => {
    const t = requestAnimationFrame(() => fitAll())
    return () => cancelAnimationFrame(t)
  }, [layout, sessions.length])

  useEffect(() => {
    if (activeId) focusTerm(activeId)
  }, [activeId])

  if (sessions.length === 0) {
    return (
      <div className="empty">
        <div className="empty-card">
          <h2>No terminals open</h2>
          <p>
            Open a folder, or right-click any folder in Explorer and choose <b>Open in Buddy</b>.
          </p>
          <div className="empty-actions">
            <button
              className="btn primary"
              onClick={async () => {
                const dir = await window.buddy.app.pickFolder()
                if (dir) void openSession({ cwd: dir })
              }}
            >
              Open folder…
            </button>
            <button className="btn" onClick={() => useStore.getState().setSidebar(true, 'chats')}>
              Browse chats
            </button>
          </div>
        </div>
      </div>
    )
  }

  const cols = gridColumns(sessions.length)

  return (
    <div
      className={`area area-${layout}`}
      style={layout === 'grid' ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : undefined}
    >
      {sessions.map((s, i) => {
        const active = s.id === activeId
        // In tab mode every pane keeps a full-size box; only visibility changes.
        // That is what lets a hidden pane report real dimensions to its pty.
        const visible = layout === 'grid' || active
        return (
          <div key={s.id} className={`cell ${active ? 'is-active' : ''} ${visible ? '' : 'is-stacked'}`}>
            {layout === 'grid' && (
              <div className="cell-head" onMouseDown={() => setActive(s.id)}>
                <span className="cell-index">{i + 1}</span>
                <span className="cell-title" title={s.cwd}>
                  {s.title}
                </span>
                <span className="cell-path">{shortPath(s.cwd, 2)}</span>
                {s.attention && <span className="dot attention" title="Waiting on you" />}
                <button
                  className="icon-btn tiny"
                  title="Close terminal"
                  onClick={(e) => {
                    e.stopPropagation()
                    closeSession(s.id)
                  }}
                >
                  ✕
                </button>
              </div>
            )}
            <TerminalPane session={s} visible={visible} />
          </div>
        )
      })}
    </div>
  )
}
