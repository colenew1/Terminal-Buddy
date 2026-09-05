/**
 * Paints the little count that sits over the taskbar icon.
 *
 * The renderer draws it rather than the main process because this is where the
 * canvas and the live theme colours are; main only turns the data URL into a
 * nativeImage. Returns null when there is nothing to show.
 */
export function drawBadge(count: number): string | null {
  if (count <= 0) return null

  const size = 32
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const css = getComputedStyle(document.documentElement)
  const warn = css.getPropertyValue('--warn').trim() || '#f0c674'
  const bg = css.getPropertyValue('--bg').trim() || '#0f1115'

  // A ring in the window background colour keeps the badge legible against
  // whatever the taskbar happens to be.
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
  ctx.fillStyle = bg
  ctx.fill()

  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2)
  ctx.fillStyle = warn
  ctx.fill()

  const label = count > 9 ? '9+' : String(count)
  ctx.fillStyle = bg
  ctx.font = `700 ${label.length > 1 ? 17 : 21}px "Segoe UI", system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, size / 2, size / 2 + 1)

  return canvas.toDataURL('image/png')
}
