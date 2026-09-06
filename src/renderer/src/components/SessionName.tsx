import { useRef, useState } from 'react'
import { useStore, type Session } from '../store/useStore'
import { focus } from '../lib/terminals'

/** A local, persisted workspace label; never edits an agent's transcript. */
export default function SessionName({ session }: { session: Session }): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const cancelled = useRef(false)
  const finish = (value: string): void => {
    if (!cancelled.current) useStore.getState().renameSession(session.id, value)
    setEditing(false)
    requestAnimationFrame(() => focus(session.id))
  }
  return (
    <span className="session-name" onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      {editing ? <input
        className="session-rename" aria-label="Terminal name" defaultValue={session.title} maxLength={100}
        autoFocus onFocus={(e) => e.target.select()}
        onBlur={(e) => finish(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.blur() }
          if (e.key === 'Escape') { e.preventDefault(); cancelled.current = true; e.currentTarget.blur() }
        }}
      /> : <button className="session-name-button" title="Rename terminal (local label)" onClick={(e) => {
        e.stopPropagation(); cancelled.current = false; setEditing(true)
      }}><span>{session.title}</span><span className="rename-pencil" aria-hidden="true">✎</span></button>}
    </span>
  )
}
