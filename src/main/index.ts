import { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, Menu, clipboard, Notification } from 'electron'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
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
import { loadSettings, saveSettings, loadWorkspace, saveWorkspace, loadWindowIds, saveWindowIds, cacheFile } from './store'
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
  void showTerminalNotification(alert).catch(() => sendToSession(alert.id, 'app:notificationError', 'The system could not display a desktop notification.'))
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
    const timeout = setTimeout(() => resolve({ ok: false, message: 'The system has not confirmed the alert. Check notification settings and Do not disturb.' }), 5000)
    notification.on('show', () => { clearTimeout(timeout); resolve({ ok: true, message: 'Test alert sent. If no banner appears, check Do not disturb and notification settings.' }) })
    notification.on('failed', (_event, error) => {
      clearTimeout(timeout)
      const message = `Desktop alert failed: ${error}`
      resolve({ ok: false, message })
      if (!test) sendToSession(alert.id, 'app:notificationError', message)
    })
    notification.on('click', () => {
      if (!test && popouts.focus(alert.id)) return
      revealWindow(test ? activeWindow() : ownerWindow(alert.id))
      if (!test) sendToSession(alert.id, 'app:selectTerminal', alert.id)
    })
    notification.on('close', () => { if (activeNotifications.get(alert.id) === notification) activeNotifications.delete(alert.id) })
    notification.show()
  })
}

interface WorkspaceWindow { id: string; label: string; window: BrowserWindow; total: number; waiting: number }
const windows = new Map<string, WorkspaceWindow>()
const sessionOwners = new Map<string, string>()
let activeWindowId = 'primary'
let nextWindowNumber = 1
const ownerWindow = (sessionId: string): BrowserWindow | null => windows.get(sessionOwners.get(sessionId) ?? '')?.window ?? null
const popouts = new PopoutWindows(ptys, ownerWindow, loadSettings)
ptys.onEvent = (channel, ...args) => {
  sendToSession(args[0] as string, channel, ...args)
  popouts.event(channel, ...args)
}
function workspaceFor(sender: WebContents): WorkspaceWindow {
  const workspace = [...windows.values()].find(entry => entry.window.webContents === sender)
  if (!workspace) throw Error('Only a workspace window can perform this action.')
  return workspace
}
function ownsSession(sender: WebContents, id: string): boolean {
  return sender === ownerWindow(id)?.webContents
}
function activeWindow(): BrowserWindow | null {
  return windows.get(activeWindowId)?.window ?? windows.values().next().value?.window ?? null
}
function updateFleetStatus(): void {
  const all = [...windows.values()]
  const total = all.reduce((sum, entry) => sum + entry.total, 0)
  const waiting = all.reduce((sum, entry) => sum + entry.waiting, 0)
  tray?.setStatus(total, waiting)
  if (process.platform === 'darwin') setTaskbarBadge(activeWindow(), null, waiting)
}
function announceWindows(): void {
  sendToRenderer('app:windowsChanged')
}
function persistWindowList(): void {
  if (windows.size) saveWindowIds([...windows.keys()])
}
function stopWorkspaceTerminals(window: BrowserWindow, id: string): void {
  popouts.closeWorkspace(window)
  for (const [sessionId, owner] of sessionOwners) {
    if (owner !== id) continue
    feeds?.detach(sessionId)
    ptys.kill(sessionId)
    sessionOwners.delete(sessionId)
    activeNotifications.get(sessionId)?.close(); activeNotifications.delete(sessionId)
  }
  const entry = windows.get(id)
  if (entry) { entry.total = 0; entry.waiting = 0 }
}
let catalog: CatalogService | null = null
let tray: TrayController | null = null
let feeds: FeedService | null = null
/** Distinguishes "user closed the window" from "app is really quitting". */
let quitting = false

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
  for (const entry of windows.values()) if (!entry.window.isDestroyed()) entry.window.webContents.send(channel, ...args)
}
function sendToSession(id: string, channel: string, ...args: unknown[]): void {
  const target = ownerWindow(id)
  if (target && !target.isDestroyed()) target.webContents.send(channel, ...args)
}

function revealWindow(target = activeWindow()): BrowserWindow {
  const window = target && !target.isDestroyed() ? target : createWindow()
  if (!window.isVisible()) window.show()
  if (window.isMinimized()) window.restore()
  window.focus()
  return window
}

