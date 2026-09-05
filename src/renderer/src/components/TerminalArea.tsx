import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import TerminalPane from './TerminalPane'
import { useStore, type Session } from '../store/useStore'
import { fitAll, focus as focusTerm } from '../lib/terminals'
import { shortPath } from '../lib/format'
import { randomTip } from '../lib/copy'
import { canDrop, getDragItem, type DragItem } from '../lib/dnd'
import { resumeCommandFor, skillLaunchCommand } from '../lib/commands'
import Buddy from './Buddy'
import AgentView from './AgentView'

/** Roughly square, biased to wider rows — terminals want columns more than lines. */
function baseColumns(n: number): number {
  if (n <= 1) return 1
  return Math.ceil(Math.sqrt(n))
}

/** Drop the item into the pane, assuming it has already been judged valid. */
function applyDrop(item: DragItem, session: Session): void {
  const st = useStore.getState()
  const running = st.agents[session.id]

  if (item.kind === 'chat') {
    window.buddy.pty.write(session.id, resumeCommandFor(item.entry) + '\r')
  } else if (running === item.entry.agent) {
    // The agent is already up, so the slash command goes straight in — without
    // a newline, so arguments can still be typed after it.
    window.buddy.pty.write(session.id, `/${item.entry.name}`)
  } else {
    window.buddy.pty.write(session.id, skillLaunchCommand(item.entry) + '\r')
  }
  st.setActive(session.id)
}

