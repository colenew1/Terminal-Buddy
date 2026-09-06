import { useEffect, useRef, useState } from 'react'
import type { RestoreItem } from '@shared/types'
import { useStore } from '../store/useStore'
import Buddy from './Buddy'

export default function RestoreSessionDialog({ items }: { items: RestoreItem[] }): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const busy = useStore((s) => s.restoring)
  const [choosing, setChoosing] = useState(false)
  const available = items.filter((item) => item.available).map((item) => item.index)
  const [selected, setSelected] = useState(available)
  useEffect(() => {
    const node = dialog.current!
    // Native cancel must be stopped synchronously; React's delegated handler
    // can run after Chromium has already closed a modal on Escape.
    const keepOpen = (event: Event): void => event.preventDefault()
    node.addEventListener('cancel', keepOpen)
    node.showModal()
    return () => node.removeEventListener('cancel', keepOpen)
  }, [])
  return (
    <dialog ref={dialog} className="new-session-dialog restore-session-dialog" aria-labelledby="restore-title"
      onCancel={(event) => event.preventDefault()} onKeyDown={(event) => { if (event.key === 'Escape') event.preventDefault() }}>
      <Buddy mood="calm" size={52} />
      <h2 id="restore-title">Pick up where you left off?</h2>
      <p>Would you like to reopen your {items.length} saved {items.length === 1 ? 'chat or terminal' : 'chats and terminals'}?</p>
      <div className="restore-list">
        {items.map((item) => (
          <label key={item.index} className={`restore-row ${item.available ? '' : 'is-unavailable'}`}>
            {choosing && <input type="checkbox" data-restore-index={item.index} checked={selected.includes(item.index)}
              disabled={busy || !item.available} onChange={(e) => setSelected((old) => e.target.checked ? [...old, item.index] : old.filter((i) => i !== item.index))} />}
            <span className="restore-detail"><strong>{item.session.title || 'Terminal'}</strong>
              <code title={item.session.cwd}>{item.session.cwd}</code>
              <small>{item.available ? '' : 'Needs attention · '}{item.description}</small></span>
          </label>
        ))}
      </div>
      <p className="restore-note">Saved conversations resume in new terminals. Running tasks, unsent text, and terminal scrollback don’t survive an app exit. No previous task is automatically resubmitted.</p>
      {available.length < items.length && <p className="restore-note">Unavailable entries are kept for recovery. You can find unlinked conversations in Saved chats.</p>}
      <div className="restore-actions">
        <button className="btn primary" autoFocus data-restore-all disabled={busy || !(choosing ? selected : available).length}
          onClick={() => void useStore.getState().restoreSelected(choosing ? selected : available)}>
          {busy ? 'Reopening…' : choosing ? `Reopen selected (${selected.length})` : 'Reopen all available'}
        </button>
        {!choosing && <button className="btn" data-restore-choose disabled={busy || !available.length} onClick={() => setChoosing(true)}>Choose chats…</button>}
        <button className="btn" data-restore-saved disabled={busy} onClick={() => useStore.getState().findSavedChats()}>Saved chats…</button>
        <button className="btn" data-restore-fresh disabled={busy} onClick={() => void useStore.getState().startFresh()}>Open something else…</button>
      </div>
      <small className="restore-footnote">Open something else to choose a base terminal, folder, or new chat. This clears the reopen list; saved conversations stay available.</small>
    </dialog>
  )
}
