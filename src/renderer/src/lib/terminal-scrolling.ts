import type { Terminal } from '@xterm/xterm'

/** Keep normal-buffer history accessible even when an agent enables mouse input. */
export function installTerminalScrolling(term: Terminal): void {
  term.attachCustomWheelEventHandler(event => {
    if (event.ctrlKey || event.metaKey || !event.deltaY || term.buffer.active.type !== 'normal' || !term.buffer.active.baseY) return true
    // Without mouse reporting xterm's viewport already handles the wheel.
    if (term.modes.mouseTrackingMode === 'none') return true
    const pixelsPerLine = (term.element?.clientHeight ?? term.rows * 20) / term.rows
    const lines = event.deltaMode === 1 ? event.deltaY : event.deltaMode === 2 ? event.deltaY * term.rows : event.deltaY / pixelsPerLine
    term.scrollLines(Math.sign(lines) * Math.max(1, Math.round(Math.abs(lines))))
    event.preventDefault()
    return false
  })
}
