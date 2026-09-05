import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'

export default function LinkSessionDialog({ sessionId }: { sessionId: string }): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const session = useStore((s) => s.sessions.find((x) => x.id === sessionId))
  const catalog = useStore((s) => s.catalog)
  const loading = useStore((s) => s.catalogLoading)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const close = (): void => useStore.setState({ linkSessionId: null })
  useEffect(() => {
    dialog.current?.showModal()
    void useStore.getState().loadCatalog(true)
  }, [])
  useEffect(() => { if (!session) close() }, [session])
  const chats = (catalog?.chats ?? []).filter((c) => !c.internal && `${c.title} ${c.cwd} ${c.id}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => Number(b.cwd.toLowerCase() === session?.cwd.toLowerCase()) - Number(a.cwd.toLowerCase() === session?.cwd.toLowerCase()) || b.updatedAt - a.updatedAt)
  const choice = catalog?.chats.find((c) => `${c.agent}:${c.id}` === selected)
  const link = async (): Promise<void> => {
    if (!choice || busy) return
    setBusy(true); setError('')
    try {
      const info = await window.buddy.pty.link(sessionId, choice)
      const store = useStore.getState()
      store.patchSession(sessionId, { resume: info.resume, cwd: info.cwd, hasConversation: true })
      useStore.setState((s) => ({ agents: { ...s.agents, [sessionId]: choice.agent }, feeds: { ...s.feeds, [sessionId]: [] }, toolStats: { ...s.toolStats, [sessionId]: [] } }))
      window.buddy.feed.detach(sessionId)
      window.buddy.feed.attach(sessionId, info.cwd, { agent: choice.agent, path: choice.path })
      store.persistNow()
      close()
      store.notify('Recovery linked. Your running terminal was not restarted or changed.')
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  return <dialog ref={dialog} className="buddy-guide-dialog recovery-dialog" aria-labelledby="link-title"
    onCancel={(e) => { e.preventDefault(); if (!busy) close() }}>
    <h2 id="link-title">Link a chat for recovery</h2>
    <p>Choose the exact saved conversation running in <b>{session?.title}</b>. This only sets what reopens next time; it does not start or replace anything now.</p>
    {session?.resume && <p className="muted">Currently linked: {session.resume.agent} · {session.resume.id}</p>}
    <label>Find a saved chat<input autoFocus className="recovery-search" placeholder="Name, folder, or exact session ID" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
    <div className="recovery-choices">
      {chats.slice(0, 100).map((c) => <label key={`${c.agent}:${c.id}`} className="recovery-choice">
        <input type="radio" name="recovery-chat" disabled={busy} checked={selected === `${c.agent}:${c.id}`} onChange={() => setSelected(`${c.agent}:${c.id}`)} />
        <span><b>{c.title}</b><small>{c.agent} · {c.cwd}</small><small>{c.id}</small></span>
      </label>)}
      {!chats.length && <p>{loading ? 'Looking for saved conversations…' : 'No matching saved chats. Send a message in your agent first, then refresh.'}</p>}
      {chats.length > 100 && <p>Showing 100 matches. Search to narrow the list.</p>}
    </div>
    {choice && <p>On reopen: <b>{choice.title}</b> in <span className="mono">{choice.cwd}</span>. Confirm this is the conversation in this terminal.</p>}
    {error && <p role="alert" className="warn">{error}</p>}
    <div className="guide-actions"><button className="btn" disabled={busy || loading} onClick={() => void useStore.getState().loadCatalog(true)}>Refresh</button><span />
      <button className="btn" disabled={busy} onClick={close}>Cancel</button>
      <button className="btn primary" disabled={!choice || busy} onClick={() => void link()}>{busy ? 'Checking…' : 'Link for recovery'}</button></div>
  </dialog>
}
