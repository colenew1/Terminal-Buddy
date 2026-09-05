/**
 * Every terminal gets a critter. This is not only decoration — six tabs all
 * called "Owner" are impossible to tell apart, and "the otter one" is a much
 * better handle than "the fourth one".
 */
export interface Critter {
  emoji: string
  name: string
  hue: number
}

export const CRITTERS: Critter[] = [
  { emoji: '🦊', name: 'fox', hue: 22 },
  { emoji: '🦦', name: 'otter', hue: 30 },
  { emoji: '🦉', name: 'owl', hue: 45 },
  { emoji: '🐸', name: 'frog', hue: 110 },
  { emoji: '🐢', name: 'turtle', hue: 140 },
  { emoji: '🐳', name: 'whale', hue: 200 },
  { emoji: '🐬', name: 'dolphin', hue: 195 },
  { emoji: '🐙', name: 'octopus', hue: 320 },
  { emoji: '🦀', name: 'crab', hue: 8 },
  { emoji: '🐝', name: 'bee', hue: 48 },
  { emoji: '🦔', name: 'hedgehog', hue: 25 },
  { emoji: '🦝', name: 'raccoon', hue: 220 },
  { emoji: '🦥', name: 'sloth', hue: 90 },
  { emoji: '🐧', name: 'penguin', hue: 210 },
  { emoji: '🐨', name: 'koala', hue: 250 },
  { emoji: '🐼', name: 'panda', hue: 280 },
  { emoji: '🐱', name: 'cat', hue: 35 },
  { emoji: '🐺', name: 'wolf', hue: 230 },
  { emoji: '🦎', name: 'gecko', hue: 130 },
  { emoji: '🦇', name: 'bat', hue: 265 },
  { emoji: '🐿️', name: 'squirrel', hue: 18 },
  { emoji: '🦭', name: 'seal', hue: 205 },
  { emoji: '🦆', name: 'duck', hue: 55 },
  { emoji: '🐴', name: 'horse', hue: 15 }
]

/** First critter not already in use, so open panes never collide. */
export function pickCritter(taken: string[]): Critter {
  const used = new Set(taken)
  return CRITTERS.find((c) => !used.has(c.name)) ?? CRITTERS[taken.length % CRITTERS.length]
}
