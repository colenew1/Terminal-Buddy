import { useEffect, useRef, useState } from 'react'
import { useStore, type Session, type ToolStat } from '../store/useStore'
import { canDrop, getDragItem } from '../lib/dnd'
import { resumeChat, skillLaunchCommand } from '../lib/commands'
import SessionName from './SessionName'

/**
 * A spatial fleet view: sessions are recognizable inhabitants, not tiny panes.
 * A satellite means a tool or MCP server was observed in this live transcript;
 * it does not pretend that reading configuration proves a live connection.
 */

const ORB = 116
const EDGE = 92

function satellitePos(i: number, total: number): { left: string; top: string } {
  const spread = Math.min(total, 6)
  const a = -Math.PI * 0.9 + (i / Math.max(1, spread - 1)) * Math.PI * 0.8
  const r = ORB * 0.78
  return {
    left: `calc(50% + ${Math.cos(a) * r}px)`,
    top: `calc(50% + ${Math.sin(a) * r}px)`
  }
}

function Satellite({ stat }: { stat: ToolStat }): React.JSX.Element {
  return (
    <span
      className={`sat ${stat.mcp ? 'is-mcp' : ''}`}
      title={stat.mcp ? `MCP server “${stat.mcp}” — observed ${stat.count}×` : `${stat.label} — observed ${stat.count}×`}
    >
      <span aria-hidden="true">{stat.mcp ? '⌁' : '·'}</span>
      {stat.label}
      {stat.count > 1 && <b>{stat.count}</b>}
    </span>
  )
}

function stateLabel(s: Session): string {
  if (s.status === 'exited') return 'exited'
  if (s.attention) return 'may need you'
  if (s.busy) return 'working'
  return 'quiet'
}

