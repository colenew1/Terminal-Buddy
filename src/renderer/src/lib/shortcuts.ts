export type ShortcutId =
  | 'new'
  | 'close'
  | 'duplicate'
  | 'next'
  | 'prev'
  | 'layout'
  | 'sidebar'
  | 'palette'
  | 'search'
  | 'broadcast'
  | 'lock'
  | 'settings'
  | `jump:${number}`

export type ClipboardAction = 'copy' | 'paste' | 'cut'

/**
 * Clipboard chords, matched separately from app actions because what they do
 * depends on what has focus.
 *
 * Ctrl+V has to be claimed explicitly. xterm.js treats it as the control
 * character 0x16 and calls preventDefault, which kills the browser's own paste
 * — so without this the key reaches the shell as a raw SYN byte and appears to
 * do nothing. Ctrl+C is reported here too, but the caller only treats it as a
 * copy when there is a selection; otherwise it must stay an interrupt.
 */
export function matchClipboard(e: KeyboardEvent): ClipboardAction | null {
  const ctrl = e.ctrlKey || e.metaKey
  if (e.altKey) return null

  // The old terminal chords, still honoured.
  if (!ctrl && e.shiftKey && e.code === 'Insert') return 'paste'
  if (ctrl && !e.shiftKey && e.code === 'Insert') return 'copy'

  if (!ctrl) return null
  switch (e.code) {
    case 'KeyV':
      return 'paste'
    case 'KeyC':
      return 'copy'
    case 'KeyX':
      return e.shiftKey ? null : 'cut'
    default:
      return null
  }
}

/**
 * App actions, keyed off `event.code` so the bindings survive non-US layouts
 * and don't change identity when Shift is held.
 *
 * Every binding uses Ctrl+Shift or Alt. Bare Ctrl combos are left to readline —
 * Ctrl+A goes to the start of the line, Ctrl+W deletes a word — with the single
 * exception of the clipboard keys above, which people expect to win.
 */
export function matchShortcut(e: KeyboardEvent): ShortcutId | null {
  const ctrl = e.ctrlKey || e.metaKey

  if (ctrl && e.code === 'Tab') return e.shiftKey ? 'prev' : 'next'
  if (ctrl && !e.shiftKey && e.code === 'Comma') return 'settings'

  if (e.altKey && !ctrl && !e.shiftKey && /^Digit[1-9]$/.test(e.code)) {
    return `jump:${Number(e.code.slice(5)) - 1}` as ShortcutId
  }

  if (!ctrl || !e.shiftKey) return null
  switch (e.code) {
    case 'KeyT':
      return 'new'
    case 'KeyW':
      return 'close'
    case 'KeyD':
      return 'duplicate'
    case 'KeyG':
      return 'layout'
    case 'KeyE':
      return 'sidebar'
    case 'KeyP':
      return 'palette'
    case 'KeyF':
      return 'search'
    case 'KeyB':
      return 'broadcast'
    case 'KeyL':
      return 'lock'
    default:
      return null
  }
}

export const SHORTCUT_HELP: [string, string][] = [
  ['Ctrl+C / Ctrl+V', 'Copy / paste — Ctrl+C still interrupts when nothing is selected'],
  ['Ctrl+Shift+C / Ctrl+Shift+V', 'Copy / paste (also works)'],
  ['Right-click', 'Copy selection, or paste when nothing is selected'],
  ['Ctrl+Shift+L', 'Lock / unlock the layout for rearranging'],
  ['Ctrl+Shift+T', 'New terminal'],
  ['Ctrl+Shift+D', 'Duplicate terminal (same folder)'],
  ['Ctrl+Shift+W', 'Close terminal'],
  ['Ctrl+Tab / Ctrl+Shift+Tab', 'Next / previous terminal'],
  ['Alt+1 … Alt+9', 'Jump to terminal'],
  ['Ctrl+Shift+G', 'Toggle tabs / grid'],
  ['Ctrl+Shift+E', 'Toggle catalog sidebar'],
  ['Ctrl+Shift+P', 'Command palette'],
  ['Ctrl+Shift+F', 'Search in terminal'],
  ['Ctrl+Shift+B', 'Broadcast typing to all terminals'],
  ['Ctrl+,', 'Settings']
]
