import { app, BrowserWindow, ipcMain, screen, type WebContents } from 'electron'
import { join } from 'node:path'
import type { Pos, Settings } from '@shared/types'
import type { PtyManager } from './pty'

interface Detached {
  window: BrowserWindow
  ready: boolean
  queue: { data: string; seq: number }[]
  bytes: number
  attention?: boolean
  drag?: { pointer: Pos; origin: Pos }
  timeout: ReturnType<typeof setTimeout>
}

/** Windows own a view, never a PTY. The primary renderer remains the workspace owner. */
export class PopoutWindows {
  private windows = new Map<string, Detached>()
  private stopping = false

  constructor(private ptys: PtyManager, private primary: (id: string) => BrowserWindow | null, private settings: () => Settings) {}

  private send(id: string, channel: string, ...args: unknown[]): void {
    const main = this.primary(id)
    if (main && !main.isDestroyed()) main.webContents.send(channel, ...args)
  }

  private owner(sender: WebContents, id: string): boolean {
    return this.windows.get(id)?.window.webContents === sender
  }

  isDetached(id: string): boolean { return this.windows.has(id) }

  parentOf(sender: WebContents): BrowserWindow | null {
    for (const [id, entry] of this.windows) if (entry.window.webContents === sender) return this.primary(id)
    return null
  }

  closeWorkspace(window: BrowserWindow): void {
    for (const id of [...this.windows.keys()]) if (this.primary(id) === window) this.dock(id, false)
  }
  canResize(sender: WebContents, id: string): boolean {
    return this.windows.has(id) ? this.owner(sender, id) : sender === this.primary(id)?.webContents
  }
  canInput(sender: WebContents, id: string, broadcast = false): boolean {
    return (sender === this.primary(id)?.webContents && (!this.isDetached(id) || broadcast)) || this.owner(sender, id)
  }

  focus(id: string): boolean {
    const entry = this.windows.get(id)
    if (!entry) return false
    if (entry.window.isMinimized()) entry.window.restore()
    entry.window.show(); entry.window.focus()
    return true
  }

  rename(id: string, title: string): void {
    const entry = this.windows.get(id)
    if (!entry) return
    entry.window.setTitle(title + ' — Terminal Buddy')
    entry.window.webContents.send('popout:title', title)
  }

  settingsChanged(settings: Settings): void {
    for (const entry of this.windows.values()) entry.window.webContents.send('popout:settings', settings)
  }

  event(channel: string, ...args: unknown[]): void {
    const [id, data, seq] = args as [string, string, number]
    const entry = this.windows.get(id)
    if (!entry || entry.window.isDestroyed()) return
    if (channel === 'pty:data' && !entry.ready) {
      entry.queue.push({ data, seq }); entry.bytes += data.length
      // A failed/slow renderer must not accumulate unbounded output.
      if (entry.bytes > 8 * 1024 * 1024) this.dock(id)
    } else if (entry.ready) entry.window.webContents.send(channel, ...args)
  }

  dock(id: string, reveal = true): void {
    const entry = this.windows.get(id)
    if (!entry) return
    this.windows.delete(id)
    clearTimeout(entry.timeout)
    if (!entry.window.isDestroyed()) entry.window.destroy()
    this.send(id, 'popout:dragging', false)
    if (!this.stopping) {
      this.send(id, 'popout:state', id, false)
      if (reveal) {
        const main = this.primary(id)
        if (main?.isMinimized()) main.restore()
        main?.show(); main?.focus()
      }
    }
  }

  closeAll(): void {
    this.stopping = true
    for (const id of [...this.windows.keys()]) this.dock(id, false)
  }

