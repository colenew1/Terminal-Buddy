export function timeAgo(ts: number): string {
  if (!ts) return 'unknown'
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  const m = s / 60
  if (m < 60) return `${Math.floor(m)}m ago`
  const h = m / 60
  if (h < 24) return `${Math.floor(h)}h ago`
  const d = h / 24
  if (d < 7) return `${Math.floor(d)}d ago`
  return new Date(ts).toLocaleDateString()
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function shortPath(p: string, keep = 3): string {
  if (!p) return ''
  const parts = p.split(/[\\/]/).filter(Boolean)
  if (parts.length <= keep) return p
  return '…' + parts.slice(-keep).join('\\')
}

/** Subsequence match — the cheap fuzzy filter behind the palette. */
export function fuzzy(needle: string, hay: string): boolean {
  if (!needle) return true
  const n = needle.toLowerCase()
  const h = hay.toLowerCase()
  let i = 0
  for (const ch of h) {
    if (ch === n[i]) i++
    if (i === n.length) return true
  }
  return false
}