export default function TerminalArea(): React.JSX.Element {
  const sessions = useStore((s) => s.sessions)
  const activeId = useStore((s) => s.activeId)
  const layout = useStore((s) => s.layout)
  const locked = useStore((s) => s.locked)
  const agents = useStore((s) => s.agents)
  const rawPanes = useStore((s) => s.rawPanes)
  const devMode = useStore((s) => s.settings.devMode)
  const toggleRaw = useStore((s) => s.toggleRaw)
  const reduceMotion = useStore((s) => s.settings.reduceMotion)
  const setActive = useStore((s) => s.setActive)
  const closeSession = useStore((s) => s.closeSession)
  const openSession = useStore((s) => s.openSession)

  const areaRef = useRef<HTMLDivElement>(null)
  const [compact, setCompact] = useState<Record<string, boolean>>({})
  const [dragId, setDragId] = useState<string | null>(null)
  const dragIdRef = useRef<string | null>(null)
  const [itemDrag, setItemDrag] = useState<DragItem | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const resizing = useRef<{
    id: string
    x: number
    y: number
    unitW: number
    unitH: number
    from: { cols: number; rows: number }
  } | null>(null)

  useEffect(() => {
    const t = requestAnimationFrame(() => fitAll())
    return () => cancelAnimationFrame(t)
  }, [layout, sessions.length])

  useEffect(() => {
    if (activeId && locked) focusTerm(activeId)
  }, [activeId, locked])

  // A catalog drag ends on the sidebar row, so listen globally to clear up.
  useEffect(() => {
    const clear = (): void => {
      setItemDrag(null)
      setHoverId(null)
    }
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    return () => {
      window.removeEventListener('dragend', clear)
      window.removeEventListener('drop', clear)
    }
  }, [])

  /*
   * FLIP: remember where every pane was, and after the grid reflows, start each
   * one back at its old position and let it slide to the new one. Without this
   * a reorder teleports and it is genuinely hard to see what moved.
   */
  const lastRects = useRef(new Map<string, DOMRect>())
  useLayoutEffect(() => {
    const area = areaRef.current
    if (!area) return
    const cells = area.querySelectorAll<HTMLElement>('.cell')

    for (const cell of cells) {
      const id = cell.dataset.sessionId
      if (!id) continue
      const now = cell.getBoundingClientRect()
      const prev = lastRects.current.get(id)
      lastRects.current.set(id, now)

      if (reduceMotion || !prev) continue
      const dx = prev.left - now.left
      const dy = prev.top - now.top
      const sameSize = Math.abs(prev.width - now.width) < 1 && Math.abs(prev.height - now.height) < 1
      if ((Math.abs(dx) < 1 && Math.abs(dy) < 1) || !sameSize) continue

      cell.style.transition = 'none'
      cell.style.transform = `translate(${dx}px, ${dy}px)`
      requestAnimationFrame(() => {
        cell.style.transition = 'transform 280ms cubic-bezier(0.2, 0.9, 0.25, 1)'
        cell.style.transform = ''
      })
    }

    // Forget panes that have closed, so a reused slot doesn't animate from one.
    const live = new Set([...cells].map((c) => c.dataset.sessionId))
    for (const id of lastRects.current.keys()) if (!live.has(id)) lastRects.current.delete(id)
  })

  /*
   * Below a certain size a conversation is illegible, so the tile collapses to
   * just its name. Measured rather than derived from the span, because the grid
   * and the window both change the answer.
   */
  useEffect(() => {
    const area = areaRef.current
    if (!area) return
    const ro = new ResizeObserver((entries) => {
      setCompact((prev) => {
        const next = { ...prev }
        let changed = false
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.sessionId
          if (!id) continue
          const r = entry.contentRect
          const small = r.width < 260 || r.height < 170
          if (next[id] !== small) {
            next[id] = small
            changed = true
          }
        }
        return changed ? next : prev
      })
    })
    for (const cell of area.querySelectorAll<HTMLElement>('.cell')) ro.observe(cell)
    return () => ro.disconnect()
  }, [sessions.length, layout])

  const cellAt = (x: number, y: number): string | null =>
    document.elementFromPoint(x, y)?.closest<HTMLElement>('.cell')?.dataset.sessionId ?? null

  /* ------------------------------------------------------ pane drag (unlocked) */

  const onShieldDown = (e: React.PointerEvent, id: string): void => {
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    dragIdRef.current = id
    setDragId(id)
  }

  const onShieldMove = (e: React.PointerEvent): void => {
    const from = dragIdRef.current
    if (!from) return
    const overId = cellAt(e.clientX, e.clientY)
    if (!overId || overId === from) return
    // Reorder live rather than on drop, so the other panes visibly make room.
    const st = useStore.getState()
    const fromIdx = st.sessions.findIndex((s) => s.id === from)
    const toIdx = st.sessions.findIndex((s) => s.id === overId)
    if (fromIdx >= 0 && toIdx >= 0) st.moveSession(fromIdx, toIdx)
  }

  const onShieldUp = (): void => {
    dragIdRef.current = null
    setDragId(null)
  }

  /* ---------------------------------------------------------------- resizing */

  const onResizeDown = (e: React.PointerEvent, s: Session): void => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const rect = (e.currentTarget as HTMLElement).closest('.cell')!.getBoundingClientRect()
    resizing.current = {
      id: s.id,
      x: e.clientX,
      y: e.clientY,
      unitW: rect.width / s.span.cols,
      unitH: rect.height / s.span.rows,
      from: { ...s.span }
    }
  }

  const onResizeMove = (e: React.PointerEvent): void => {
    const r = resizing.current
    if (!r) return
    const st = useStore.getState()
    const s = st.sessions.find((x) => x.id === r.id)
    if (!s) return
    // Always measured from where the drag began. Re-anchoring after each step
    // compounds, so a single cell of travel could jump several sizes.
    const cols = r.from.cols + Math.round((e.clientX - r.x) / r.unitW)
    const rows = r.from.rows + Math.round((e.clientY - r.y) / r.unitH)
    if (cols !== s.span.cols || rows !== s.span.rows) st.setSpan(r.id, { cols, rows })
  }

  const onResizeUp = (): void => {
    resizing.current = null
  }

  /* ------------------------------------------------------------------ render */

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

  const cols = Math.max(baseColumns(sessions.length), ...sessions.map((s) => s.span.cols))

  return (
    <div
      ref={areaRef}
      className={[
        'area',
        `area-${layout}`,
        locked ? '' : 'is-unlocked',
        itemDrag ? 'is-item-drag' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      style={layout === 'grid' ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : undefined}
      onDragEnter={() => {
        const item = getDragItem()
        if (item) setItemDrag(item)
      }}
    >
      {sessions.map((s, i) => {
        const active = s.id === activeId
        const visible = layout === 'grid' || active
        const isDragging = dragId === s.id
        const verdict = itemDrag ? canDrop(itemDrag, s, agents[s.id]) : null
        const hovered = hoverId === s.id

        return (
          <div
            key={s.id}
            data-session-id={s.id}
            className={[
              'cell',
              active ? 'is-active' : '',
              visible ? '' : 'is-stacked',
              isDragging ? 'is-dragging' : '',
              verdict ? (verdict.ok ? 'can-drop' : 'cannot-drop') : '',
              hovered && verdict?.ok ? 'is-drop-target' : ''
            ]
              .filter(Boolean)
              .join(' ')}
            style={
              layout === 'grid'
                ? {
                    gridColumn: `span ${Math.min(s.span.cols, cols)}`,
                    gridRow: `span ${s.span.rows}`,
                    ['--critter' as string]: `hsl(${s.critter.hue} 70% 62%)`
                  }
                : undefined
            }
            onDragOver={(e) => {
              // Read the live drag rather than `itemDrag`: dragenter's state
              // update has not necessarily rendered by the first dragover, and
              // guarding on stale state drops the hover entirely.
              const item = getDragItem()
              if (!item) return
              e.preventDefault()
              if (!itemDrag) setItemDrag(item)
              e.dataTransfer.dropEffect = canDrop(item, s, agents[s.id]).ok ? 'copy' : 'none'
              if (hoverId !== s.id) setHoverId(s.id)
            }}
            onDragLeave={() => setHoverId((h) => (h === s.id ? null : h))}
            onDrop={(e) => {
              e.preventDefault()
              const item = getDragItem() ?? itemDrag
              setItemDrag(null)
              setHoverId(null)
              if (!item) return
              const v = canDrop(item, s, useStore.getState().agents[s.id])
              useStore.getState().notify(v.reason)
              if (v.ok) applyDrop(item, s)
            }}
          >
            {layout === 'grid' && (
              <div className="cell-head" onMouseDown={() => locked && setActive(s.id)}>
                <span className="cell-critter" title={`the ${s.critter.name}`}>
                  {s.critter.emoji}
                </span>
                <span className="cell-index">{i + 1}</span>
                <span className="cell-title" title={s.cwd}>
                  {s.title}
                </span>
                {agents[s.id] && <span className={`badge ${agents[s.id]}`}>{agents[s.id]}</span>}
                <span className="cell-path">{shortPath(s.cwd, 2)}</span>
                {s.attention && <span className="dot attention" title="Waiting on you" />}
                <button
                  className={`icon-btn tiny ${rawPanes[s.id] ? 'is-on' : ''}`}
                  title={rawPanes[s.id] ? 'Back to the conversation' : 'Show the raw terminal'}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleRaw(s.id)
                  }}
                >
                  {'</>'}
                </button>
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

            {/*
              The terminal stays mounted underneath so its scrollback and sizing
              survive; the conversation simply covers it. Dev mode lifts the lid.
              Both live in a body box so neither hides the card header.
            */}
            <div className="cell-body">
              <TerminalPane session={s} visible={visible} />
              {visible && !(devMode || rawPanes[s.id]) && (
                <AgentView session={s} compact={!!compact[s.id]} />
              )}
            </div>

            {/* While unlocked, a shield keeps xterm from claiming the pointer. */}
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
                {layout === 'grid' && (
                  <span className="shield-size">
                    {s.span.cols}×{s.span.rows}
                  </span>
                )}
              </div>
            )}

            {!locked && visible && layout === 'grid' && (
              <div
                className="cell-resize"
                title="Drag to resize this pane"
                onPointerDown={(e) => onResizeDown(e, s)}
                onPointerMove={onResizeMove}
                onPointerUp={onResizeUp}
                onPointerCancel={onResizeUp}
              />
            )}

            {verdict && hovered && <div className="drop-hint">{verdict.reason}</div>}
          </div>
        )
      })}
    </div>
  )
}
