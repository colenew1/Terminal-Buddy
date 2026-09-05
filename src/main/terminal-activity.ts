export type TerminalAlert = { id: string; title: string; kind: 'quiet' | 'exit' }
type Activity = { title: string; submitted: boolean; pending: boolean; lastActivity: number; lastAlert: number }

/** Output silence is a pause signal, never proof that an agent completed its task. */
export class TerminalActivity {
  private sessions = new Map<string, Activity>()
  constructor(private emit: (alert: TerminalAlert) => void, private enabled: () => boolean,
    private now: () => number = Date.now, private quietMs = 8000, private cooldownMs = 30000) {}

  register(id: string, title: string, launched = false): void {
    this.sessions.set(id, { title, submitted: launched, pending: launched, lastActivity: this.now(), lastAlert: -Infinity })
  }
  rename(id: string, title: string): void { const s = this.sessions.get(id); if (s) s.title = title }
  input(id: string, data: string): void {
    const s = this.sessions.get(id)
    if (!s) return
    // Ignore device-status replies and arrows. Enter submits a command/answer;
    // ordinary typing postpones a pending alert rather than creating one.
    if (!/[\r\n]/.test(data) && !/^[^\x00-\x1f\x7f]/.test(data) && data !== '\x03') return
    s.lastActivity = this.now()
    if (/[\r\n]/.test(data) || data === '\x03') { s.submitted = true; s.pending = true }
    else s.pending = false
  }
  output(id: string): void {
    const s = this.sessions.get(id)
    if (!s) return
    s.lastActivity = this.now()
    if (s.submitted) s.pending = true
  }
  tick(): void {
    const now = this.now()
    for (const [id, s] of this.sessions) {
      if (!s.pending || now - s.lastActivity < this.quietMs || now - s.lastAlert < this.cooldownMs) continue
      s.pending = false
      // Consume quiet episodes even while disabled, so enabling isn't a burst
      // of stale notifications about work that ended long ago.
      if (!this.enabled()) continue
      s.lastAlert = now
      this.emit({ id, title: s.title, kind: 'quiet' })
    }
  }
  exit(id: string): void {
    const s = this.sessions.get(id)
    if (s && s.submitted && this.enabled()) this.emit({ id, title: s.title, kind: 'exit' })
    this.sessions.delete(id)
  }
  remove(id: string): void { this.sessions.delete(id) }
}
