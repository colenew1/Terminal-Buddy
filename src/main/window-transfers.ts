import { BrowserWindow, ipcMain, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import type { Pos, TransferArrival, TransferState, Workspace } from '@shared/types'
import type { PtyManager } from './pty'
import type { PopoutWindows } from './popouts'
import { loadWorkspace, saveWorkspace } from './store'

interface WindowEntry { id: string; window: BrowserWindow; lastFocused: number }
interface Frame { channel: string; args: unknown[] }

/** Validates and snapshots every participant before changing any PTY ownership. */
export class WindowTransfers {
  private locked = new Set<string>()
  private pending = new Map<string, { sender: WebContents; resolve: (state: TransferState) => void }>()
  private queues = new Map<string, Frame[]>()
  private overflow = false
  private bytes = 0

  constructor(private windows: Map<string, WindowEntry>, private owners: Map<string, string>,
    private ptys: PtyManager, private popouts: PopoutWindows, private reveal: (window: BrowserWindow) => void) {}

  isBusy(): boolean { return this.locked.size > 0 }
  isLocked(id: string): boolean { return this.locked.has(id) }
  private entry(sender: WebContents): WindowEntry {
    const entry = [...this.windows.values()].find(w => w.window.webContents === sender)
    if (!entry) throw Error('Only a workspace can move terminals.')
    return entry
  }
  capture(id: string, channel: string, args: unknown[]): void {
    const queue = this.queues.get(id)
    if (!queue || this.overflow) return
    this.bytes += channel === 'pty:data' ? String(args[1]).length : 1024
    if (this.bytes > 16 * 1024 * 1024) { this.overflow = true; return }
    queue.push({ channel, args })
  }
  private request(entry: WindowEntry): Promise<TransferState> {
    return new Promise((resolve, reject) => {
      const token = randomUUID()
      const timer = setTimeout(() => { this.pending.delete(token); reject(Error('A window did not respond. Try again when it is ready.')) }, 5000)
      this.pending.set(token, { sender: entry.window.webContents, resolve: state => { clearTimeout(timer); resolve(state) } })
      entry.window.webContents.send('workspace:transferRequest', token)
    })
  }
  private targetAt(source: string, point: Pos): WindowEntry | undefined {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return
    return [...this.windows.values()].sort((a, b) => b.lastFocused - a.lastFocused).find(entry => {
      const w = entry.window
      if (entry.id === source || w.isDestroyed() || !w.isVisible() || w.isMinimized()) return false
      const b = w.getContentBounds()
      return point.x >= b.x && point.x < b.x + b.width && point.y >= b.y && point.y < b.y + b.height
    })
  }
  private clearHover(): void {
    for (const entry of this.windows.values()) entry.window.webContents.send('workspace:transferHover', false)
  }

  async move(sourceIds: string[], targetId: string, onlyId?: string, combine = false): Promise<void> {
    if (this.locked.size) throw Error('Another move is finishing. Please try again.')
    const target = this.windows.get(targetId)
    const sources = sourceIds.map(id => this.windows.get(id))
    if (!target || !sources.length || sources.some(s => !s || s.id === targetId)) throw Error('Choose another open workspace window.')
    const participants = [target, ...sources as WindowEntry[]]
    for (const entry of participants) this.locked.add(entry.id)
    this.bytes = 0; this.overflow = false
    for (const [id, owner] of this.owners) {
      if (sourceIds.includes(owner) && (!onlyId || id === onlyId)) this.queues.set(id, [])
    }
    try {
      const states = await Promise.all(participants.map(entry => this.request(entry)))
      for (let i = 0; i < states.length; i++) {
        const state = states[i], entry = participants[i]
        if (state.error) throw Error(state.error)
        if (!Array.isArray(state.sessions) || state.sessions.length > 16 || state.sessions.length !== state.workspace.sessions.length) throw Error('Workspace changed. Try the move again.')
        const ids = state.sessions.map(s => s.session.id)
        const owned = [...this.owners].filter(([, owner]) => owner === entry.id).map(([id]) => id)
        if (new Set(ids).size !== ids.length || ids.length !== owned.length || owned.some(id => !ids.includes(id))) throw Error('A terminal is still opening or closing. Try again.')
      }
      const moving = states.slice(1).flatMap(s => s.sessions).filter(s => !onlyId || s.session.id === onlyId)
      if (onlyId && (moving.length !== 1 || this.owners.get(onlyId) !== sourceIds[0])) throw Error('That terminal belongs to another workspace or has closed.')
      if (states[0].sessions.length + moving.length > 16) throw Error('The destination would exceed 16 terminals. Move fewer terminals or close some first.')
      const arrivals: TransferArrival[] = await Promise.all(moving.map(async item => {
        const snapshot = await this.ptys.snapshot(item.session.id)
        const current = this.ptys.describe(item.session.id)
        if (!current) throw Error('A terminal closed during the move.')
        return { ...item, ...current, snapshot }
      }))
      if (this.overflow || arrivals.some(item => !this.ptys.describe(item.session.id)) || participants.some(entry => entry.window.isDestroyed() || entry.window.webContents.isLoading())) throw Error('A window changed or output is too busy to move. Please try again.')
      const movedIds = new Set(moving.map(item => item.session.id))
      const movedSaved = states.slice(1).flatMap(state => state.workspace.sessions.filter((_s, i) => movedIds.has(state.sessions[i].session.id)))
      const targetWorkspace: Workspace = { ...states[0].workspace, sessions: [...states[0].workspace.sessions, ...movedSaved],
        activeIndex: arrivals.length ? states[0].sessions.length : states[0].workspace.activeIndex,
        unrestoredSessions: [...(states[0].workspace.unrestoredSessions ?? []), ...(combine ? states.slice(1).flatMap(s => s.workspace.unrestoredSessions ?? []) : [])] }
      const next = [targetWorkspace, ...states.slice(1).map(state => ({ ...state.workspace,
        sessions: state.workspace.sessions.filter((_s, i) => !movedIds.has(state.sessions[i].session.id)),
        activeIndex: 0, ...(combine ? { unrestoredSessions: [] } : {}) }))]
      const previous = participants.map(entry => loadWorkspace(entry.id))
      try {
        participants.forEach((entry, i) => saveWorkspace({ ...next[i], bounds: previous[i].bounds }, entry.id))
      } catch (error) {
        participants.forEach((entry, i) => { try { saveWorkspace(previous[i], entry.id) } catch { /* original error is surfaced */ } })
        throw error
      }
      // No await between ownership switch, arrival, and buffered output: ordered IPC.
      for (const item of arrivals) {
        this.popouts.dock(item.session.id, false)
        this.owners.set(item.session.id, targetId)
      }
      target.window.webContents.send('workspace:transferArrive', arrivals, targetWorkspace.unrestoredSessions)
      for (const source of sources as WindowEntry[]) source.window.webContents.send('workspace:transferRemove', [...movedIds])
      for (const item of arrivals) {
        for (const frame of this.queues.get(item.session.id) ?? []) {
          if (frame.channel === 'popout:state' || frame.channel === 'popout:dragging') continue
          if (frame.channel === 'pty:data' && Number(frame.args[2]) <= item.snapshot.seq) continue
          target.window.webContents.send(frame.channel, ...frame.args)
        }
      }
      this.queues.clear()
      this.reveal(target.window)
      // The saved empty source is already durable; destroy avoids a stale beforeunload save.
      if (combine) for (const source of sources as WindowEntry[]) source.window.destroy()
    } finally {
      this.queues.clear()
      for (const entry of participants) {
        this.locked.delete(entry.id)
        if (!entry.window.isDestroyed()) entry.window.webContents.send('workspace:transferEnd')
      }
      this.clearHover()
    }
  }

  register(): void {
    ipcMain.on('workspace:transferReply', (event, token: string, state: TransferState) => {
      const request = this.pending.get(token)
      if (!request || request.sender !== event.sender) return
      this.pending.delete(token); request.resolve(state)
    })
    ipcMain.handle('workspace:move', (event, id: string, target: string) => {
      const source = this.entry(event.sender)
      if (this.owners.get(id) !== source.id) throw Error('Only the owning workspace can move this terminal.')
      return this.move([source.id], target, id)
    })
    ipcMain.handle('workspace:combine', event => {
      const target = this.entry(event.sender)
      const sources = [...this.windows.keys()].filter(id => id !== target.id)
      if (!sources.length) return
      return this.move(sources, target.id, undefined, true)
    })
    ipcMain.on('workspace:drag', (event, id: string, point?: Pos) => {
      const source = [...this.windows.values()].find(w => w.window.webContents === event.sender)
      if (!source || this.owners.get(id) !== source.id) return
      const target = point ? this.targetAt(source.id, point) : undefined
      for (const entry of this.windows.values()) entry.window.webContents.send('workspace:transferHover', entry === target)
    })
    ipcMain.handle('workspace:drop', async (event, id: string, point: Pos) => {
      const source = this.entry(event.sender)
      if (this.owners.get(id) !== source.id) throw Error('Only the owning workspace can move this terminal.')
      this.clearHover()
      const target = this.targetAt(source.id, point)
      if (target) await this.move([source.id], target.id, id)
      else await this.popouts.open(id, point)
    })
  }
}
