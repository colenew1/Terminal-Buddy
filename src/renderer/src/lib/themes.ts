/**
 * Themes own both halves of the palette: the CSS custom properties the app
 * chrome reads, and the xterm colours. Keeping them in one object means a new
 * theme can never leave the terminal looking like a different app.
 */
export interface TerminalColors {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

export interface Theme {
  id: string
  name: string
  blurb: string
  /** Two colours for the swatch shown in Settings. */
  swatch: [string, string]
  vars: Record<string, string>
  terminal: TerminalColors
}

const ansiDark = {
  black: '#2a2f3a',
  red: '#f2777a',
  green: '#8fce7f',
  yellow: '#f0c674',
  blue: '#6ea8fe',
  magenta: '#c397d8',
  cyan: '#70c0ba',
  white: '#c9d1d9',
  brightBlack: '#5c6672',
  brightRed: '#ff8b8e',
  brightGreen: '#a6e394',
  brightYellow: '#ffd98a',
  brightBlue: '#8fc0ff',
  brightMagenta: '#d7b0e8',
  brightCyan: '#8ad7d1',
  brightWhite: '#f0f4f8'
}

export const THEMES: Theme[] = [
  {
    id: 'midnight',
    name: 'Midnight',
    blurb: 'Cool and quiet. The default.',
    swatch: ['#6ea8fe', '#a78bfa'],
    vars: {
      '--bg': '#0f1115',
      '--bg-1': '#161920',
      '--bg-2': '#1c202a',
      '--bg-3': '#232833',
      '--line': '#2b313d',
      '--fg': '#d5dae3',
      '--fg-dim': '#8b95a5',
      '--fg-faint': '#626c7a',
      '--accent': '#6ea8fe',
      '--accent-2': '#a78bfa',
      '--accent-dim': '#2c4a6e',
      '--warn': '#f0c674',
      '--danger': '#f2777a',
      '--scrim': 'rgba(6, 8, 12, 0.62)',
      '--ok': '#8fce7f'
    },
    terminal: { background: '#0f1115', foreground: '#d5dae3', cursor: '#6ea8fe', cursorAccent: '#0f1115', selectionBackground: '#2c4a6e', ...ansiDark }
  },
  {
    id: 'grove',
    name: 'Grove',
    blurb: 'Mossy and calm. Easy on late nights.',
    swatch: ['#7fd4a0', '#c3e88d'],
    vars: {
      '--bg': '#0d1410',
      '--bg-1': '#131c17',
      '--bg-2': '#18231d',
      '--bg-3': '#1f2d25',
      '--line': '#28382f',
      '--fg': '#d4e3d8',
      '--fg-dim': '#8aa494',
      '--fg-faint': '#61776b',
      '--accent': '#7fd4a0',
      '--accent-2': '#c3e88d',
      '--accent-dim': '#254d38',
      '--warn': '#e8c88d',
      '--danger': '#ef8f83',
      '--scrim': 'rgba(4, 10, 7, 0.62)',
      '--ok': '#9fe08a'
    },
    terminal: {
      background: '#0d1410', foreground: '#d4e3d8', cursor: '#7fd4a0', cursorAccent: '#0d1410', selectionBackground: '#254d38',
      ...ansiDark, green: '#9fe08a', blue: '#7fd4a0', cyan: '#8ad7bd', brightGreen: '#b6f0a2', brightBlue: '#9fe4bb'
    }
  },
  {
    id: 'ember',
    name: 'Ember',
    blurb: 'Warm dusk. Good for long sessions.',
    swatch: ['#ff9e64', '#f7768e'],
    vars: {
      '--bg': '#16110f',
      '--bg-1': '#1e1715',
      '--bg-2': '#261d1a',
      '--bg-3': '#302421',
      '--line': '#3d2e29',
      '--fg': '#e8dcd4',
      '--fg-dim': '#a8938a',
      '--fg-faint': '#7a675f',
      '--accent': '#ff9e64',
      '--accent-2': '#f7768e',
      '--accent-dim': '#5c3524',
      '--warn': '#ffc777',
      '--danger': '#f7768e',
      '--scrim': 'rgba(12, 7, 5, 0.62)',
      '--ok': '#b8d97a'
    },
    terminal: {
      background: '#16110f', foreground: '#e8dcd4', cursor: '#ff9e64', cursorAccent: '#16110f', selectionBackground: '#5c3524',
      ...ansiDark, red: '#f7768e', yellow: '#ffc777', blue: '#ff9e64', magenta: '#e39ac7', brightYellow: '#ffd89b', brightBlue: '#ffb98a'
    }
  },
  {
    id: 'bubblegum',
    name: 'Bubblegum',
    blurb: 'Maximum whimsy. No apologies.',
    swatch: ['#ff8fd0', '#9d8cff'],
    vars: {
      '--bg': '#14101c',
      '--bg-1': '#1c1628',
      '--bg-2': '#241c33',
      '--bg-3': '#2e243f',
      '--line': '#3b2f50',
      '--fg': '#e9dcf5',
      '--fg-dim': '#a996c2',
      '--fg-faint': '#7d6c94',
      '--accent': '#ff8fd0',
      '--accent-2': '#9d8cff',
      '--accent-dim': '#5a2e56',
      '--warn': '#ffd479',
      '--danger': '#ff7a9c',
      '--scrim': 'rgba(9, 5, 16, 0.62)',
      '--ok': '#8ce0b8'
    },
    terminal: {
      background: '#14101c', foreground: '#e9dcf5', cursor: '#ff8fd0', cursorAccent: '#14101c', selectionBackground: '#5a2e56',
      ...ansiDark, red: '#ff7a9c', magenta: '#ff8fd0', blue: '#9d8cff', cyan: '#7ee0e0', brightMagenta: '#ffb3e1', brightBlue: '#bcaaff'
    }
  },
  {
    id: 'paper',
    name: 'Paper',
    blurb: 'Daylight mode, for the brave.',
    swatch: ['#3b6ea5', '#8a5cf6'],
    vars: {
      '--bg': '#f7f6f3',
      '--bg-1': '#eeece7',
      '--bg-2': '#e5e2dc',
      '--bg-3': '#dbd7cf',
      '--line': '#c9c4ba',
      '--fg': '#2b2a27',
      '--fg-dim': '#5e5b54',
      '--fg-faint': '#8a857c',
      '--accent': '#3b6ea5',
      '--accent-2': '#8a5cf6',
      '--accent-dim': '#c3d6ea',
      '--warn': '#a5700f',
      '--danger': '#b13a3a',
      '--scrim': 'rgba(70, 66, 58, 0.28)',
      '--ok': '#3f7d34'
    },
    terminal: {
      background: '#f7f6f3', foreground: '#2b2a27', cursor: '#3b6ea5', cursorAccent: '#f7f6f3', selectionBackground: '#c3d6ea',
      black: '#2b2a27', red: '#b13a3a', green: '#3f7d34', yellow: '#a5700f', blue: '#3b6ea5', magenta: '#8a5cf6', cyan: '#2c7a74', white: '#5e5b54',
      brightBlack: '#8a857c', brightRed: '#cf4f4f', brightGreen: '#4f9642', brightYellow: '#c2871a', brightBlue: '#4a83c0', brightMagenta: '#9d74f8', brightCyan: '#358f88', brightWhite: '#2b2a27'
    }
  }
]

export function themeById(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}

/** Push a theme's variables onto :root. styles.css keeps matching fallbacks. */
export function applyTheme(id: string): Theme {
  const theme = themeById(id)
  const root = document.documentElement
  for (const [k, v] of Object.entries(theme.vars)) root.style.setProperty(k, v)
  root.dataset.theme = theme.id
  root.style.colorScheme = theme.id === 'paper' ? 'light' : 'dark'
  return theme
}
