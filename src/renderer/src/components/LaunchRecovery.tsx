import { useRef, useState } from 'react'
import { useStore } from '../store/useStore'

export default function LaunchRecovery({ onOpened, onBusy }: { onOpened?: () => void; onBusy?: (busy: boolean) => void }): React.JSX.Element | null {
  const error = useStore(s => s.launchError)
  const spec = useStore(s => s.failedSpec)
  const shells = useStore(s => s.shells)
  const defaultShell = useStore(s => s.settings.defaultShellId)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const retry = async (): Promise<void> => {
    if (!spec || inFlight.current) return
    inFlight.current = true; setBusy(true); onBusy?.(true)
    try {
      const id = await useStore.getState().openSession(spec)
      if (id) { useStore.getState().setLocked(true); onOpened?.() }
    } finally { inFlight.current = false; setBusy(false); onBusy?.(false) }
  }
  if (!error) return null
  return <div className="launch-recovery" role="alert">
    <p>{error}</p>
    {spec && <label>Choose another shell
      <select data-recovery-shell value={spec.shellId ?? defaultShell} disabled={busy} onChange={e => useStore.setState({ failedSpec: { ...spec, shellId: e.target.value } })}>
        {shells.map(shell => <option key={shell.id} value={shell.id}>{shell.label}</option>)}
      </select>
    </label>}
    <div className="launcher-row">
      <button className="btn" data-launch-retry disabled={busy || !spec} onClick={() => void retry()}>Retry</button>
      <button className="btn" data-copy-launch-error onClick={() => { window.buddy.clipboard.write(error); useStore.getState().notify('Error details copied.') }}>Copy error details</button>
      <button className="btn" disabled={busy} onClick={() => useStore.setState({ launchError: null, failedSpec: null })}>Dismiss</button>
    </div>
  </div>
}
