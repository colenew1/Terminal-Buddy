import { useEffect, useRef } from 'react'
import { useStore } from '../store/useStore'

/** Stay in the renderer: Windows browser confirm dialogs can break keyboard focus. */
export default function CloseSessionDialog(): React.JSX.Element | null {
  const id = useStore((s) => s.pendingCloseId)
  const session = useStore((s) => s.sessions.find((x) => x.id === id))
  const closeSession = useStore((s) => s.closeSession)
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = (): void => useStore.setState({ pendingCloseId: null })

  useEffect(() => {
    if (session) dialog.current?.showModal()
  }, [session?.id])

  if (!session) return null
  return (
    <dialog ref={dialog} className="close-session-dialog" aria-labelledby="close-session-title" onCancel={cancel}>
      <h3 id="close-session-title">Close {session.title}?</h3>
      <p>This will stop the process running in this terminal.</p>
      <div className="close-session-actions">
        <button className="btn" autoFocus onClick={cancel}>Keep open</button>
        <button className="btn primary" onClick={() => closeSession(session.id, true)}>Close terminal</button>
      </div>
    </dialog>
  )
}
