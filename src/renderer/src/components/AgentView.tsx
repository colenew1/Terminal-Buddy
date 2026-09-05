import { useEffect, useMemo, useRef, useState } from 'react'
import type { SkillEntry } from '@shared/types'
import { useStore, type Session } from '../store/useStore'
import { getDragItem } from '../lib/dnd'

/**
 * The conversation view: what a pane looks like when it is running an agent.
 *
 * Everything here comes from the agent's own transcript (see main/session-feed),
 * so tool calls read as "Opened src/index.ts" rather than as the command that
 * produced them. The terminal is still underneath — it is just not the thing
 * you look at.
 */

interface Props {
  session: Session
  compact: boolean
}

export default function AgentView({ session, compact }: Props): React.JSX.Element {
  const events = useStore((s) => s.feeds[session.id]) ?? []
  const agent = useStore((s) => s.agents[session.id])
  const catalog = useStore((s) => s.catalog)
  const send = useStore((s) => s.send)
  const notify = useStore((s) => s.notify)

  const [draft, setDraft] = useState('')
  const [picking, setPicking] = useState(false)
  const [skillQuery, setSkillQuery] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const pinned = useRef(true)

  // Follow the conversation, unless you have scrolled up to read something.
  useEffect(() => {
    const el = scroller.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [events.length])

  const skills = useMemo(() => {
    const all = (catalog?.skills ?? []).filter((s) => !agent || s.agent === agent)
    const q = skillQuery.trim().toLowerCase()
    return (q ? all.filter((s) => s.name.toLowerCase().includes(q)) : all).slice(0, 40)
  }, [catalog, agent, skillQuery])

  const submit = (): void => {
    if (!draft.trim()) return
    send(session.id, draft)
    setDraft('')
  }

  const insertSkill = (s: SkillEntry): void => {
    setDraft((d) => (d ? `${d.trimEnd()} /${s.name} ` : `/${s.name} `))
    setPicking(false)
    setSkillQuery('')
    inputRef.current?.focus()
  }

  // Tiny tiles are unreadable as conversation, so they say who they are instead.
  if (compact) {
    return (
      <div className="agent compact">
        <span className="compact-critter">{session.critter.emoji}</span>
        <span className="compact-title">{session.title}</span>
        {session.attention && <span className="dot attention" />}
      </div>
    )
  }

  return (
    <div className="agent">
      <div
        className="agent-scroll"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
        }}
      >
        {events.length === 0 && (
          <div className="agent-empty">
            {agent ? (
              <>
                <p>Listening to {agent}.</p>
                <span>Anything it says will appear here.</span>
              </>
            ) : (
              <>
                <p>Nothing running here yet.</p>
                <span>Say something below, or drop a chat or skill on this card.</span>
              </>
            )}
          </div>
        )}

        {events.map((e) => {
          if (e.role === 'tool') {
            return (
              <div key={e.id} className="turn-tool">
                <span className="tool-verb">{e.tool}</span>
                {e.text && <span className="tool-detail">{e.text}</span>}
              </div>
            )
          }
          return (
            <div key={e.id} className={`bubble ${e.role}`}>
              <div className="bubble-who">{e.role === 'user' ? 'You' : (agent ?? 'agent')}</div>
              <div className="bubble-text">{e.text}</div>
            </div>
          )
        })}
      </div>

      {picking && (
        <div className="skill-picker">
          <input
            autoFocus
            className="search"
            placeholder="Find a skill…"
            value={skillQuery}
            onChange={(e) => setSkillQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setPicking(false)
              if (e.key === 'Enter' && skills[0]) insertSkill(skills[0])
            }}
          />
          <div className="skill-chips">
            {skills.length === 0 && <span className="hint">No matching skills.</span>}
            {skills.map((s) => (
              <button key={s.id} className="chip" title={s.description} onClick={() => insertSkill(s)}>
                <span className={`chip-dot ${s.agent}`} />
                {s.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div
        className="composer"
        onDragOver={(e) => {
          if (getDragItem()?.kind === 'skill') e.preventDefault()
        }}
        onDrop={(e) => {
          const item = getDragItem()
          if (item?.kind !== 'skill') return
          e.preventDefault()
          e.stopPropagation()
          insertSkill(item.entry)
        }}
      >
        <button
          className="composer-skill"
          title="Add a skill"
          onClick={() => {
            if (!catalog?.skills.length) return notify('No skills indexed yet — try Rescan in the catalog.')
            setPicking((p) => !p)
          }}
        >
          ✦
        </button>
        <textarea
          ref={inputRef}
          className="composer-input"
          rows={1}
          placeholder={agent ? `Say something to ${agent}…` : 'Type a command or a message…'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter makes a new line.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <button className="composer-send" onClick={submit} disabled={!draft.trim()} title="Send (Enter)">
          ↵
        </button>
      </div>
    </div>
  )
}
