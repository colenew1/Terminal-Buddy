import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ChatEntry } from '@shared/types'

export default function RenameChatButton({ entry }: { entry: ChatEntry }): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  return <span onClick={event => event.stopPropagation()} onDragStart={event => { event.preventDefault(); event.stopPropagation() }}>
    <button className="btn tiny" data-rename-chat={entry.id} onClick={() => setEditing(true)}>Rename</button>
    {editing && createPortal(<RenameChatDialog entry={entry} close={() => setEditing(false)} />, document.body)}
  </span>
}

function RenameChatDialog({ entry, close }: { entry: ChatEntry; close: () => void }): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const pending = useRef(false)
  const [title, setTitle] = useState(entry.title)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { dialog.current?.showModal(); input.current?.select() }, [])
  return <dialog ref={dialog} className="new-session-dialog" aria-label="Rename saved chat"
    onCancel={event => { event.preventDefault(); if (!pending.current) close() }}
    onKeyDown={event => event.stopPropagation()}>
    <form onSubmit={async event => {
      event.preventDefault()
      if (pending.current || !title.trim()) return
      pending.current = true; setBusy(true); setError('')
      try { await window.buddy.catalog.rename(entry.agent, entry.id, title); close() }
      catch (reason) { setError((reason as Error).message) }
      finally { pending.current = false; setBusy(false) }
    }}>
      <h2>Rename saved chat</h2>
      <p>This name appears in Terminal Buddy’s saved chats and when you reopen the conversation.</p>
      <label>Chat name<input ref={input} className="search" data-chat-name value={title} maxLength={100} required disabled={busy} onChange={event => setTitle(event.target.value)} /></label>
      {error && <p role="alert">{error}</p>}
      <div className="new-session-actions">
        <button className="btn" type="button" disabled={busy} onClick={close}>Cancel</button>
        <button className="btn primary" data-save-chat-name type="submit" disabled={busy || !title.trim()}>{busy ? 'Saving…' : 'Save name'}</button>
      </div>
    </form>
  </dialog>
}
