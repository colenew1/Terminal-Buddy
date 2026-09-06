import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'

export default function MoveSessionDialog({ id }: { id: string }): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const [windows, setWindows] = useState<Awaited<ReturnType<typeof window.buddy.app.windows>>>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const session = useStore(s => s.sessions.find(x => x.id === id))
  const close = (): void => useStore.setState({ moveSessionId: null })
  useEffect(() => {
    dialog.current?.showModal()
    const refresh = (): void => { void window.buddy.app.windows().then(setWindows).catch(e => setError(e.message)) }
    refresh()
    return window.buddy.app.onWindowsChanged(refresh)
  }, [])
  const move = async (target: string): Promise<void> => {
    if (busy) return
    setBusy(true); setError('')
    try { await window.buddy.workspace.move(id, target); close() }
    catch (e) { setError((e as Error).message); setBusy(false) }
  }
  return <dialog ref={dialog} className="new-session-dialog" onCancel={e => { e.preventDefault(); if (!busy) close() }} aria-labelledby="move-title">
    <h2 id="move-title">Move {session?.title ?? 'terminal'}</h2>
    <p>The running process, output, and chat link move together.</p>
    <div className="new-session-choices">
      {windows.filter(w => !w.current).map(w => <button className="btn" key={w.id} data-move-target={w.id} disabled={busy || w.terminals >= 16} onClick={() => void move(w.id)}>
        <strong>{w.label}</strong><span>{w.terminals} terminals</span>
      </button>)}
    </div>
    {windows.length < 2 && <p>Open another workspace with ⊞ in the title bar first.</p>}
    {error && <p role="alert" className="new-session-error">{error}</p>}
    <div className="new-session-actions"><button className="btn" autoFocus disabled={busy} onClick={close}>Cancel</button></div>
  </dialog>
}
