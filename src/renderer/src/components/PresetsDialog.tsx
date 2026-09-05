import { useEffect, useRef, useState } from 'react'
import type { WorkspacePreset } from '@shared/types'
import { useStore } from '../store/useStore'

export default function PresetsDialog(): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const inFlight = useRef(false)
  const presets = useStore(s => s.library.presets)
  const sessions = useStore(s => s.sessions)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const close = (): void => useStore.setState({ presetsOpen: false })
  useEffect(() => { dialog.current?.showModal() }, [])
  const save = async (): Promise<void> => {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError('')
    try {
      const s = useStore.getState()
      await window.buddy.library.savePreset({ name: name.trim(), layout: s.layout, gridSizes: s.gridSizes,
        sessions: s.sessions.map(x => ({ cwd: x.cwd, shellId: x.shellId, title: x.title, critter: x.critter.name,
          agent: x.resume?.agent ?? s.agents[x.id] ?? undefined })) })
      setName('')
    } catch (e) { setError((e as Error).message) }
    finally { inFlight.current = false; setBusy(false) }
  }
  const open = async (preset: WorkspacePreset): Promise<void> => {
    if (inFlight.current) return
    const s = useStore.getState()
    if (s.sessions.length + preset.sessions.length > 16) { setError('This preset would exceed 16 terminals. Open an empty window or close some terminals first.'); return }
    inFlight.current = true; setBusy(true); setError('')
    try {
      // Validate every directory and shell before starting any processes.
      const available = await window.buddy.workspace.prepareRestore(preset.sessions.map(x => ({ ...x, agent: undefined })))
      if (available.some(x => !x.available)) throw Error(available.filter(x => !x.available).map(x => `${x.session.title}: ${x.description}`).join('\n'))
      if (preset.sessions.some(x => !s.shells.some(shell => shell.id === x.shellId))) throw Error('A preset shell is unavailable on this computer. Open its folders manually and save a new preset.')
      const failed: string[] = []
      for (const item of preset.sessions) {
        const id = await useStore.getState().openSession({ ...item, requireCwd: true, ...(item.agent ? { initialCommand: item.agent } : {}) })
        if (!id) { failed.push(item.title); break }
      }
      useStore.setState({ layout: preset.layout, gridSizes: preset.gridSizes ?? { columns: [], rows: [] }, newSessionOpen: false, locked: true })
      useStore.getState().persistNow()
      close()
      if (failed.length) useStore.getState().notify(`Stopped at ${failed[0]}: ${useStore.getState().launchError}. Sessions already opened are kept; retry this terminal from +.`)
    } catch (e) { setError((e as Error).message) }
    finally { inFlight.current = false; setBusy(false) }
  }
  return <dialog ref={dialog} className="new-session-dialog" aria-labelledby="presets-title" onCancel={e => { e.preventDefault(); if (!inFlight.current) close() }}>
    <h2 id="presets-title">Workspace presets</h2>
    <p>Save folders, assistants, and layout. Opening a preset adds fresh sessions to this window.</p>
    <form className="preset-save" onSubmit={e => { e.preventDefault(); void save() }}>
      <label htmlFor="preset-name">Save this workspace as</label>
      <input id="preset-name" data-preset-name maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="Website project" disabled={busy} />
      <button className="btn" data-preset-save disabled={busy || !name.trim() || !sessions.length}>Save preset</button>
    </form>
    <div className="launcher-list">
      {presets.map(p => <div className="launcher-row" key={p.id}>
        <button className="btn" data-preset-open={p.id} disabled={busy} onClick={() => void open(p)}><strong>{p.name}</strong><small>{p.sessions.length} terminals · {p.layout}</small></button>
        <button className="btn" data-preset-delete={p.id} disabled={busy} aria-label={`Delete ${p.name}`} onClick={() => void window.buddy.library.deletePreset(p.id).catch(e => setError(e.message))}>×</button>
      </div>)}
      {!presets.length && <p>No presets saved yet. Open your preferred terminals, then save this workspace.</p>}
    </div>
    {error && <p role="alert" className="new-session-error">{error}</p>}
    <div className="new-session-actions"><button className="btn" disabled={busy} onClick={close}>Close</button></div>
  </dialog>
}