function openFolder(dir: string): void {
  const target = revealWindow()
  if (!target.webContents.isLoading()) target.webContents.send('app:open-folder', dir)
  else target.webContents.once('did-finish-load', () => target.webContents.send('app:open-folder', dir))
}

function createWindow(id: string = randomUUID(), persist = true): BrowserWindow {
  if (windows.size >= 32) throw Error('Close a workspace window before opening another (32 maximum).')
  const ws = loadWorkspace(id)
  const b = ws.bounds
  const current = activeWindow()?.getNormalBounds()
  const label = `Window ${nextWindowNumber++}`
  const title = `${label} — Terminal Buddy`
  const win = new BrowserWindow({
    title,
    width: b?.width ?? 1400, height: b?.height ?? 900,
    x: b?.x ?? (current ? current.x + 30 : undefined),
    y: b?.y ?? (current ? current.y + 30 : undefined),
    minWidth: 780, minHeight: 480, show: false,
    icon: join(app.isPackaged ? process.resourcesPath : join(__dirname, '../..'), 'resources', 'icon.png'),
    backgroundColor: '#0f1115', autoHideMenuBar: true, titleBarStyle: 'hidden',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 12, y: 12 } }
      : { titleBarOverlay: { color: '#161920', symbolColor: '#8b95a5', height: 38 } }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'), contextIsolation: true,
      nodeIntegration: false, sandbox: false, spellcheck: false, backgroundThrottling: false
    }
  })
  windows.set(id, { id, label, window: win, total: 0, waiting: 0 })
  activeWindowId = id
  if (persist) persistWindowList()
  win.on('page-title-updated', (event) => { event.preventDefault(); win.setTitle(title) })
  if (b?.maximized) win.maximize()
  win.on('focus', () => { activeWindowId = id })
  win.on('ready-to-show', () => {
    win.show()
    announceWindows()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => undefined)
    return { action: 'deny' }
  })
  const saveBounds = (): void => {
    if (win.isDestroyed()) return
    const nb = win.getNormalBounds()
    saveWorkspace({ ...loadWorkspace(id), bounds: { ...nb, maximized: win.isMaximized() } }, id)
  }
  win.on('resized', saveBounds); win.on('moved', saveBounds)
  win.on('maximize', saveBounds); win.on('unmaximize', saveBounds)
  win.on('close', (e) => {
    if (quitting) return
    if (loadSettings().closeToTray && loadSettings().trayIcon) { e.preventDefault(); win.hide() }
  })
  win.on('minimize', () => { const s = loadSettings(); if (s.minimizeToTray && s.trayIcon) win.hide() })
  win.on('closed', () => {
    // Pop-outs are views belonging to this workspace; other workspaces stay live.
    stopWorkspaceTerminals(win, id)
    windows.delete(id)
    // Quitting retains every open window. Closing the last window retains it
    // for next launch; explicitly closed siblings leave the reopening list.
    if (!quitting) persistWindowList()
    updateFleetStatus(); announceWindows()
  })
  // A crashed/reloaded renderer must never leave invisible PTYs behind or
  // create duplicates when its persisted workspace is recovered.
  win.webContents.on('render-process-gone', () => {
    stopWorkspaceTerminals(win, id)
    updateFleetStatus()
  })
  win.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) {
      stopWorkspaceTerminals(win, id)
      updateFleetStatus()
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL); url.searchParams.set('workspace', id)
    void win.loadURL(url.toString())
  } else void win.loadFile(join(__dirname, '../renderer/index.html'), { query: { workspace: id } })
  return win
}

/* --------------------------------------------------------------- ipc wiring */

