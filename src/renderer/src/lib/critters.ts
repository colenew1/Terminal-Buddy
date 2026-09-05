/**
 * Every pane gets a critter. Not only decoration — several panes in the same
 * folder are otherwise impossible to tell apart, and "the otter one" is a much
 * better handle than "the fourth one".
 *
 * Packs are cosmetic and swappable; hues are spread around the wheel so no two
 * neighbours read as the same colour.
 */
export interface Critter {
  emoji: string
  name: string
  hue: number
}

export interface CritterPack {
  id: string
  label: string
  critters: Critter[]
}

const forest: Critter[] = [
  { emoji: '🦊', name: 'fox', hue: 22 },
  { emoji: '🦦', name: 'otter', hue: 30 },
  { emoji: '🦉', name: 'owl', hue: 45 },
  { emoji: '🐸', name: 'frog', hue: 110 },
  { emoji: '🐢', name: 'turtle', hue: 140 },
  { emoji: '🦔', name: 'hedgehog', hue: 25 },
  { emoji: '🦝', name: 'raccoon', hue: 220 },
  { emoji: '🦌', name: 'deer', hue: 18 },
  { emoji: '🐿️', name: 'squirrel', hue: 35 },
  { emoji: '🦇', name: 'bat', hue: 265 },
  { emoji: '🐺', name: 'wolf', hue: 230 },
  { emoji: '🍄', name: 'mushroom', hue: 350 }
]

const robots: Critter[] = [
  { emoji: '🤖', name: 'bot', hue: 200 },
  { emoji: '👾', name: 'invader', hue: 280 },
  { emoji: '🛸', name: 'saucer', hue: 170 },
  { emoji: '⚙️', name: 'cog', hue: 40 },
  { emoji: '🔋', name: 'cell', hue: 110 },
  { emoji: '🧲', name: 'magnet', hue: 5 },
  { emoji: '💾', name: 'disk', hue: 220 },
  { emoji: '🕹️', name: 'stick', hue: 300 },
  { emoji: '📡', name: 'dish', hue: 190 },
  { emoji: '🔌', name: 'plug', hue: 60 },
  { emoji: '💡', name: 'bulb', hue: 50 },
  { emoji: '🧪', name: 'flask', hue: 150 }
]

const ocean: Critter[] = [
  { emoji: '🐳', name: 'whale', hue: 205 },
  { emoji: '🐬', name: 'dolphin', hue: 195 },
  { emoji: '🐙', name: 'octopus', hue: 320 },
  { emoji: '🦀', name: 'crab', hue: 8 },
  { emoji: '🦑', name: 'squid', hue: 300 },
  { emoji: '🐡', name: 'puffer', hue: 40 },
  { emoji: '🐠', name: 'fish', hue: 175 },
  { emoji: '🦭', name: 'seal', hue: 215 },
  { emoji: '🦈', name: 'shark', hue: 230 },
  { emoji: '🐚', name: 'shell', hue: 25 },
  { emoji: '🪸', name: 'coral', hue: 350 },
  { emoji: '🌊', name: 'wave', hue: 190 }
]

const space: Critter[] = [
  { emoji: '🚀', name: 'rocket', hue: 10 },
  { emoji: '🪐', name: 'saturn', hue: 40 },
  { emoji: '🛰️', name: 'satellite', hue: 200 },
  { emoji: '⭐', name: 'star', hue: 50 },
  { emoji: '🌙', name: 'moon', hue: 230 },
  { emoji: '☄️', name: 'comet', hue: 20 },
  { emoji: '🔭', name: 'scope', hue: 260 },
  { emoji: '🌌', name: 'galaxy', hue: 285 },
  { emoji: '👽', name: 'alien', hue: 120 },
  { emoji: '🌞', name: 'sun', hue: 45 },
  { emoji: '💫', name: 'spark', hue: 320 },
  { emoji: '🌑', name: 'eclipse', hue: 250 }
]

const garden: Critter[] = [
  { emoji: '🌻', name: 'sunflower', hue: 48 },
  { emoji: '🌵', name: 'cactus', hue: 120 },
  { emoji: '🌷', name: 'tulip', hue: 330 },
  { emoji: '🌿', name: 'sprig', hue: 140 },
  { emoji: '🍁', name: 'maple', hue: 15 },
  { emoji: '🌸', name: 'blossom', hue: 340 },
  { emoji: '🪴', name: 'pot', hue: 100 },
  { emoji: '🌾', name: 'wheat', hue: 42 },
  { emoji: '🌺', name: 'hibiscus', hue: 355 },
  { emoji: '🍀', name: 'clover', hue: 130 },
  { emoji: '🌱', name: 'seedling', hue: 110 },
  { emoji: '🪻', name: 'hyacinth', hue: 275 }
]

export const CRITTER_PACKS: CritterPack[] = [
  { id: 'forest', label: 'Forest', critters: forest },
  { id: 'robots', label: 'Robots', critters: robots },
  { id: 'ocean', label: 'Ocean', critters: ocean },
  { id: 'space', label: 'Space', critters: space },
  { id: 'garden', label: 'Garden', critters: garden }
]

export function packById(id: string): CritterPack {
  return CRITTER_PACKS.find((p) => p.id === id) ?? CRITTER_PACKS[0]
}

/** Every critter across every pack, for restoring one saved under an old pack. */
export const ALL_CRITTERS: Critter[] = CRITTER_PACKS.flatMap((p) => p.critters)

/** First critter in the pack not already in use, so open panes never collide. */
export function pickCritter(packId: string, taken: string[]): Critter {
  const pack = packById(packId).critters
  const used = new Set(taken)
  return pack.find((c) => !used.has(c.name)) ?? pack[taken.length % pack.length]
}

export function findCritter(name: string): Critter | undefined {
  return ALL_CRITTERS.find((c) => c.name === name)
}
