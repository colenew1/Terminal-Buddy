import { contextBridge, ipcRenderer } from 'electron'
import type {
  Catalog,
  ChatEntry,
  FeedEvent,
  FeedSource,
  PersistedSession,
  RestoreItem,
  IntegrationStatus,
  OpResult,
  ScanProgress,
  SessionInfo,
  SessionSpec,
  Settings,
  ShellDef,
  Workspace,
  AssistantProfile, PopoutInit, Pos, TransferState, TransferArrival, LauncherLibrary, WorkspacePreset
} from '@shared/types'

type Unsub = () => void

function on<A extends unknown[]>(channel: string, cb: (...args: A) => void): Unsub {
  const handler = (_e: unknown, ...args: unknown[]): void => cb(...(args as A))
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api = {
  platform: process.platform,
  popout: {
    attention: (id: string, value: boolean): void => ipcRenderer.send('popout:attention', id, value),
    seen: (id: string): void => ipcRenderer.send('popout:seen', id),
    onAttention: (cb: (value: boolean) => void): Unsub => on('popout:attention', cb),
    onSeen: (cb: (id: string) => void): Unsub => on('popout:seen', cb),
    open: (id: string, point?: Pos): Promise<void> => ipcRenderer.invoke('popout:open', id, point),
    init: (id: string): Promise<void> => ipcRenderer.invoke('popout:init', id),
    dock: (id: string): void => ipcRenderer.send('popout:dock', id),
    focus: (id: string): void => ipcRenderer.send('popout:focus', id),
    drag: (id: string, phase: 'start' | 'move' | 'end' | 'cancel', point: Pos): void => ipcRenderer.send('popout:drag', id, phase, point),
    onInit: (cb: (value: PopoutInit) => void): Unsub => on('popout:init', cb),
    onState: (cb: (id: string, detached: boolean) => void): Unsub => on('popout:state', cb),
    onSize: (cb: (id: string, cols: number, rows: number) => void): Unsub => on('popout:size', cb),
    onInput: (cb: (id: string) => void): Unsub => on('popout:input', cb),
    onTitle: (cb: (title: string) => void): Unsub => on('popout:title', cb),
    onSettings: (cb: (settings: Settings) => void): Unsub => on('popout:settings', cb),
    onDragging: (cb: (dragging: boolean, over: boolean) => void): Unsub => on('popout:dragging', cb)
  },
  shells: {
    list: (): Promise<ShellDef[]> => ipcRenderer.invoke('shells:get')
  },

  pty: {
    link: (id: string, chat: ChatEntry): Promise<SessionInfo> => ipcRenderer.invoke('pty:link', id, chat),
    create: (spec: SessionSpec): Promise<SessionInfo> => ipcRenderer.invoke('pty:create', spec),
    write: (id: string, data: string, broadcast = false): void => ipcRenderer.send('pty:write', id, data, broadcast),
    submit: (id: string, data: string): Promise<void> => ipcRenderer.invoke('pty:submit', id, data),
    resize: (id: string, cols: number, rows: number): void => ipcRenderer.send('pty:resize', id, cols, rows),
    kill: (id: string): void => ipcRenderer.send('pty:kill', id),
    rename: (id: string, title: string): void => ipcRenderer.send('pty:rename', id, title),
    onData: (cb: (id: string, data: string, seq: number) => void): Unsub => on('pty:data', cb),
    onExit: (cb: (id: string, code: number) => void): Unsub => on('pty:exit', cb),
    onInfo: (cb: (id: string, patch: { pid: number }) => void): Unsub => on('pty:info', cb),
    probeAgents: (): Promise<Record<string, 'claude' | 'codex' | null>> =>
      ipcRenderer.invoke('pty:probeAgents')
  },

  catalog: {
    get: (): Promise<Catalog> => ipcRenderer.invoke('catalog:get'),
    refresh: (): Promise<Catalog> => ipcRenderer.invoke('catalog:refresh'),
    exportMarkdown: (entry: ChatEntry): Promise<OpResult> => ipcRenderer.invoke('catalog:export', entry),
    onProgress: (cb: (p: ScanProgress) => void): Unsub => on('catalog:progress', cb)
  },

  assistants: {
    save: (profile: AssistantProfile): Promise<Settings> => ipcRenderer.invoke('assistants:save', profile),
    remove: (id: string): Promise<Settings> => ipcRenderer.invoke('assistants:remove', id)
  },

  settings: {
    onChanged: (cb: (s: Settings) => void): Unsub => on('settings:changed', cb),
    get: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
    set: (s: Settings): Promise<Settings> => ipcRenderer.invoke('settings:set', s)
  },

  workspace: {
    move: (id: string, target: string): Promise<void> => ipcRenderer.invoke('workspace:move', id, target),
    combine: (): Promise<void> => ipcRenderer.invoke('workspace:combine'),
    drop: (id: string, point: Pos): Promise<void> => ipcRenderer.invoke('workspace:drop', id, point),
    drag: (id: string, point?: Pos): void => ipcRenderer.send('workspace:drag', id, point),
    transferReply: (token: string, state: TransferState): void => ipcRenderer.send('workspace:transferReply', token, state),
    onTransferRequest: (cb: (token: string) => void): Unsub => on('workspace:transferRequest', cb),
    onTransferArrive: (cb: (sessions: TransferArrival[], recovery: PersistedSession[]) => void): Unsub => on('workspace:transferArrive', cb),
    onTransferRemove: (cb: (ids: string[]) => void): Unsub => on('workspace:transferRemove', cb),
    onTransferEnd: (cb: () => void): Unsub => on('workspace:transferEnd', cb),
    onTransferHover: (cb: (over: boolean) => void): Unsub => on('workspace:transferHover', cb),
    get: (): Promise<Workspace> => ipcRenderer.invoke('workspace:get'),
    set: (w: Workspace): Promise<void> => ipcRenderer.invoke('workspace:set', w),
    saveSync: (w: Workspace): string | null => ipcRenderer.sendSync('workspace:saveSync', w),
    prepareRestore: (sessions: PersistedSession[]): Promise<RestoreItem[]> => ipcRenderer.invoke('workspace:prepareRestore', sessions),
    restoreSpec: (session: PersistedSession): Promise<SessionSpec> => ipcRenderer.invoke('workspace:restoreSpec', session)
  },

  library: {
    get: (): Promise<LauncherLibrary> => ipcRenderer.invoke('library:get'),
    pin: (chat: ChatEntry, pinned: boolean): Promise<LauncherLibrary> => ipcRenderer.invoke('library:pin', chat, pinned),
    rememberFolder: (path: string): Promise<LauncherLibrary> => ipcRenderer.invoke('library:folder', path),
    savePreset: (preset: Omit<WorkspacePreset, 'id'>): Promise<LauncherLibrary> => ipcRenderer.invoke('library:savePreset', preset),
    deletePreset: (id: string): Promise<LauncherLibrary> => ipcRenderer.invoke('library:deletePreset', id),
    onChanged: (cb: (value: LauncherLibrary) => void): Unsub => on('library:changed', cb)
  },

  integration: {
    status: (): Promise<IntegrationStatus> => ipcRenderer.invoke('integration:status'),
    installContextMenu: (): Promise<OpResult> => ipcRenderer.invoke('integration:installContextMenu'),
    uninstallContextMenu: (): Promise<OpResult> => ipcRenderer.invoke('integration:uninstallContextMenu'),
    installCli: (): Promise<OpResult> => ipcRenderer.invoke('integration:installCli'),
    uninstallCli: (): Promise<OpResult> => ipcRenderer.invoke('integration:uninstallCli')
  },

  feed: {
    attach: (sessionId: string, cwd: string, source?: FeedSource): void => ipcRenderer.send('feed:attach', sessionId, cwd, source),
    detach: (sessionId: string): void => ipcRenderer.send('feed:detach', sessionId),
    onEvents: (cb: (sessionId: string, events: FeedEvent[]) => void): Unsub => on('feed:events', cb),
    onAgent: (cb: (sessionId: string, agent: 'claude' | 'codex' | null) => void): Unsub =>
      on('feed:agent', cb)
  },

  clipboard: {
    read: (): Promise<string> => ipcRenderer.invoke('clipboard:read'),
    write: (text: string): void => ipcRenderer.send('clipboard:write', text)
  },

  app: {
    newWindow: (): Promise<string> => ipcRenderer.invoke('app:newWindow'),
    windows: (): Promise<{ id: string; label: string; terminals: number; current: boolean }[]> => ipcRenderer.invoke('app:windows'),
    focusWindow: (id: string): Promise<void> => ipcRenderer.invoke('app:focusWindow', id),
    onWindowsChanged: (cb: () => void): Unsub => on('app:windowsChanged', cb),
    pickFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickFolder'),
    paths: (): Promise<{
      home: string
      userData: string
      version: string
      packaged: boolean
      platform: string
    }> => ipcRenderer.invoke('app:paths'),
    openExternal: (url: string): void => ipcRenderer.send('app:openExternal', url),
    /** Fleet state for the tray tooltip and the taskbar overlay badge. */
    setStatus: (total: number, waiting: number, badge: string | null): void =>
      ipcRenderer.send('app:status', total, waiting, badge),
    show: (): void => ipcRenderer.send('app:show'),
    testNotification: (): Promise<OpResult> => ipcRenderer.invoke('app:testNotification'),
    onSelectTerminal: (cb: (id: string) => void): Unsub => on('app:selectTerminal', cb),
    onNotificationError: (cb: (message: string) => void): Unsub => on('app:notificationError', cb),
    onNewTerminal: (cb: () => void): Unsub => on('app:new-terminal', cb),
    revealPath: (p: string): void => ipcRenderer.send('app:revealPath', p),
    openPath: (p: string): void => ipcRenderer.send('app:openPath', p),
    onOpenFolder: (cb: (dir: string) => void): Unsub => on('app:open-folder', cb)
  }
}

export type BuddyApi = typeof api

contextBridge.exposeInMainWorld('buddy', api)
