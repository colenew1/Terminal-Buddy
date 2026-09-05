/**
 * A short two-note chime, synthesised rather than shipped as an audio file so
 * the bundle stays asset-free. Off by default — a notification you did not ask
 * for is worse than no notification.
 */
let ctx: AudioContext | null = null

export function chime(): void {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()

    const now = ctx.currentTime
    // A major sixth, quiet and short. Pleasant at 2am.
    for (const [i, freq] of [880, 1318.5].entries()) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq

      const t = now + i * 0.09
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(0.055, t + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32)

      osc.connect(gain).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 0.34)
    }
  } catch {
    /* audio unavailable — silence is an acceptable outcome */
  }
}
