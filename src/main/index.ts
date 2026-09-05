import { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, Menu, clipboard, Notification } from 'electron'
import { join } from 'node:path'
import { statSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import type {
  Catalog,
  ChatEntry,
  FeedSource,
  PersistedSession,
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
import { probeAgents } from './agents'
import { FeedService } from './session-feed'
import { prepareRestore, restoreSpec, validate } from './session-restore'
import { TerminalActivity, type TerminalAlert } from './terminal-activity'
import { PopoutWindows } from './popouts'
import {
  installCli,
  installContextMenu,
  integrationStatus,
  uninstallCli,
  uninstallContextMenu
} from './shell-integration'

/*
 * Running `electron out/main/index.js` in development does not pick up the
 * package name, so Electron falls back to "Electron" and the dev build ends up
 * with its own settings, workspace and catalog cache under %APPDATA%\Electron.
 * Pinning the name makes dev and the installed build share one profile, so what
 * you test is what ships.
 */
app.setName('terminal-buddy')

const shells = detectShells()
let alertsEnabled = false
const activity = new TerminalActivity((alert) => {
  void showTerminalNotification(alert).catch(() => sendToRenderer('app:notificationError', 'Windows could not display a desktop notification.'))
}, () => alertsEnabled)
const ptys = new PtyManager(shells, activity)
let activityTimer: NodeJS.Timeout | null = null
const activeNotifications = new Map<string, Notification>()

function showTerminalNotification(alert: TerminalAlert, test = false): Promise<{ ok: boolean; message: string }> {
  if (!Notification.isSupported()) return Promise.resolve({ ok: false, message: 'Desktop notifications are not supported on this system.' })
  return new Promise((resolve) => {
    const notification = new Notification({
      title: test ? 'Terminal Buddy — test alert' : `${alert.title} — ${alert.kind === 'exit' ? 'process exited' : 'output paused'}`,
      body: test ? 'Desktop alerts are ready. Click to return to Terminal Buddy.' : alert.kind === 'exit'
        ? 'The terminal process ended. Click to inspect its output.'
        : 'No output for 8 seconds. It may be finished, paused, or waiting for an answer. Click to open the terminal.',
      icon: join(app.isPackaged ? process.resourcesPath : join(__dirname, '../..'), 'resources', 'icon.png')
    })
    activeNotifications.get(alert.id)?.close()
    activeNotifications.set(alert.id, notification)
    // Retain click handlers while bounding references from long-lived workspaces.
    if (activeNotifications.size > 32) {
      const oldest = activeNotifications.keys().next().value!
      activeNotifications.get(oldest)?.close()
      activeNotifications.delete(oldest)
    }
    const timeout = setTimeout(() => resolve({ ok: false, message: 'Windows has not confirmed the alert. Check notification settings and Do not disturb.' }), 5000)
    notification.on('show', () => { clearTimeout(timeout); resolve({ ok: true, message: 'Test alert sent to Windows. If no banner appears, check Do not disturb and notification settings.' }) })
    notification.on('failed', (_event, error) => {
      clearTimeout(timeout)
      const message = `Desktop alert failed: ${error}`
      resolve({ ok: false, message })
      if (!test) sendToRenderer('app:notificationError', message)
    })
    notification.on('click', () => {
      if (!test && popouts.focus(alert.id)) return
      revealWindow()
      if (!test) sendToRenderer('app:selectTerminal', alert.id)
    })
    notification.on('close', () => { if (activeNotifications.get(alert.id) === notification) activeNotifications.delete(alert.id) })
    notification.show()
  })
}

let win: BrowserWindow | null = null
const popouts = new PopoutWindows(ptys, () => win, loadSettings)
ptys.onEvent = (channel, ...args) => popouts.event(channel, ...args)
let catalog: CatalogService | null = null
let tray: TrayController | null = null
let feeds: FeedService | null = null
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
    icon: join(app.isPackaged ? process.resourcesPath : join(__dirname, '../..'), 'resources', 'icon.png'),
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#161920', symbolColor: '#8b95a5', height: 38 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false
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
    popouts.closeAll()
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
  popouts.register()
  catalog = new CatalogService(cacheFile('catalog-cache.json'), (p: ScanProgress) =>
    sendToRenderer('catalog:progress', p)
  )

  ipcMain.handle('shells:get', () => shells)

  ipcMain.handle('pty:create', (e, spec: SessionSpec) => {
    if (e.sender !== win?.webContents) throw Error('Create terminals from the main workspace.')
    return ptys.create(spec)
  })
  ipcMain.on('pty:write', (e, id: string, data: string, broadcast = false) => {
    if (!popouts.canInput(e.sender, id, broadcast === true)) return
    ptys.write(id, data)
    if (e.sender !== win?.webContents) sendToRenderer('popout:input', id)
  })
  ipcMain.handle('pty:submit', (e, id: string, data: string) => {
    if (!popouts.canInput(e.sender, id)) throw Error('Not this terminal window.')
    if (typeof data !== 'string' || !data.length) throw new Error('No text to submit.')
    return ptys.submit(id, data)
  })
  ipcMain.on('pty:resize', (e, id: string, cols: number, rows: number) => {
    if (!popouts.canResize(e.sender, id)) return
    ptys.resize(id, cols, rows)
    if (popouts.isDetached(id)) sendToRenderer('popout:size', id, cols, rows)
  })
  ipcMain.on('pty:kill', (e, id: string) => {
    if (e.sender !== win?.webContents) return
    popouts.dock(id, false)
    ptys.kill(id)
    activeNotifications.get(id)?.close()
    activeNotifications.delete(id)
  })
  ipcMain.on('pty:rename', (e, id: string, title: string) => {
    if (e.sender !== win?.webContents) return
    if (typeof title === 'string' && title.trim()) {
      const name = title.trim().slice(0, 100)
      activity.rename(id, name); ptys.rename(id, name); popouts.rename(id, name)
    }
  })
  ipcMain.handle('app:testNotification', () => showTerminalNotification({ id: 'test', title: 'Terminal Buddy', kind: 'quiet' }, true))
  ipcMain.handle('pty:link', async (e, id: string, chat: ChatEntry) => {
    if (e.sender !== win?.webContents) throw Error('Link chats from the main workspace.')
    const current = ptys.describe(id)?.session
    if (!current) throw Error('This terminal has closed.')
    const resume = { agent: chat.agent, id: chat.id, path: chat.path }
    await validate({ ...current, cwd: chat.cwd, resume })
    // Only recovery metadata changes. Never write to, restart, or replace the PTY.
    return ptys.link(id, resume, chat.cwd)
  })

  // Which panes are currently running an agent, keyed by session id.
  ipcMain.handle('pty:probeAgents', async () => {
    const live = ptys.list()
    const byPid = await probeAgents(live.map((s) => s.pid))
    const out: Record<string, string | null> = {}
    for (const s of live) out[s.id] = byPid[s.pid] ?? null
    return out
  })

  ipcMain.handle('settings:get', () => loadSettings())
  ipcMain.handle('settings:set', (_e, s: Settings) => {
    saveSettings(s)
    alertsEnabled = s.desktopNotifications
    if (!alertsEnabled) {
      win?.flashFrame(false)
      for (const notification of activeNotifications.values()) notification.close()
      activeNotifications.clear()
    }
    ptys.setScrollback(s.scrollback)
    popouts.settingsChanged(s)
    tray?.enable(s.trayIcon)
    return s
  })

  ipcMain.handle('workspace:get', () => loadWorkspace())
  ipcMain.handle('workspace:prepareRestore', (_e, sessions: PersistedSession[]) => prepareRestore(sessions))
  ipcMain.handle('workspace:restoreSpec', (_e, session: PersistedSession) => restoreSpec(session, loadSettings()))
  ipcMain.on('workspace:saveSync', (event, w: Workspace) => {
    if (event.sender !== win?.webContents) { event.returnValue = 'Only the main workspace can save sessions.'; return }
    try {
      saveWorkspace({ ...w, bounds: loadWorkspace().bounds })
      event.returnValue = null
    } catch (error) { event.returnValue = (error as Error).message }
  })
  ipcMain.handle('workspace:set', (e, w: Workspace) => {
    if (e.sender !== win?.webContents) throw Error('Only the main workspace can save sessions.')
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
      title: 'Choose a folder for Terminal Buddy',
      defaultPath: app.getPath('home')
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
      if (alertsEnabled && waiting > 0 && win && !win.isFocused()) win.flashFrame(true)
      else win?.flashFrame(false)
    }
  )

  ipcMain.on('app:show', () => revealWindow())

  feeds = new FeedService(
    (sessionId, events) => sendToRenderer('feed:events', sessionId, events),
    (sessionId, agent) => sendToRenderer('feed:agent', sessionId, agent)
  )
  ipcMain.on('feed:attach', (_e, sessionId: string, cwd: string, source?: FeedSource) => feeds?.attach(sessionId, cwd, source))
  ipcMain.on('feed:detach', (_e, sessionId: string) => feeds?.detach(sessionId))

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
    alertsEnabled = loadSettings().desktopNotifications
    ptys.setScrollback(loadSettings().scrollback)
    activityTimer = setInterval(() => activity.tick(), 1000)
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
    popouts.closeAll()
    if (activityTimer) clearInterval(activityTimer)
    for (const notification of activeNotifications.values()) notification.close()
    activeNotifications.clear()
    quitting = true
    tray?.dispose()
    feeds?.dispose()
  })
  // Let renderer beforeunload flush the final workspace before stopping PTYs.
  app.on('will-quit', () => ptys.killAll())
}
