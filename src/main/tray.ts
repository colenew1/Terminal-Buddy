import { app, Menu, Tray, nativeImage, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

/** Packed via extraResources, so the path differs between dev and installed. */
function resourcePath(name: string): string {
  const candidates = [
    join(process.resourcesPath ?? '', 'resources', name),
    join(__dirname, '../../resources', name),
    join(app.getAppPath(), 'resources', name)
  ]
  return candidates.find((p) => p && existsSync(p)) ?? candidates[1]
}

export interface TrayHooks {
  onShow: () => void
  onNewTerminal: () => void
  onOpenFolder: () => void
  onQuit: () => void
  /** Recent project folders, newest first. */
  recentProjects: () => { name: string; path: string }[]
  openProject: (path: string) => void
}

export class TrayController {
  private tray: Tray | null = null
  private waiting = 0
  private total = 0

  constructor(
    private win: () => BrowserWindow | null,
    private hooks: TrayHooks
  ) {}

  enable(on: boolean): void {
    if (on && !this.tray) this.create()
    else if (!on && this.tray) this.destroy()
  }

  private create(): void {
    const icon = nativeImage.createFromPath(resourcePath('tray.png'))
    this.tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
    this.tray.on('click', () => this.hooks.onShow())
    this.tray.on('double-click', () => this.hooks.onShow())
    this.refresh()
  }

  private destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }

  /** Called whenever the renderer's fleet state changes. */
  setStatus(total: number, waiting: number): void {
    if (total === this.total && waiting === this.waiting) return
    this.total = total
    this.waiting = waiting
    this.refresh()
  }

  private statusLine(): string {
    if (this.total === 0) return 'Terminal Buddy — nothing open'
    if (this.waiting > 0) return `Terminal Buddy — ${this.waiting} need a look`
    return `Terminal Buddy — ${this.total} card${this.total === 1 ? '' : 's'}, all quiet`
  }

  private refresh(): void {
    if (!this.tray) return
    this.tray.setToolTip(this.statusLine())

    const recent = this.hooks.recentProjects().slice(0, 8)
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: this.statusLine(), enabled: false },
        { type: 'separator' },
        { label: 'Show Terminal Buddy', click: () => this.hooks.onShow() },
        { label: 'New chat or terminal…', click: () => this.hooks.onNewTerminal() },
        { label: 'Open folder…', click: () => this.hooks.onOpenFolder() },
        ...(recent.length
          ? [
              { type: 'separator' as const },
              {
                label: 'Recent projects',
                submenu: recent.map((p) => ({
                  label: p.name,
                  toolTip: p.path,
                  click: () => this.hooks.openProject(p.path)
                }))
              }
            ]
          : []),
        { type: 'separator' },
        { label: 'Quit', click: () => this.hooks.onQuit() }
      ])
    )
  }

  dispose(): void {
    this.destroy()
  }
}

/**
 * The number badge drawn over the taskbar icon. The renderer paints it — it has
 * a canvas and the live theme colours — and hands the result over as a data URL.
 */
export function setTaskbarBadge(win: BrowserWindow | null, dataUrl: string | null, waiting: number): void {
  if (!win || win.isDestroyed() || process.platform !== 'win32') return
  if (!dataUrl || waiting <= 0) {
    win.setOverlayIcon(null, '')
    return
  }
  try {
    const img = nativeImage.createFromDataURL(dataUrl)
    win.setOverlayIcon(img, `${waiting} terminal${waiting === 1 ? '' : 's'} waiting on you`)
  } catch {
    /* badge is cosmetic */
  }
}

/**
 * Right-clicking the taskbar icon offers a new terminal and your recent
 * folders. Folder paths are passed as argv, which the single-instance handler
 * already knows how to turn into a tab.
 */
export function setJumpList(recent: { name: string; path: string }[]): void {
  if (process.platform !== 'win32') return
  try {
    const exe = process.execPath
    const leading = app.isPackaged ? [] : [app.getAppPath()]
    app.setJumpList([
      {
        type: 'custom',
        name: 'Recent projects',
        items: recent.slice(0, 8).map((p) => ({
          type: 'task' as const,
          title: p.name,
          description: p.path,
          program: exe,
          args: [...leading, p.path].map((a) => `"${a}"`).join(' '),
          iconPath: exe,
          iconIndex: 0
        }))
      },
      { type: 'frequent' }
    ])
  } catch {
    /* jump lists are unavailable on some Windows configurations */
  }
}