export default function WorldView(): React.JSX.Element {
  const sessions = useStore((s) => s.sessions)
  const activeId = useStore((s) => s.activeId)
  const toolStats = useStore((s) => s.toolStats)
  const agents = useStore((s) => s.agents)
  const feeds = useStore((s) => s.feeds)
  const settings = useStore((s) => s.settings)
  const setActive = useStore((s) => s.setActive)
  const setPos = useStore((s) => s.setPos)
  const setNewSessionOpen = useStore((s) => s.setNewSessionOpen)
  const notify = useStore((s) => s.notify)

  const floorRef = useRef<HTMLDivElement>(null)
  const setOpen = (id: string): void => {
    setActive(id)
    const store = useStore.getState()
    store.setLayout('tabs')
  }
  const knownIds = useRef(new Set(sessions.map((s) => s.id)))
  useEffect(() => {
    if (activeId && !knownIds.current.has(activeId)) setOpen(activeId)
    knownIds.current = new Set(sessions.map((s) => s.id))
  }, [sessions, activeId])
  const [hoverId, setHoverId] = useState<string | null>(null)
  const drag = useRef<{
    id: string
    pointerId: number
    dx: number
    dy: number
    startX: number
    startY: number
    moved: boolean
  } | null>(null)

  const pointOnFloor = (e: React.PointerEvent): { x: number; y: number } => {
    const rect = floorRef.current?.getBoundingClientRect()
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) }
  }

  const onDown = (e: React.PointerEvent, s: Session): void => {
    if (e.button !== 0) return
    e.preventDefault()
    const p = pointOnFloor(e)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = {
      id: s.id,
      pointerId: e.pointerId,
      dx: p.x - s.pos.x,
      dy: p.y - s.pos.y,
      startX: e.clientX,
      startY: e.clientY,
      moved: false
    }
    setActive(s.id)
  }

  const onMove = (e: React.PointerEvent): void => {
    const d = drag.current
    const floor = floorRef.current
    if (!d || !floor || d.pointerId !== e.pointerId) return
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 4) d.moved = true
    const p = pointOnFloor(e)
    setPos(d.id, {
      x: Math.max(EDGE, Math.min(floor.clientWidth - EDGE, p.x - d.dx)),
      y: Math.max(EDGE, Math.min(floor.clientHeight - EDGE, p.y - d.dy))
    })
  }

  const onUp = (e: React.PointerEvent): void => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    drag.current = null
    if (!d.moved) setOpen(d.id)
  }

  const dropOn = (s: Session): void => {
    const item = getDragItem()
    if (!item) return
    const verdict = canDrop(item, s, agents[s.id])
    notify(verdict.reason)
    if (!verdict.ok) return
    if (item.kind === 'chat') {
      void resumeChat(item.entry, s.id).then((id) => { if (id) setOpen(id) })
      return
    }
    useStore.getState().markInput(s.id)
    if (agents[s.id] === item.entry.agent) window.buddy.pty.write(s.id, `/${item.entry.name}`)
    else window.buddy.pty.write(s.id, skillLaunchCommand(item.entry) + '\r')
    setActive(s.id)
  }

  const arrange = (): void => {
    const floor = floorRef.current
    if (!floor) return
    const cx = floor.clientWidth / 2
    const cy = floor.clientHeight / 2 + 28
    const golden = 2.399963
    sessions.forEach((s, i) => {
      const r = sessions.length === 1 ? 0 : 96 + 62 * Math.sqrt(i)
      setPos(s.id, {
        x: Math.max(EDGE, Math.min(floor.clientWidth - EDGE, cx + Math.cos(i * golden) * r)),
        y: Math.max(EDGE, Math.min(floor.clientHeight - EDGE, cy + Math.sin(i * golden) * r))
      })
    })
  }

  const busy = sessions.filter((s) => s.busy).length
  const waiting = sessions.filter((s) => s.attention).length

  return (
    <section className={`world ${settings.reduceMotion ? 'no-drift' : ''}`} aria-label="Terminal world">
      <div className="world-hud">
        <div className="world-intro">
          <span className="world-kicker">Your terminal world</span>
          <span className="world-help">Drag to arrange · click one to open its terminal</span>
        </div>
        <div className="world-legend" aria-label={`${busy} working and ${waiting} may need you`}>
          <span><i className="world-dot is-working" />{busy} working</span>
          <span><i className="world-dot is-waiting" />{waiting} need a look</span>
          <span><i className="world-dot is-observed" />satellites = observed tools</span>
        </div>
        <div className="world-actions">
          <button className="btn tiny" onClick={arrange}>Gather</button>
          <button className="btn tiny primary" onClick={() => setNewSessionOpen(true)}>+ New</button>
        </div>
      </div>

      <div className="world-scroll">
        <div className="world-floor" ref={floorRef}>
          {sessions.map((s, i) => {
            const stats = toolStats[s.id] ?? []
            const said = feeds[s.id]?.filter((e) => e.role === 'user' || e.role === 'assistant').length ?? 0
            const item = getDragItem()
            const verdict = item ? canDrop(item, s, agents[s.id]) : null
            const state = s.status === 'exited' ? 'gone' : s.attention ? 'waving' : s.busy ? 'thinking' : 'idle'
            const avatar = settings.critters
              ? s.critter.emoji
              : agents[s.id] === 'claude'
                ? 'C'
                : agents[s.id] === 'codex'
                  ? 'X'
                  : '>_'

            return (
              <div
                key={s.id}
                data-session-id={s.id}
                className={[
                  'orb',
                  `is-${state}`,
                  s.id === activeId ? 'is-active' : '',
                  hoverId === s.id && verdict ? (verdict.ok ? 'can-drop' : 'cannot-drop') : ''
                ].filter(Boolean).join(' ')}
                style={{
                  left: s.pos.x,
                  top: s.pos.y,
                  ['--critter' as string]: `hsl(${s.critter.hue} 70% 62%)`,
                  ['--drift' as string]: `${(i % 5) * 0.7 + 3.4}s`,
                  ['--delay' as string]: `${(i % 7) * -0.35}s`
                }}
                role="button"
                tabIndex={0}
                aria-label={`${s.title}, ${stateLabel(s)}. Click to open.`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setActive(s.id)
                    setOpen(s.id)
                  }
                }}
                onPointerDown={(e) => onDown(e, s)}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={() => { drag.current = null }}
                onDragOver={(e) => {
                  if (!getDragItem()) return
                  e.preventDefault()
                  setHoverId(s.id)
                }}
                onDragLeave={() => setHoverId((h) => (h === s.id ? null : h))}
                onDrop={(e) => {
                  e.preventDefault()
                  setHoverId(null)
                  dropOn(s)
                }}
              >
                <div className="orb-sats" aria-label={stats.length ? 'Observed tools' : undefined}>
                  {stats.slice(0, 6).map((t, si) => (
                    <span key={t.key} className="sat-slot" style={satellitePos(si, stats.length)}>
                      <Satellite stat={t} />
                    </span>
                  ))}
                </div>

                <div className="orb-ring" />
                <div className="orb-body">
                  <span className={`orb-critter ${settings.critters ? '' : 'is-glyph'}`}>{avatar}</span>
                  {state === 'waving' && <span className="orb-wave" aria-hidden="true">👋</span>}
                </div>

                <div className="orb-label">
                  <SessionName session={s} />
                  <span className="orb-status">{stateLabel(s)}</span>
                  <span className="orb-meta">
                    {agents[s.id] ? (
                      <span className={`badge ${agents[s.id]}`}>{agents[s.id]}</span>
                    ) : (
                      <span className="orb-shell">{s.shellLabel}</span>
                    )}
                    {said > 0 && <span className="orb-turns">{said} turns</span>}
                  </span>
                </div>

                {verdict && hoverId === s.id && <div className="orb-hint">{verdict.reason}</div>}
              </div>
            )
          })}
        </div>
      </div>

    </section>
  )
}
