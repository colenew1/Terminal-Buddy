export type ShortcutId =
  | 'new'
  | 'newWindow'
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

export const IS_MAC = typeof window !== 'undefined' && window.buddy?.platform === 'darwin'
export const shortcutLabel = (text: string): string => IS_MAC
  ? text.replaceAll('Ctrl+', 'Cmd+').replaceAll('Alt+', 'Option+') : text

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
  // Dictation and accessibility tools can omit the physical code entirely.
  const code = e.code && e.code !== 'Unidentified' ? e.code :
    /^[cvx]$/i.test(e.key ?? '') ? `Key${e.key.toUpperCase()}` :
      e.key === 'Insert' || e.keyCode === 45 ? 'Insert' :
        ({ 67: 'KeyC', 86: 'KeyV', 88: 'KeyX' } as Record<number, string>)[e.keyCode] ?? ''
  // Control+C/V/X belong to the terminal line editor on a Mac.
  const ctrl = IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey || e.metaKey
  if (e.altKey) return null

  // The old terminal chords, still honoured.
  if (!ctrl && e.shiftKey && code === 'Insert') return 'paste'
  if (ctrl && !e.shiftKey && code === 'Insert') return 'copy'

  if (!ctrl) return null
  switch (code) {
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

  if (e.ctrlKey && !e.metaKey && e.code === 'Tab') return e.shiftKey ? 'prev' : 'next'
  if (ctrl && !e.shiftKey && e.code === 'Comma') return 'settings'

  if (e.altKey && !ctrl && !e.shiftKey && /^Digit[1-9]$/.test(e.code)) {
    return `jump:${Number(e.code.slice(5)) - 1}` as ShortcutId
  }

  if (!ctrl || !e.shiftKey) return null
  switch (e.code) {
    case 'KeyT':
      return 'new'
    case 'KeyN':
      return 'newWindow'
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

export const SHORTCUT_HELP: [string, string][] = ([
  ['Ctrl+C / Ctrl+V', IS_MAC ? 'Copy / paste — Control+C interrupts the running program' : 'Copy / paste — Ctrl+C still interrupts when nothing is selected'],
  ['Ctrl+Shift+C / Ctrl+Shift+V', 'Copy / paste (also works)'],
  ['Right-click', 'Copy selection, or paste when nothing is selected'],
  ['Ctrl+Shift+L', 'Lock / unlock the layout for rearranging'],
  ['Ctrl+Shift+T', 'Choose a new chat or terminal'],
  ['Ctrl+Shift+N', 'Open a separate workspace window'],
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
] as [string, string][]).map(([key, description]) => [key.includes('Tab') ? key : shortcutLabel(key), description])
