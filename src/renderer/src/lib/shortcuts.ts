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
  | 'copy'
  | 'paste'
  | 'settings'
  | `jump:${number}`

/**
 * Keyed off `event.code` so the bindings survive non-US layouts and don't
 * change identity when Shift is held.
 *
 * Every app binding uses Ctrl+Shift or Alt. Bare Ctrl combos are left alone
 * because readline owns them — Ctrl+W deletes a word, Ctrl+C interrupts, and
 * stealing those would make the terminal worse at being a terminal.
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
    case 'KeyC':
      return 'copy'
    case 'KeyV':
      return 'paste'
    default:
      return null
  }
}

export const SHORTCUT_HELP: [string, string][] = [
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
  ['Ctrl+Shift+C / Ctrl+Shift+V', 'Copy / paste'],
  ['Right-click', 'Copy selection, or paste when nothing is selected'],
  ['Ctrl+,', 'Settings']
]