function registerIpc(): void {
  popouts.register()
  catalog = new CatalogService(cacheFile('catalog-cache.json'), (p: ScanProgress) =>
    sendToRenderer('catalog:progress', p)
  )

  ipcMain.handle('shells:get', () => shells)

  ipcMain.handle('pty:create', (e, spec: SessionSpec) => {
    const workspace = workspaceFor(e.sender)
    const session = ptys.create(spec)
    sessionOwners.set(session.id, workspace.id)
    return session
  })
  ipcMain.on('pty:write', (e, id: string, data: string, broadcast = false) => {
    if (!popouts.canInput(e.sender, id, broadcast === true)) return
    ptys.write(id, data)
    if (!ownsSession(e.sender, id)) sendToSession(id, 'popout:input', id)
  })
  ipcMain.handle('pty:submit', (e, id: string, data: string) => {
    if (!popouts.canInput(e.sender, id)) throw Error('Not this terminal window.')
    if (typeof data !== 'string' || !data.length) throw new Error('No text to submit.')
    return ptys.submit(id, data)
  })
  ipcMain.on('pty:resize', (e, id: string, cols: number, rows: number) => {
    if (!popouts.canResize(e.sender, id)) return
    ptys.resize(id, cols, rows)
    if (popouts.isDetached(id)) sendToSession(id, 'popout:size', id, cols, rows)
  })
  ipcMain.on('pty:kill', (e, id: string) => {
    if (!ownsSession(e.sender, id)) return
    popouts.dock(id, false)
    ptys.kill(id)
    feeds?.detach(id)
    sessionOwners.delete(id)
    activeNotifications.get(id)?.close()
    activeNotifications.delete(id)
  })
  ipcMain.on('pty:rename', (e, id: string, title: string) => {
    if (!ownsSession(e.sender, id)) return
    if (typeof title === 'string' && title.trim()) {
      const name = title.trim().slice(0, 100)
      activity.rename(id, name); ptys.rename(id, name); popouts.rename(id, name)
    }
  })
  ipcMain.handle('app:testNotification', () => showTerminalNotification({ id: 'test', title: 'Terminal Buddy', kind: 'quiet' }, true))
  ipcMain.handle('pty:link', async (e, id: string, chat: ChatEntry) => {
    if (!ownsSession(e.sender, id)) throw Error('Link chats from the terminal’s workspace.')
    const current = ptys.describe(id)?.session
    if (!current) throw Error('This terminal has closed.')
    const resume = { agent: chat.agent, id: chat.id, path: chat.path }
    await validate({ ...current, cwd: chat.cwd, resume })
    // Only recovery metadata changes. Never write to, restart, or replace the PTY.
    return ptys.link(id, resume, chat.cwd)
  })

  // Which panes are currently running an agent, keyed by session id.
  ipcMain.handle('pty:probeAgents', async (e) => {
    const workspace = workspaceFor(e.sender)
    const live = ptys.list().filter(session => sessionOwners.get(session.id) === workspace.id)
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
      for (const entry of windows.values()) entry.window.flashFrame(false)
      for (const notification of activeNotifications.values()) notification.close()
      activeNotifications.clear()
    }
    ptys.setScrollback(s.scrollback)
    popouts.settingsChanged(s)
    sendToRenderer('settings:changed', s)
    tray?.enable(s.trayIcon)
    return s
  })

  ipcMain.handle('workspace:get', (e) => loadWorkspace(workspaceFor(e.sender).id))
  ipcMain.handle('workspace:prepareRestore', (_e, sessions: PersistedSession[]) => prepareRestore(sessions))
  ipcMain.handle('workspace:restoreSpec', (_e, session: PersistedSession) => restoreSpec(session, loadSettings()))
  ipcMain.on('workspace:saveSync', (event, w: Workspace) => {
    try {
      const { id } = workspaceFor(event.sender)
      saveWorkspace({ ...w, bounds: loadWorkspace(id).bounds }, id)
      event.returnValue = null
    } catch (error) { event.returnValue = (error as Error).message }
  })
  ipcMain.handle('workspace:set', (e, w: Workspace) => {
    const { id } = workspaceFor(e.sender)
    const cur = loadWorkspace(id)
    saveWorkspace({ ...w, bounds: cur.bounds }, id)
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

  ipcMain.handle('catalog:export', async (e, entry: ChatEntry) => {
    const settings = loadSettings()
    const template = entry.agent === 'claude' ? settings.claudeResumeCommand : settings.codexResumeCommand
    const { turns, truncated } = await catalog!.transcript(entry.path, entry.agent)
    const safe = entry.title.replace(/[^\w .-]+/g, '_').slice(0, 60).trim() || 'chat'

    const res = await dialog.showSaveDialog(workspaceFor(e.sender).window, {
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

  ipcMain.handle('dialog:pickFolder', async (e) => {
    const res = await dialog.showOpenDialog(workspaceFor(e.sender).window, {
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

  ipcMain.on('app:status', (e, total: number, waiting: number, badge: string | null) => {
    const workspace = [...windows.values()].find(entry => entry.window.webContents === e.sender)
    if (!workspace) return
    workspace.total = Number.isFinite(total) ? Math.max(0, total) : 0
    workspace.waiting = Number.isFinite(waiting) ? Math.max(0, waiting) : 0
    updateFleetStatus()
    if (process.platform !== 'darwin') setTaskbarBadge(workspace.window, badge, workspace.waiting)
    workspace.window.flashFrame(alertsEnabled && waiting > 0 && !workspace.window.isFocused())
  })
  ipcMain.on('app:show', (e) => revealWindow(popouts.parentOf(e.sender) ?? workspaceFor(e.sender).window))
  ipcMain.handle('app:newWindow', (e) => {
    workspaceFor(e.sender)
    const window = createWindow()
    return workspaceFor(window.webContents).id
  })
  ipcMain.handle('app:windows', (e) => {
    workspaceFor(e.sender)
    return [...windows.values()].map((entry) => ({ id: entry.id, label: entry.label,
      terminals: entry.total, current: entry.window.webContents === e.sender }))
  })
  ipcMain.handle('app:focusWindow', (e, id: string) => {
    workspaceFor(e.sender)
    const entry = windows.get(id)
    if (!entry) throw Error('That window has closed.')
    revealWindow(entry.window)
  })

  feeds = new FeedService(
    (sessionId, events) => sendToSession(sessionId, 'feed:events', sessionId, events),
    (sessionId, agent) => sendToSession(sessionId, 'feed:agent', sessionId, agent)
  )
  ipcMain.on('feed:attach', (e, sessionId: string, cwd: string, source?: FeedSource) => { if (ownsSession(e.sender, sessionId)) feeds?.attach(sessionId, cwd, source) })
  ipcMain.on('feed:detach', (e, sessionId: string) => { if (ownsSession(e.sender, sessionId)) feeds?.detach(sessionId) })

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
    if (argv.includes('--new-window')) createWindow()
    else if (dir) openFolder(dir)
    else revealWindow()
  })

  app.whenReady().then(() => {
    nativeTheme.themeSource = 'dark'
    // Must match electron-builder's appId, or Windows treats a pinned
    // shortcut and the running window as two different apps.
    app.setAppUserModelId('com.terminalbuddy.app')

    // Electron's default menu registers Ctrl+V (and friends) as accelerators,
    // and Alt opens its hidden menu bar. Both fight the terminal, so the app
    // owns every clipboard key itself — see renderer/src/lib/clipboard.ts.
    Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([
      { role: 'appMenu' },
      { label: 'Window', submenu: [
        { label: 'New Window', click: () => { createWindow() } },
        { role: 'minimize' }, { role: 'zoom' }, { type: 'separator' },
        { label: 'Show Terminal Buddy', click: () => revealWindow() },
        { role: 'front' }
      ] }
    ]) : null)

    registerIpc()
    alertsEnabled = loadSettings().desktopNotifications
    ptys.setScrollback(loadSettings().scrollback)
    activityTimer = setInterval(() => activity.tick(), 1000)
    const reopening = loadWindowIds()
    for (const id of reopening) createWindow(id, false)
    persistWindowList()
    app.on('browser-window-focus', (_event, window) => {
      const parent = popouts.parentOf(window.webContents)
      if (parent) activeWindowId = workspaceFor(parent.webContents).id
    })

    tray = new TrayController(activeWindow, {
      onShow: () => { revealWindow() },
      onNewWindow: () => { createWindow() },
      onNewTerminal: () => {
        revealWindow().webContents.send('app:new-terminal')
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
    if (initial) openFolder(initial)

    app.on('activate', () => {
      revealWindow()
    })
  })

  app.on('window-all-closed', () => {
    ptys.killAll()
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    quitting = true
    persistWindowList()
    popouts.closeAll()
    if (activityTimer) clearInterval(activityTimer)
    for (const notification of activeNotifications.values()) notification.close()
    activeNotifications.clear()
    tray?.dispose()
    feeds?.dispose()
  })
  // Let renderer beforeunload flush the final workspace before stopping PTYs.
  app.on('will-quit', () => ptys.killAll())
}
