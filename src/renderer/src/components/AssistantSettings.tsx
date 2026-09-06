import { useRef, useState } from 'react'
import type { AssistantProfile } from '@shared/types'
import { useStore } from '../store/useStore'

export default function AssistantSettings(): React.JSX.Element {
  const profiles = useStore(s => s.settings.customAssistants)
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const reset = (): void => { setEditing(null); setName(''); setCommand(''); setError('') }
  const save = async (): Promise<void> => {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError('')
    try {
      await window.buddy.assistants.save({ id: editing ?? crypto.randomUUID(), name: name.trim(), command: command.trim() })
      reset()
    } catch (e) { setError((e as Error).message) }
    finally { inFlight.current = false; setBusy(false) }
  }
  const remove = async (profile: AssistantProfile): Promise<void> => {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError('')
    try { await window.buddy.assistants.remove(profile.id); if (editing === profile.id) reset() }
    catch (e) { setError((e as Error).message) }
    finally { inFlight.current = false; setBusy(false) }
  }
  return <section id="assistant-settings" data-assistant-settings>
    <h4>Assistants</h4>
    <p className="muted">Claude and Codex are included. Add any installed terminal assistant below. Its launch command can include model flags or a quoted executable path.</p>
    <p className="muted">Install and sign in to the tool in a terminal first. Custom assistants handle their own chat history; reopening a workspace starts a fresh session.</p>
    <div className="launcher-list">
      {profiles.map(profile => <div className="assistant-profile" key={profile.id} data-assistant-profile={profile.id}>
        <div><strong>{profile.name}</strong><code>{profile.command}</code></div>
        <button className="btn tiny" data-assistant-edit={profile.id} disabled={busy} onClick={() => { setEditing(profile.id); setName(profile.name); setCommand(profile.command); setError('') }}>Edit</button>
        <button className="btn tiny" data-assistant-remove={profile.id} disabled={busy} onClick={() => void remove(profile)}>Remove</button>
      </div>)}
    </div>
    <form className="assistant-form" onSubmit={e => { e.preventDefault(); void save() }}>
      <label className="field"><span>Name</span><input data-assistant-name value={name} maxLength={60} disabled={busy} placeholder="Kimi" onChange={e => setName(e.target.value)} /></label>
      <label className="field"><span>Launch command</span><input data-assistant-command value={command} maxLength={2000} disabled={busy} placeholder="kimi" onChange={e => setCommand(e.target.value)} /></label>
      <div className="launcher-row">
        <button className="btn primary" data-assistant-save disabled={busy || !name.trim() || !command.trim()}>{editing ? 'Save changes' : 'Add assistant'}</button>
        <button className="btn" type="button" data-assistant-kimi disabled={busy} onClick={() => { setEditing(null); setName('Kimi'); setCommand('kimi'); setError('') }}>Use Kimi example</button>
        {editing && <button className="btn" type="button" disabled={busy} onClick={reset}>Cancel edit</button>}
      </div>
    </form>
    {error && <p className="muted warn" role="alert">{error}</p>}
    <p className="muted tiny">Edits apply to the next launch. Removing a profile leaves its running terminals open; presets using it will ask you to choose another assistant.</p>
  </section>
}
