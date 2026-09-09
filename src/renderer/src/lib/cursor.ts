import type { Terminal } from '@xterm/xterm'

/**
 * Click-to-position for the command line.
 *
 * A terminal cannot move the shell's cursor directly: the line buffer belongs
 * to the line editor (PSReadLine, readline), not to us. So we measure how far
 * the click is from the cursor and send exactly that many arrow keys in one
 * burst. This is the same trick iTerm2, VS Code and Windows Terminal use, and
 * the editor clamps at both ends of its buffer, so overshooting into the prompt
 * or past the last character is harmless.
 *
 * Only horizontal arrows are ever sent. Up and Down mean "history" to every
 * shell worth using, and sending those would silently replace the line you were
 * editing — so a click that would need them is declined instead.
 */

const MAX_STEPS = 600

export interface ClickTarget {
  clientX: number
  clientY: number
}

/**
 * Cells from the cursor to the clicked position, or null when repositioning
 * would be unsafe or meaningless.
 */
export function computeClickDelta(term: Terminal, screenEl: HTMLElement, at: ClickTarget): number | null {
  const buf = term.buffer.active

  // Full-screen programs (vim, less, htop) own the whole grid; arrows there are
  // navigation inside the app, and the cursor is not a text caret.
  if (buf.type === 'alternate') return null

  // Agents like Codex turn on mouse reporting for their own scroll handling
  // while still editing an ordinary command line, and they ignore plain click
  // reports — so honouring the mode here just made click-to-position dead in
  // exactly the terminals people use it in. Full-screen apps that really own
  // the pointer draw on the alternate buffer, which already returned above.

  // Scrolled back through history: the cursor is somewhere off-screen.
  if (buf.viewportY !== buf.baseY) return null

  const rect = screenEl.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null

  const cellW = rect.width / term.cols
  const cellH = rect.height / term.rows
  if (!Number.isFinite(cellW) || !Number.isFinite(cellH) || cellW <= 0 || cellH <= 0) return null

  const col = Math.max(0, Math.min(term.cols - 1, Math.floor((at.clientX - rect.left) / cellW)))
  const row = Math.max(0, Math.min(term.rows - 1, Math.floor((at.clientY - rect.top) / cellH)))

  const curCol = buf.cursorX
  const curRow = buf.cursorY

  if (row === curRow) return col - curCol

  // Crossing rows is only safe when they are one logical line that wrapped —
  // then horizontal arrows walk over the boundary on their own.
  const lo = Math.min(row, curRow)
  const hi = Math.max(row, curRow)
  for (let r = lo + 1; r <= hi; r++) {
    if (!buf.getLine(buf.viewportY + r)?.isWrapped) return null
  }
  return (row - curRow) * term.cols + (col - curCol)
}

/** The keystrokes that walk the cursor `delta` cells, or null for a no-op. */
export function arrowsFor(term: Terminal, delta: number): string | null {
  if (!delta) return null
  const appMode = term.modes.applicationCursorKeysMode
  const right = appMode ? '\x1bOC' : '\x1b[C'
  const left = appMode ? '\x1bOD' : '\x1b[D'
  const steps = Math.min(Math.abs(delta), MAX_STEPS)
  return (delta > 0 ? right : left).repeat(steps)
}
