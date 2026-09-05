import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'

/** Choosing is side-effect free: no terminal exists until a launch is selected. */
export default function NewSessionDialog(): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const inFlight = useRef(false)
  const [cwd, setCwd] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [choosingAgent, setChoosingAgent] = useState(false)
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
      close()
    } else {
      setError(useStore.getState().launchError || 'The terminal could not be opened. Check the folder and try again.')
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <dialog ref={dialog} className="new-session-dialog" aria-labelledby="new-session-title"
      onCancel={(event) => { event.preventDefault(); if (!inFlight.current) close() }}>
      <h2 id="new-session-title">{choosingAgent ? 'Start a new chat' : 'What would you like to open?'}</h2>
      <p>{choosingAgent ? 'Choose an assistant for a fresh conversation in this folder.' : 'Pick a saved chat, start a new one, or open a terminal.'}</p>
      <div className="new-session-folder">
        <span>Start in</span>
        <code title={cwd} data-new-cwd>{cwd || 'Finding your home folder…'}</code>
      </div>
      <div className="new-session-choices">
        {choosingAgent ? <>
          <button className="btn" data-new-kind="claude" disabled={busy || !cwd} onClick={() => void launch('claude')}>
            <strong>New Claude chat</strong><span>Fresh conversation in this folder</span>
          </button>
          <button className="btn" data-new-kind="codex" disabled={busy || !cwd} onClick={() => void launch('codex')}>
            <strong>New Codex chat</strong><span>Fresh conversation in this folder</span>
          </button>
        </> : <>
          <button className="btn" data-new-resume disabled={busy} onClick={() => {
            useStore.getState().setSidebar(true, 'chats')
            close()
            requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.sidebar input')?.focus())
          }}>
            <strong>Pick a chat</strong><span>Continue a saved conversation</span>
          </button>
          <button className="btn" data-new-chat disabled={busy} onClick={() => setChoosingAgent(true)}>
            <strong>Start a new chat</strong><span>Choose Claude or Codex</span>
          </button>
          <button className="btn" data-new-folder disabled={busy} onClick={() => void chooseFolder()}>
            <strong>Open folder…</strong><span>Choose the folder for your new chat or terminal</span>
          </button>
          <button className="btn" data-new-kind="shell" disabled={busy || !cwd} onClick={() => void launch('shell')}>
            <strong>Just start fresh</strong><span>Open a plain terminal for commands or tool updates</span>
          </button>
        </>}
      </div>
      {error && <p className="new-session-error" role="alert">{error}</p>}
      <div className="new-session-actions">
        {choosingAgent && <button className="btn" data-new-back disabled={busy} onClick={() => setChoosingAgent(false)}>Back</button>}
        <button className="btn" data-new-cancel autoFocus disabled={busy} onClick={close}>Cancel</button>
      </div>
    </dialog>
  )
}
