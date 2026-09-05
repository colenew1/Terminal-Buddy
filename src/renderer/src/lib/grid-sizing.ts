/** Saved proportions apply only to the same number of tracks. */
export function gridWeights(count: number, saved: number[] = []): number[] {
  const total = Array.isArray(saved) ? saved.reduce((sum, n) => sum + n, 0) : 0
  if (saved?.length !== count || !Array.isArray(saved) || !saved.every((n) => Number.isFinite(n) && n > 0) || !Number.isFinite(total) || total <= 0) {
    return Array.from({ length: count }, () => 1 / count)
  }
  return saved.map((n) => n / total)
}

/** Transfer pixels between adjacent tracks, keeping all other tracks fixed. */
export function resizePair(weights: number[], index: number, delta: number, extent: number, minimum: number): number[] {
  if (index < 0 || index >= weights.length - 1 || extent <= 0 || !Number.isFinite(delta)) return weights
  const next = [...weights]
  const pair = weights[index] + weights[index + 1]
  const floor = Math.min(minimum / extent, pair / 2)
  next[index] = Math.max(floor, Math.min(pair - floor, weights[index] + delta / extent))
  next[index + 1] = pair - next[index]
  return next
}
