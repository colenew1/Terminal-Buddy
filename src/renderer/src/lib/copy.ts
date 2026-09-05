/**
 * Playful strings, kept in one place so the tone stays consistent — and so
 * anyone who finds it grating can flatten it in a single file.
 *
 * Rule of thumb: the chrome can have a personality, the data never lies. Counts,
 * paths and errors are always literal.
 */

export function greeting(d = new Date()): string {
  const h = d.getHours()
  if (h < 5) return 'Still up?'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  if (h < 22) return 'Good evening'
  return 'Burning the midnight oil'
}

/** Describes the current fleet in one line. Used by the buddy's tooltip. */
export function fleetStatus(total: number, busy: number, waiting: number): string {
  if (total === 0) return 'Nothing on the go — I am just vibing'
  const bits: string[] = []
  if (busy) bits.push(`${busy} producing output`)
  if (waiting) bits.push(`${waiting} paused`)
  if (bits.length === 0) return `${total} card${total === 1 ? '' : 's'}, all quiet`
  return bits.join(' · ')
}

export const SCAN_LINES = [
  'Rummaging through old conversations…',
  'Dusting off your transcripts…',
  'Reading everyone’s diaries…',
  'Counting turns, politely…',
  'Following the paper trail…'
]

export function scanLine(seed: number): string {
  return SCAN_LINES[seed % SCAN_LINES.length]
}

export const EMPTY_TIPS = [
  'Tip: right-click a folder in Explorer and pick “Open in Buddy”.',
  'Tip: Ctrl+Shift+G switches between tabs and grid.',
  'Tip: the catalog remembers every chat you have ever had.',
  'Tip: Alt+1 through Alt+9 jump straight to a terminal.',
  'Tip: broadcast mode types into every terminal at once.',
  'Tip: double-click a tab to rename it.'
]

export function randomTip(): string {
  return EMPTY_TIPS[Math.floor(Math.random() * EMPTY_TIPS.length)]
}

/** Shown when every pane has gone quiet and nothing needs you. */
export const ALL_QUIET = [
  'All quiet. Nothing needs you.',
  'Everyone’s napping.',
  'Inbox zero, terminal edition.'
]
