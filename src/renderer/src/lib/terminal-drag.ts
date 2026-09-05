import type { PointerEvent as ReactPointerEvent } from 'react'
import { useStore } from '../store/useStore'

/** Pointer capture works outside the app; the terminal body still selects text normally. */
export function beginTerminalDrag(event: ReactPointerEvent<HTMLElement>, id: string): void {
  if (event.button !== 0 || (event.target as HTMLElement).closest('button,input')) return
  const store = useStore.getState()
  if (store.sessions.find((s) => s.id === id)?.detached) return
  const handle = event.currentTarget, pointerId = event.pointerId
  const startX = event.clientX, startY = event.clientY
  let moved = false
  handle.setPointerCapture(pointerId)
  const finish = (): void => {
    document.body.classList.remove('is-terminal-dragging')
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', cancel)
    window.removeEventListener('keydown', key)
    handle.removeEventListener('lostpointercapture', cancel)
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
  }
  const move = (e: PointerEvent): void => {
    if (e.pointerId !== pointerId) return
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > 12) moved = true
    if (moved) document.body.classList.add('is-terminal-dragging')
  }
  const cancel = (): void => finish()
  const key = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.preventDefault(); finish() } }
  const up = (e: PointerEvent): void => {
    if (e.pointerId !== pointerId) return
    finish()
    if (!moved) return
    if (e.clientX < 0 || e.clientX > window.innerWidth || e.clientY < 0 || e.clientY > window.innerHeight) {
      void useStore.getState().detachSession(id, { x: e.screenX, y: e.screenY })
    } else {
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-session-id]')?.dataset.sessionId
      const { sessions, moveSession } = useStore.getState()
      if (target && target !== id) moveSession(sessions.findIndex((s) => s.id === id), sessions.findIndex((s) => s.id === target))
    }
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', cancel)
  window.addEventListener('keydown', key)
  handle.addEventListener('lostpointercapture', cancel)
}
