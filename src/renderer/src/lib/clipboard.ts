import type { ClipboardAction } from './shortcuts'
import { get as getTerm } from './terminals'
import { useStore } from '../store/useStore'

/**
 * The app owns every clipboard key, because the application menu that normally
 * provides them has been removed (it registered Ctrl+V globally and opened a
 * hidden menu bar on Alt, both of which fought the terminal).
 *
 * Reads and writes go through Electron's clipboard over IPC rather than
 * `navigator.clipboard`, which needs focus and a permission grant and fails
 * silently when it doesn't have them.
 */

function isTerminalFocused(el: Element | null): boolean {
  return !!el?.classList.contains('xterm-helper-textarea')
}

function isTextField(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el) return false
  const tag = el.tagName
  return (tag === 'INPUT' || tag === 'TEXTAREA') && !isTerminalFocused(el)
}

/** Returns true when the event was consumed and should be preventDefault()ed. */
export async function handleClipboard(action: ClipboardAction): Promise<boolean> {
  const el = document.activeElement

  if (isTextField(el)) return handleTextField(el, action)

  // Anything else in the app means the terminal: either its hidden textarea has
  // focus, or focus is nowhere useful and the active pane is what you meant.
  const id = useStore.getState().activeId
  if (!id) return false
  const h = getTerm(id)
  if (!h) return false
  if (h.detached) { window.buddy.popout.focus(id); return true }

  if (action === 'copy') {
    const sel = h.term.getSelection()
    // No selection means this was an interrupt, not a copy. Let it through.
    if (!sel) return false
    window.buddy.clipboard.write(sel)
    h.term.clearSelection()
    return true
  }

  if (action === 'paste') {
    const text = await window.buddy.clipboard.read()
    if (text) {
      useStore.getState().markInput(id)
      h.term.paste(text)
    }
    return true
  }

  // Cut has no meaning in a terminal; swallow it so it can't emit a stray byte.
  return true
}

async function handleTextField(
  el: HTMLInputElement | HTMLTextAreaElement,
  action: ClipboardAction
): Promise<boolean> {
  const start = el.selectionStart ?? 0
  const end = el.selectionEnd ?? 0
  const selected = el.value.slice(start, end)

  if (action === 'copy') {
    if (!selected) return false
    window.buddy.clipboard.write(selected)
    return true
  }

  if (action === 'cut') {
    if (!selected) return false
    window.buddy.clipboard.write(selected)
    // insertText keeps undo history intact and fires the input event React needs.
    document.execCommand('insertText', false, '')
    return true
  }

  const text = await window.buddy.clipboard.read()
  if (text) document.execCommand('insertText', false, text)
  return true
}
