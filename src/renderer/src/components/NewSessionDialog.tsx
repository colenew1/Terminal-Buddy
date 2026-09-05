import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'

/** Choosing is side-effect free: no terminal exists until a launch is selected. */
export default function NewSessionDialog(): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const inFlight = useRef(false)
  const [cwd, setCwd] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const close = (): void => useStore.getState().setNewSessionOpen(false)

  useEffect(() => {
    let live = true
    dialog.current?.showModal()
    void window.buddy.app.paths().then((paths) => {
      if (live) setCwd((current) => current || paths.home)
    }).catch(() => {
      if (live) setError('Could not find your home folder. Choose a folder below.')
    })
    return () => { live = false }
  }, [])

  const chooseFolder = async (): Promise<void> => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    try {
      const dir = await window.buddy.app.pickFolder()
      if (dir) { setCwd(dir); setError('') }
    } catch {
      setError('Could not open the folder picker. Please try again.')
    } finally { inFlight.current = false; setBusy(false) }
  }

  const launch = async (kind: 'claude' | 'codex' | 'shell'): Promise<void> => {
    if (!cwd || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    const store = useStore.getState()
    const id = await store.openSession({
      cwd,
      ...(kind === 'shell' ? {} : {
        agent: kind, initialCommand: kind,
        title: kind === 'claude' ? 'New Claude chat' : 'New Codex chat'
      })
    })
    if (id) {
      store.setLocked(true)
      if (store.layout === 'world') store.setLayout('tabs')
      close()
    } else {
      setError('The terminal could not be opened. Check the folder and try again.')
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <dialog ref={dialog} className="new-session-dialog" aria-labelledby="new-session-title"
      onCancel={(event) => { event.preventDefault(); if (!inFlight.current) close() }}>
      <h2 id="new-session-title">Open something new</h2>
      <p>Start fresh, choose a project folder, or pick up a saved chat.</p>
      <div className="new-session-folder">
        <span>Start in</span>
        <code title={cwd} data-new-cwd>{cwd || 'Finding your home folder…'}</code>
        <button className="btn" data-new-folder disabled={busy} onClick={() => void chooseFolder()}>Choose folder…</button>
      </div>
      <div className="new-session-choices">
        <button className="btn" data-new-kind="claude" disabled={busy || !cwd} onClick={() => void launch('claude')}>
          <strong>New Claude chat</strong><span>Fresh conversation in this folder</span>
        </button>
        <button className="btn" data-new-kind="codex" disabled={busy || !cwd} onClick={() => void launch('codex')}>
          <strong>New Codex chat</strong><span>Fresh conversation in this folder</span>
        </button>
        <button className="btn" data-new-kind="shell" disabled={busy || !cwd} onClick={() => void launch('shell')}>
          <strong>Terminal only</strong><span>Open a shell without starting an agent</span>
        </button>
      </div>
      {error && <p className="new-session-error" role="alert">{error}</p>}
      <div className="new-session-actions">
        <button className="btn" data-new-resume disabled={busy} onClick={() => {
          useStore.getState().setSidebar(true, 'chats')
          close()
          requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.sidebar input')?.focus())
        }}>Resume saved chat…</button>
        <button className="btn" data-new-cancel autoFocus disabled={busy} onClick={close}>Cancel</button>
      </div>
    </dialog>
  )
}
