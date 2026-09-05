import { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, Menu, clipboard } from 'electron'
import { join } from 'node:path'
import { statSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import type {
  Catalog,
  ChatEntry,
  ScanProgress,
  SessionSpec,
  Settings,
  Workspace
} from '@shared/types'
import { detectShells } from './shells'
import { PtyManager } from './pty'
import { CatalogService, buildMarkdown } from './catalog'
import { loadSettings, saveSettings, loadWorkspace, saveWorkspace, cacheFile } from './store'
import { TrayController, setTaskbarBadge, setJumpList } from './tray'
import {
  installCli,
  installContextMenu,
  integrationStatus,
  uninstallCli,
  uninstallContextMenu
} from './shell-integration'

const shells = detectShells()
const ptys = new PtyManager(shells)

let win: BrowserWindow | null = null
let catalog: CatalogService | null = null
let tray: TrayController | null = null
/** Distinguishes "user closed the window" from "app is really quitting". */
let quitting = false
/** Folders requested before the renderer was ready to receive them. */
const pendingFolders: string[] = []

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/**
 * Explorer hands us the folder as a trailing argument. In dev there is an extra
 * leading argument (the app directory) which is itself a real directory, so skip
 * anything that matches the app path.
 */
function folderFromArgv(argv: string[]): string | null {
  const appPath = app.getAppPath()
  for (let i = argv.length - 1; i >= 1; i--) {
    const a = argv[i]
    if (!a || a.startsWith('--') || a.startsWith('-')) continue
    if (a === appPath) continue
    if (isDirectory(a)) return a
  }
  return null
}

function sendToRenderer(channel: string, ...args: unknown[]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
}

function revealWindow(): void {
  if (!win || win.isDestroyed()) {
    createWindow()
    return
  }
  if (!win.isVisible()) win.show()
  if (win.isMinimized()) win.restore()
  win.focus()
}

function openFolder(dir: string): void {
  if (win && !win.isDestroyed() && win.webContents.isLoading() === false) {
    if (win.isMinimized()) win.restore()
    win.focus()
    sendToRenderer('app:open-folder', dir)
  } else {
    pendingFolders.push(dir)
  }
}

function createWindow(): void {
  const ws = loadWorkspace()
  const b = ws.bounds

  win = new BrowserWindow({
    width: b?.width ?? 1400,
    height: b?.height ?? 900,
    x: b?.x,
    y: b?.y,
    minWidth: 780,
    minHeight: 480,
    show: false,
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#161920', symbolColor: '#8b95a5', height: 38 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })

  if (b?.maximized) win.maximize()

  win.on('ready-to-show', () => {
    win?.show()
    // Anything Explorer asked for while we were booting.
    while (pendingFolders.length) sendToRenderer('app:open-folder', pendingFolders.shift())
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => undefined)
    return { action: 'deny' }
  })

  ptys.setTarget(win.webContents)

  const saveBounds = (): void => {
    if (!win || win.isDestroyed()) return
    const cur = loadWorkspace()
    const nb = win.getNormalBounds()
    saveWorkspace({
      ...cur,
      bounds: { x: nb.x, y: nb.y, width: nb.width, height: nb.height, maximized: win.isMaximized() }
    })
  }
  win.on('resized', saveBounds)
  win.on('moved', saveBounds)
  win.on('maximize', saveBounds)
  win.on('unmaximize', saveBounds)

  // With a tray icon present, closing can mean "get out of the way" rather
  // than "kill eight running agents".
  win.on('close', (e) => {
    if (quitting) return
    if (loadSettings().closeToTray && loadSettings().trayIcon) {
      e.preventDefault()
      win?.hide()
    }
  })

  win.on('minimize', () => {
    const s = loadSettings()
    if (s.minimizeToTray && s.trayIcon) win?.hide()
  })

  win.on('closed', () => {
    win = null
    ptys.setTarget(null)
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/* --------------------------------------------------------------- ipc wiring */

function registerIpc(): void {
  catalog = new CatalogService(cacheFile('catalog-cache.json'), (p: ScanProgress) =>
    sendToRenderer('catalog:progress', p)
  )

  ipcMain.handle('shells:get', () => shells)

  ipcMain.handle('pty:create', (_e, spec: SessionSpec) => ptys.create(spec))
  ipcMain.on('pty:write', (_e, id: string, data: string) => ptys.write(id, data))
  ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) => ptys.resize(id, cols, rows))
  ipcMain.on('pty:kill', (_e, id: string) => ptys.kill(id))

  ipcMain.handle('settings:get', () => loadSettings())
  ipcMain.handle('settings:set', (_e, s: Settings) => {
    saveSettings(s)
    tray?.enable(s.trayIcon)
    return s
  })

  ipcMain.handle('workspace:get', () => loadWorkspace())
  ipcMain.handle('workspace:set', (_e, w: Workspace) => {
    // Keep whatever bounds the window listeners already recorded.
    const cur = loadWorkspace()
    saveWorkspace({ ...w, bounds: cur.bounds })
  })

  const withJumpList = async (c: Promise<Catalog>): Promise<Catalog> => {
    const result = await c
    setJumpList(recentProjects())
    return result
  }

  ipcMain.handle('catalog:get', async (): Promise<Catalog> => {
    if (catalog?.cached) return catalog.cached
    return withJumpList(catalog!.scan(projectRoots()))
  })
  ipcMain.handle('catalog:refresh', async (): Promise<Catalog> => withJumpList(catalog!.scan(projectRoots())))

  ipcMain.handle('catalog:transcript', async (_e, entry: ChatEntry) => {
    const { turns, truncated } = await catalog!.transcript(entry.path, entry.agent)
    return { entry, turns, truncated }
  })

  ipcMain.handle('catalog:export', async (_e, entry: ChatEntry) => {
    const settings = loadSettings()
    const template = entry.agent === 'claude' ? settings.claudeResumeCommand : settings.codexResumeCommand
    const { turns, truncated } = await catalog!.transcript(entry.path, entry.agent)
    const safe = entry.title.replace(/[^\w .-]+/g, '_').slice(0, 60).trim() || 'chat'

    const res = await dialog.showSaveDialog(win!, {
      title: 'Export chat as Markdown',
      defaultPath: join(app.getPath('downloads'), `${safe}.md`),
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (res.canceled || !res.filePath) return { ok: false, message: 'Cancelled' }

    const md = buildMarkdown({ entry, turns, truncated }, template.replace('{id}', entry.id))
    await writeFile(res.filePath, md, 'utf8')
    shell.showItemInFolder(res.filePath)
    return { ok: true, message: `Saved ${res.filePath}` }
  })

  ipcMain.handle('integration:status', () => integrationStatus())
  ipcMain.handle('integration:installContextMenu', () => installContextMenu())
  ipcMain.handle('integration:uninstallContextMenu', () => uninstallContextMenu())
  ipcMain.handle('integration:installCli', () => installCli())
  ipcMain.handle('integration:uninstallCli', () => uninstallCli())

  ipcMain.handle('dialog:pickFolder', async () => {
    const res = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory'],
      title: 'Open folder in Buddy'
    })
    return res.canceled ? null : res.filePaths[0]
  })

  ipcMain.handle('app:paths', () => ({
    home: homedir(),
    userData: app.getPath('userData'),
    version: app.getVersion(),
    packaged: app.isPackaged,
    platform: process.platform
  }))

  ipcMain.on(
    'app:status',
    (_e, total: number, waiting: number, badge: string | null) => {
      tray?.setStatus(total, waiting)
      setTaskbarBadge(win, badge, waiting)
      // Bounce the taskbar button once when something starts waiting.
      if (waiting > 0 && win && !win.isFocused()) win.flashFrame(true)
      else win?.flashFrame(false)
    }
  )

  ipcMain.on('app:show', () => revealWindow())

  ipcMain.handle('clipboard:read', () => clipboard.readText())
  ipcMain.on('clipboard:write', (_e, text: string) => clipboard.writeText(text))

  ipcMain.on('app:openExternal', (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => undefined)
  })
  ipcMain.on('app:revealPath', (_e, p: string) => shell.showItemInFolder(p))
  ipcMain.on('app:openPath', (_e, p: string) => {
    shell.openPath(p).catch(() => undefined)
  })
}

/** Most recently used project folders that still exist on disk. */
function recentProjects(): { name: string; path: string }[] {
  return (catalog?.cached?.projects ?? [])
    .filter((p) => p.exists)
    .slice(0, 8)
    .map((p) => ({ name: p.name, path: p.path }))
}

/** Folders worth checking for project-level `.claude/skills`. */
function projectRoots(): string[] {
  const roots = new Set<string>()
  for (const p of catalog?.cached?.projects ?? []) if (p.exists) roots.add(p.path)
  for (const s of loadSettings().extraSkillRoots) roots.add(s)
  return [...roots]
}

/* ------------------------------------------------------------------ startup */

// A second "Open in Buddy" must add a tab here, not launch another copy.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const dir = folderFromArgv(argv)
    if (dir) openFolder(dir)
    else if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    nativeTheme.themeSource = 'dark'
    // Must match electron-builder's appId, or Windows treats a pinned
    // shortcut and the running window as two different apps.
    app.setAppUserModelId('com.terminalbuddy.app')

    // Electron's default menu registers Ctrl+V (and friends) as accelerators,
    // and Alt opens its hidden menu bar. Both fight the terminal, so the app
    // owns every clipboard key itself — see renderer/src/lib/clipboard.ts.
    Menu.setApplicationMenu(null)

    registerIpc()
    createWindow()

    tray = new TrayController(() => win, {
      onShow: () => revealWindow(),
      onNewTerminal: () => {
        revealWindow()
        sendToRenderer('app:new-terminal')
      },
      onOpenFolder: async () => {
        revealWindow()
        const res = await dialog.showOpenDialog({ properties: ['openDirectory'] })
        if (!res.canceled && res.filePaths[0]) openFolder(res.filePaths[0])
      },
      onQuit: () => {
        quitting = true
        app.quit()
      },
      recentProjects,
      openProject: (p) => {
        revealWindow()
        openFolder(p)
      }
    })
    tray.enable(loadSettings().trayIcon)

    const initial = folderFromArgv(process.argv)
    if (initial) pendingFolders.push(initial)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    ptys.killAll()
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    quitting = true
    tray?.dispose()
    ptys.killAll()
  })
}
