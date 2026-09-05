import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import TerminalPane from './TerminalPane'
import GridDividers from './GridDividers'
import { gridWeights } from '../lib/grid-sizing'
import { useStore, type Session } from '../store/useStore'
import { fitAll, focus as focusTerm } from '../lib/terminals'
import { shortPath } from '../lib/format'
import { randomTip } from '../lib/copy'
import { canDrop, getDragItem, type DragItem } from '../lib/dnd'
import { resumeChat, skillLaunchCommand } from '../lib/commands'
import Buddy from './Buddy'
import TerminalStatus from './TerminalStatus'
import SessionName from './SessionName'
import { beginTerminalDrag } from '../lib/terminal-drag'

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
    void resumeChat(item.entry, session.id)
    return
  } else if (running === item.entry.agent) {
    st.markInput(session.id)
    // The agent is already up, so the slash command goes straight in — without
    // a newline, so arguments can still be typed after it.
    window.buddy.pty.write(session.id, `/${item.entry.name}`)
  } else {
    st.markInput(session.id)
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
  const gridSizes = useStore((s) => s.gridSizes)
  const reduceMotion = useStore((s) => s.settings.reduceMotion)
  const setActive = useStore((s) => s.setActive)
  const closeSession = useStore((s) => s.closeSession)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const paletteOpen = useStore((s) => s.paletteOpen)
  const transferBusy = useStore(s => s.transferBusy || !!s.moveSessionId || s.presetsOpen)
  const pendingCloseId = useStore((s) => s.pendingCloseId)
  const newSessionOpen = useStore((s) => s.newSessionOpen)
  const restoring = useStore((s) => !!s.restoreItems || s.restoring)
  const walkthroughOpen = useStore((s) => s.walkthroughOpen)
  const linkSessionId = useStore((s) => s.linkSessionId)
  const focusedSessionId = useStore((s) => s.focusedSessionId)
  const focused = sessions.some((s) => s.id === focusedSessionId && !s.detached)
  const toggleFocus = (id: string): void => {
    if (sessions.find((s) => s.id === id)?.detached) return
    setActive(id)
    useStore.setState({ focusedSessionId: focusedSessionId === id ? null : id })
  }

  const areaRef = useRef<HTMLDivElement>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const dragIdRef = useRef<string | null>(null)
  const [itemDrag, setItemDrag] = useState<DragItem | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)

  useEffect(() => {
    const t = requestAnimationFrame(() => fitAll())
    return () => cancelAnimationFrame(t)
  }, [layout, sessions.length, focusedSessionId])

  useEffect(() => {
    if (!activeId || sessions.find((s) => s.id === activeId)?.detached || (!locked && !focused) || settingsOpen || paletteOpen || transferBusy || pendingCloseId || newSessionOpen || restoring || walkthroughOpen || linkSessionId) return
    const cell = [...(areaRef.current?.querySelectorAll<HTMLElement>('.cell') ?? [])]
      .find((el) => el.dataset.sessionId === activeId)
    if (!cell) return
    const activeElement = document.activeElement
    if (cell.contains(activeElement) && activeElement?.closest('.session-name')) return
    if (!cell.contains(activeElement) || !activeElement?.classList.contains('xterm-helper-textarea')) focusTerm(activeId)
  }, [activeId, locked, layout, settingsOpen, paletteOpen, transferBusy, pendingCloseId, newSessionOpen, restoring, walkthroughOpen, linkSessionId, focusedSessionId, sessions.some((s) => s.id === activeId && s.detached)])

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

  const onShieldUp = (event?: React.PointerEvent): void => {
    const id = dragIdRef.current
    dragIdRef.current = null
    setDragId(null)
    if (id && event && (event.clientX < 0 || event.clientX > innerWidth || event.clientY < 0 || event.clientY > innerHeight)) {
      void useStore.getState().detachSession(id, { x: event.screenX, y: event.screenY })
    }
  }

  /* ------------------------------------------------------------------ render */

  if (sessions.length === 0) {
    return (
      <div className="empty">
        <div className="empty-card">
          <Buddy mood="asleep" size={72} title="Nothing to do" />
          <h2>Nothing open. I&rsquo;ll wait.</h2>
          <p>Pick a chat, start a new one, or open a fresh terminal.</p>
          <div className="empty-actions">
            <button
              className="btn primary"
              onClick={() => useStore.getState().setNewSessionOpen(true)}
            >
              Open something…
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

  const cols = baseColumns(sessions.length)
  const rows = Math.ceil(sessions.length / cols)
  const columnWeights = gridWeights(cols, gridSizes.columns)
  const rowWeights = gridWeights(rows, gridSizes.rows)

  return (
    <div
      ref={areaRef}
      className={[
        'area',
        layout === 'grid' && !focused ? 'area-grid' : 'area-tabs',
        locked || focused ? '' : 'is-unlocked',
        itemDrag ? 'is-item-drag' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      style={layout === 'grid' && !focused ? {
        // Large fr factors prevent CSS's sub-1fr partial-fill behavior when a neighbor reaches its minimum.
        gridTemplateColumns: columnWeights.map((n) => `minmax(min(160px, calc((100% - ${(cols - 1) * 8}px) / ${cols})), ${n * 1000}fr)`).join(' '),
        gridTemplateRows: rowWeights.map((n) => `minmax(min(110px, calc((100% - ${(rows - 1) * 8}px) / ${rows})), ${n * 1000}fr)`).join(' ')
      } : undefined}
      onDragEnter={() => {
        const item = getDragItem()
        if (item) setItemDrag(item)
      }}
    >
      {sessions.map((s, i) => {
        const active = s.id === activeId
        const visible = focused ? s.id === focusedSessionId : layout === 'grid' || active
        const isDragging = dragId === s.id
        const verdict = itemDrag ? canDrop(itemDrag, s, agents[s.id]) : null
        const hovered = hoverId === s.id

        return (
          <div
            key={s.id}
            inert={!visible}
            onPointerDownCapture={() => { if (s.attention) setActive(s.id) }}
            data-session-id={s.id}
            className={[
              'cell',
              active ? 'is-active' : '',
              s.attention ? 'needs-look' : '',
              visible ? '' : 'is-stacked',
              isDragging ? 'is-dragging' : '',
              verdict ? (verdict.ok ? 'can-drop' : 'cannot-drop') : '',
              hovered && verdict?.ok ? 'is-drop-target' : ''
            ]
              .filter(Boolean)
              .join(' ')}
            style={
              layout === 'grid' && !focused
                ? {
                    gridColumn: i % cols + 1,
                    gridRow: Math.floor(i / cols) + 1,
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
            {(
              <div className="cell-head" onDoubleClick={(event) => {
                if (!(event.target as HTMLElement).closest('button, input')) toggleFocus(s.id)
              }} onPointerDown={(event) => beginTerminalDrag(event, s.id)} onMouseDown={() => locked && setActive(s.id)} title="Double-click empty header space to focus. Drag outside the app to pop out.">
                <span className="cell-critter" title={`the ${s.critter.name}`}>
                  {s.critter.emoji}
                </span>
                <span className="cell-index">{i + 1}</span>
                <SessionName session={s} />
                {agents[s.id] && <span className={`badge ${agents[s.id]}`}>{agents[s.id]}</span>}
                <span className="cell-path">{shortPath(s.cwd, 2)}</span>
                {s.attention && <span className="dot attention" title="Output paused — check the terminal prompt" />}
                <TerminalStatus session={s} />
                <button className="icon-btn tiny recovery-link" data-link-session={s.id}
                  title={s.resume ? `Recovery linked to ${s.resume.agent} ${s.resume.id}. Click to review.` : 'Link a saved chat for recovery. Plain terminals reopen their folder only.'}
                  onClick={() => useStore.setState({ linkSessionId: s.id })}>{s.resume ? 'Linked' : 'Link chat'}</button>
                {!s.detached && <button className="icon-btn tiny" data-focus-session={s.id}
                  title={focused ? 'Return to layout (Escape)' : 'Focus terminal (double-click header)'}
                  onClick={() => toggleFocus(s.id)}>{focused ? '↙' : '⛶'}</button>}
                <button className="icon-btn tiny" data-move-session={s.id} title="Move terminal to another window" onClick={() => useStore.setState({ moveSessionId: s.id })}>⇥</button>
                <button className="icon-btn tiny" data-popout={s.id} title={s.detached ? 'Show popped-out terminal' : 'Pop out terminal'}
                  onClick={() => void useStore.getState().detachSession(s.id)}>↗</button>
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

            {/* The native terminal is the only input surface. */}
            <div className="cell-body">
              <TerminalPane
                session={s}
                visible={visible && !s.detached}
                interactive={visible && !s.detached && !transferBusy && (locked || focused)}
              />
              {s.detached && <div className="detached-placeholder"><span>{s.critter.emoji}</span><strong>Open in its own window</strong>
                <button className="btn" onClick={() => window.buddy.popout.focus(s.id)}>Show window ↗</button>
                <button className="btn" onClick={() => window.buddy.popout.dock(s.id)}>Dock back ↙</button></div>}
            </div>

            {/* While unlocked, a shield keeps xterm from claiming the pointer. */}
            {!locked && !focused && visible && !s.detached && (
              <div
                className="cell-shield"
                onPointerDown={(e) => onShieldDown(e, s.id)}
                onPointerMove={onShieldMove}
                onPointerUp={onShieldUp}
                onPointerCancel={() => onShieldUp()}
              >
                <span className="shield-grip">
                  {s.critter.emoji} {s.title}
                </span>
                {layout === 'grid' && (
                  <span className="shield-help">Drag pane to move · drag dividers to resize</span>
                )}
              </div>
            )}


            {verdict && hovered && <div className="drop-hint">{verdict.reason}</div>}
          </div>
        )
      })}
      {!locked && !focused && layout === 'grid' && <GridDividers columns={columnWeights} rows={rowWeights} />}
    </div>
  )
}
