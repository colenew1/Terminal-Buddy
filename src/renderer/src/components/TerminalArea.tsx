import { useEffect, useRef, useState } from 'react'
import TerminalPane from './TerminalPane'
import { useStore } from '../store/useStore'
import { fitAll, focus as focusTerm } from '../lib/terminals'
import { shortPath } from '../lib/format'
import { randomTip } from '../lib/copy'
import Buddy from './Buddy'

/** Roughly square, biased to wider rows — terminals want columns more than lines. */
function gridColumns(n: number): number {
  if (n <= 1) return 1
  return Math.ceil(Math.sqrt(n))
}

export default function TerminalArea(): React.JSX.Element {
  const sessions = useStore((s) => s.sessions)
  const activeId = useStore((s) => s.activeId)
  const layout = useStore((s) => s.layout)
  const locked = useStore((s) => s.locked)
  const setActive = useStore((s) => s.setActive)
  const closeSession = useStore((s) => s.closeSession)
  const openSession = useStore((s) => s.openSession)
  const swapSessions = useStore((s) => s.swapSessions)

  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const dragIdRef = useRef<string | null>(null)

  // Switching layout changes every pane's box at once.
  useEffect(() => {
    const t = requestAnimationFrame(() => fitAll())
    return () => cancelAnimationFrame(t)
  }, [layout, sessions.length])

  useEffect(() => {
    if (activeId && locked) focusTerm(activeId)
  }, [activeId, locked])

  /** Which pane is under the pointer right now. */
  const cellAt = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y)
    return el?.closest<HTMLElement>('.cell')?.dataset.sessionId ?? null
  }

  const onShieldDown = (e: React.PointerEvent, id: string): void => {
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    dragIdRef.current = id
    setDragId(id)
    setOverId(id)
  }

  const onShieldMove = (e: React.PointerEvent): void => {
    if (!dragIdRef.current) return
    setOverId(cellAt(e.clientX, e.clientY))
  }

  const onShieldUp = (e: React.PointerEvent): void => {
    const from = dragIdRef.current
    dragIdRef.current = null
    setDragId(null)
    setOverId(null)
    if (!from) return
    const to = cellAt(e.clientX, e.clientY)
    if (to && to !== from) swapSessions(from, to)
  }

  if (sessions.length === 0) {
    return (
      <div className="empty">
        <div className="empty-card">
          <Buddy mood="asleep" size={72} title="Nothing to do" />
          <h2>Nothing open. I&rsquo;ll wait.</h2>
          <p>Point me at a folder and I&rsquo;ll get a terminal going.</p>
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
              Pick up an old chat
            </button>
          </div>
          <p className="empty-tip">{randomTip()}</p>
        </div>
      </div>
    )
  }

  const cols = gridColumns(sessions.length)

  return (
    <div
      className={`area area-${layout} ${locked ? '' : 'is-unlocked'}`}
      style={layout === 'grid' ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : undefined}
    >
      {sessions.map((s, i) => {
        const active = s.id === activeId
        // In tab mode every pane keeps a full-size box; only visibility changes.
        // That is what lets a hidden pane report real dimensions to its pty.
        const visible = layout === 'grid' || active
        const isDragging = dragId === s.id
        const isTarget = !!dragId && overId === s.id && overId !== dragId
        return (
          <div
            key={s.id}
            data-session-id={s.id}
            className={[
              'cell',
              active ? 'is-active' : '',
              visible ? '' : 'is-stacked',
              isDragging ? 'is-dragging' : '',
              isTarget ? 'is-drop-target' : ''
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {layout === 'grid' && (
              <div
                className="cell-head"
                style={{ ['--critter' as string]: `hsl(${s.critter.hue} 70% 62%)` }}
                onMouseDown={() => locked && setActive(s.id)}
              >
                <span className="cell-critter" title={`the ${s.critter.name}`}>
                  {s.critter.emoji}
                </span>
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

            {/*
              While unlocked, a shield sits over the terminal. It makes dragging
              reliable — xterm would otherwise claim the pointer for selection —
              and it makes the mode unmistakable: panes cannot be typed into.
            */}
            {!locked && visible && (
              <div
                className="cell-shield"
                onPointerDown={(e) => onShieldDown(e, s.id)}
                onPointerMove={onShieldMove}
                onPointerUp={onShieldUp}
                onPointerCancel={onShieldUp}
              >
                <span className="shield-grip">
                  {s.critter.emoji} {s.title}
                </span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