  async open(id: string, point?: Pos): Promise<void> {
    if (this.focus(id)) return
    if (!this.ptys.describe(id)) throw Error('This terminal has closed.')
    this.stopping = false
    const cursor = point && Number.isFinite(point.x) && Number.isFinite(point.y) ? point : screen.getCursorScreenPoint()
    const work = screen.getDisplayNearestPoint(cursor).workArea
    const width = Math.min(1000, work.width), height = Math.min(720, work.height)
    const child = new BrowserWindow({
      width, height, minWidth: 420, minHeight: 280, show: false,
      x: Math.round(Math.max(work.x, Math.min(cursor.x - 100, work.x + work.width - width))),
      y: Math.round(Math.max(work.y, Math.min(cursor.y - 20, work.y + work.height - height))),
      title: this.ptys.describe(id)!.session.title + ' — Terminal Buddy',
      backgroundColor: '#0f1115', autoHideMenuBar: true,
      icon: join(app.isPackaged ? process.resourcesPath : join(__dirname, '../..'), 'resources', 'icon.png'),
      webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: false, backgroundThrottling: false }
    })
    const entry: Detached = { window: child, ready: false, queue: [], bytes: 0,
      timeout: setTimeout(() => this.dock(id), 15000) }
    this.windows.set(id, entry)
    this.send(id, 'popout:state', id, true)
    child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    child.on('focus', () => this.send(id, 'popout:seen', id))
    child.on('close', (event) => {
      if (this.stopping) return
      event.preventDefault(); this.dock(id)
    })
    child.on('closed', () => { if (this.windows.get(id) === entry) this.dock(id) })
    child.webContents.on('render-process-gone', () => this.dock(id))
    let nativeDragging = false
    child.on('will-move', () => {
      nativeDragging = true
      this.primary(id)?.showInactive()
      this.send(id, 'popout:dragging', true, this.inDock(screen.getCursorScreenPoint(), id))
    })
    child.on('moved', () => {
      if (!nativeDragging) return
      nativeDragging = false
      this.send(id, 'popout:dragging', false)
      if (this.inDock(screen.getCursorScreenPoint(), id)) this.dock(id)
    })
    try {
      if (process.env.ELECTRON_RENDERER_URL) {
        const url = new URL(process.env.ELECTRON_RENDERER_URL); url.searchParams.set('popout', id)
        await child.loadURL(url.toString())
      } else await child.loadFile(join(__dirname, '../renderer/index.html'), { query: { popout: id } })
    } catch (error) { this.dock(id); throw error }
  }

  private inDock(point: Pos, id: string): boolean {
    const main = this.primary(id)
    if (!main || main.isDestroyed() || !main.isVisible() || main.isMinimized()) return false
    const b = main.getContentBounds()
    return point.x >= b.x + 20 && point.x <= b.x + b.width - 20 && point.y >= b.y + 40 && point.y <= b.y + 140
  }

  register(): void {
    ipcMain.on('popout:attention', (e, id: string, value: boolean) => {
      if (e.sender !== this.primary(id)?.webContents) return
      const entry = this.windows.get(id)
      if (!entry) return
      entry.attention = value === true
      if (entry.ready) entry.window.webContents.send('popout:attention', entry.attention)
    })
    ipcMain.on('popout:seen', (e, id: string) => {
      if (this.owner(e.sender, id)) this.send(id, 'popout:seen', id)
    })
    ipcMain.handle('popout:open', async (e, id: string, point?: Pos) => {
      if (e.sender !== this.primary(id)?.webContents) throw Error('Only the workspace can detach a terminal.')
      await this.open(id, point)
    })
    ipcMain.handle('popout:init', async (e, id: string) => {
      if (!this.owner(e.sender, id)) throw Error('Not this terminal window.')
      const entry = this.windows.get(id)!
      entry.ready = false; entry.queue = []; entry.bytes = 0
      const snapshot = await this.ptys.snapshot(id)
      if (this.windows.get(id) !== entry) throw Error('Window was docked.')
      // Reply and queued frames use one ordered IPC stream, not an invoke reply
      // racing live data in a different channel.
      entry.window.webContents.send('popout:init', { ...this.ptys.describe(id), snapshot, settings: this.settings() })
      for (const frame of entry.queue) if (frame.seq > snapshot.seq) entry.window.webContents.send('pty:data', id, frame.data, frame.seq)
      entry.queue = []; entry.bytes = 0; entry.ready = true
      entry.window.webContents.send('popout:attention', !!entry.attention)
      clearTimeout(entry.timeout)
      entry.window.show(); entry.window.focus()
    })
    ipcMain.on('popout:dock', (e, id: string) => {
      if (this.owner(e.sender, id) || e.sender === this.primary(id)?.webContents) this.dock(id)
    })
    ipcMain.on('popout:focus', (e, id: string) => { if (e.sender === this.primary(id)?.webContents) this.focus(id) })
    ipcMain.on('popout:drag', (e, id: string, phase: string, point: Pos) => {
      if (!this.owner(e.sender, id) || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return
      const entry = this.windows.get(id)!
      if (phase === 'start') {
        if (entry.window.isMaximized()) entry.window.unmaximize()
        const bounds = entry.window.getBounds()
        entry.drag = { pointer: point, origin: { x: bounds.x, y: bounds.y } }
        const main = this.primary(id)
        if (main?.isMinimized()) main.restore()
        main?.showInactive()
        this.send(id, 'popout:dragging', true, false)
      } else if (phase === 'move' && entry.drag) {
        entry.window.setPosition(Math.round(entry.drag.origin.x + point.x - entry.drag.pointer.x), Math.round(entry.drag.origin.y + point.y - entry.drag.pointer.y))
        this.send(id, 'popout:dragging', true, this.inDock(point, id))
      } else if (phase === 'end' || phase === 'cancel') {
        const dragging = !!entry.drag
        entry.drag = undefined
        this.send(id, 'popout:dragging', false)
        if (dragging && phase === 'end' && this.inDock(point, id)) this.dock(id)
      }
    })
  }
}
