import { useEffect, useRef, useState } from 'react'
import LaunchRecovery from './LaunchRecovery'
import type { ChatEntry } from '@shared/types'
import { shortPath } from '../lib/format'
import { useStore } from '../store/useStore'

/** Choosing is side-effect free: no terminal exists until a launch is selected. */
export default function NewSessionDialog(): React.JSX.Element {
  const profiles = useStore(s => s.settings.customAssistants)
  const library = useStore(s => s.library)
  const catalog = useStore(s => s.catalog)
  const dialog = useRef<HTMLDialogElement>(null)
  const inFlight = useRef(false)
  const [cwd, setCwd] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [choosingAgent, setChoosingAgent] = useState(false)
  const close = (): void => useStore.getState().setNewSessionOpen(false)

  useEffect(() => {
    let live = true
    useStore.setState({ launchError: null, failedSpec: null })
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
      if (dir) {
        setCwd(dir); setError('')
        const store = useStore.getState()
        if (await store.openSession({ cwd: dir, requireCwd: true })) {
          store.setLocked(true)
          close()
        }
      }
    } catch {
      setError('Could not open the folder picker. Please try again.')
    } finally { inFlight.current = false; setBusy(false) }
  }

  const launch = async (kind: string): Promise<void> => {
    if (!cwd || inFlight.current) return
    const profile = useStore.getState().settings.customAssistants.find(p => p.id === kind)
    if (!['claude', 'codex', 'shell'].includes(kind) && !profile) { setError('This assistant was removed. Choose another assistant or add it in Settings.'); return }
    inFlight.current = true
    setBusy(true)
    setError('')
    const store = useStore.getState()
    const id = await store.openSession({
      cwd, requireCwd: true,
      ...(profile ? { assistantId: profile.id, title: `New ${profile.name} chat` } : kind === 'shell' ? {} : {
        agent: kind as 'claude' | 'codex', initialCommand: kind,
        title: kind === 'claude' ? 'New Claude chat' : 'New Codex chat'
      })
    })
    if (id) {
      store.setLocked(true)
      close()
    } else {
      setError('')
      inFlight.current = false
      setBusy(false)
    }
  }

  const openPinned = async (chat: ChatEntry): Promise<void> => {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError('')
    try {
      const spec = await window.buddy.workspace.restoreSpec({ cwd: chat.cwd, shellId: useStore.getState().settings.defaultShellId,
        title: chat.title.slice(0, 100), resume: { agent: chat.agent, id: chat.id, path: chat.path } })
      if (await useStore.getState().openSession(spec)) { useStore.getState().setLocked(true); close() }
    } catch (e) { setError((e as Error).message) }
    finally { inFlight.current = false; setBusy(false) }
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
          {profiles.map(profile => <button className="btn" key={profile.id} data-new-kind={profile.id} disabled={busy || !cwd} onClick={() => void launch(profile.id)}>
            <strong>New {profile.name} chat</strong><span>Fresh session in this folder</span>
          </button>)}
          <button className="btn" data-manage-assistants disabled={busy} onClick={() => { close(); useStore.getState().setSettingsOpen(true); requestAnimationFrame(() => document.querySelector('#assistant-settings')?.scrollIntoView()) }}>Add or edit assistants…</button>
        </> : <>
          <button className="btn" data-new-resume disabled={busy} onClick={() => {
            useStore.getState().setSidebar(true, 'chats')
            close()
            requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.sidebar input')?.focus())
          }}>
            <strong>Pick a chat</strong><span>Continue a saved conversation</span>
          </button>
          <button className="btn" data-new-chat disabled={busy} onClick={() => setChoosingAgent(true)}>
            <strong>Start a new chat</strong><span>{profiles.length ? 'Choose Claude, Codex, or a custom assistant' : 'Choose Claude or Codex'}</span>
          </button>
          <button className="btn" data-new-folder disabled={busy} onClick={() => void chooseFolder()}>
            <strong>Open folder…</strong><span>Choose a folder and open its terminal immediately</span>
          </button>
          <button className="btn" data-new-kind="shell" disabled={busy || !cwd} onClick={() => void launch('shell')}>
            <strong>Start a base terminal</strong><span>Open a plain terminal for commands or tool updates</span>
          </button>
        </>}
      </div>
      {!choosingAgent && <details className="launcher-extras">
        <summary>Recent folders, pinned chats & presets</summary>
        <div className="launcher-list">
          {library.recentFolders.length > 0 && <strong>Recent folders</strong>}
          {library.recentFolders.slice(0, 5).map(path => <button className="btn" key={path} data-recent-folder={path} disabled={busy} title={path} onClick={() => { setCwd(path); setError('') }}>{shortPath(path, 3)}</button>)}
          {library.pinnedChats.length > 0 && <strong>Pinned chats</strong>}
          {library.pinnedChats.map(saved => {
            const chat = catalog?.chats.find(c => c.agent === saved.agent && c.id === saved.id) ?? saved
            return <div className="launcher-row" key={saved.agent + saved.id}>
              <button className="btn" data-pinned-chat={saved.id} disabled={busy} title={chat.cwd} onClick={() => void openPinned(chat)}>{chat.title}<small>{chat.agent}</small></button>
              <button className="btn" aria-label={`Unpin ${chat.title}`} disabled={busy} onClick={() => void window.buddy.library.pin(saved, false).catch(e => setError(e.message))}>★</button>
            </div>
          })}
          <button className="btn" data-open-presets disabled={busy} onClick={() => { close(); useStore.setState({ presetsOpen: true }) }}>Workspace presets… ({library.presets.length})</button>
        </div>
      </details>}
      {error && <p className="new-session-error" role="alert">{error}</p>}
      <LaunchRecovery onOpened={close} onBusy={value => { inFlight.current = value; setBusy(value) }} />
      <div className="new-session-actions">
        {choosingAgent && <button className="btn" data-new-back disabled={busy} onClick={() => setChoosingAgent(false)}>Back</button>}
        <button className="btn" data-new-cancel autoFocus disabled={busy} onClick={close}>Cancel</button>
      </div>
    </dialog>
  )
}
