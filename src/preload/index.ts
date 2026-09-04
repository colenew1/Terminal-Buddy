import { contextBridge, ipcRenderer } from 'electron'
import type {
  Catalog,
  ChatEntry,
  ChatTranscript,
  IntegrationStatus,
  OpResult,
  ScanProgress,
  SessionInfo,
  SessionSpec,
  Settings,
  ShellDef,
  Workspace
} from '@shared/types'

type Unsub = () => void

function on<A extends unknown[]>(channel: string, cb: (...args: A) => void): Unsub {
  const handler = (_e: unknown, ...args: unknown[]): void => cb(...(args as A))
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api = {
  shells: {
    list: (): Promise<ShellDef[]> => ipcRenderer.invoke('shells:get')
  },

  pty: {
    create: (spec: SessionSpec): Promise<SessionInfo> => ipcRenderer.invoke('pty:create', spec),
    write: (id: string, data: string): void => ipcRenderer.send('pty:write', id, data),
    resize: (id: string, cols: number, rows: number): void => ipcRenderer.send('pty:resize', id, cols, rows),
    kill: (id: string): void => ipcRenderer.send('pty:kill', id),
    onData: (cb: (id: string, data: string) => void): Unsub => on('pty:data', cb),
    onExit: (cb: (id: string, code: number) => void): Unsub => on('pty:exit', cb),
    onInfo: (cb: (id: string, patch: { pid: number }) => void): Unsub => on('pty:info', cb)
  },

  catalog: {
    get: (): Promise<Catalog> => ipcRenderer.invoke('catalog:get'),
    refresh: (): Promise<Catalog> => ipcRenderer.invoke('catalog:refresh'),
    transcript: (entry: ChatEntry): Promise<ChatTranscript> => ipcRenderer.invoke('catalog:transcript', entry),
    exportMarkdown: (entry: ChatEntry): Promise<OpResult> => ipcRenderer.invoke('catalog:export', entry),
    onProgress: (cb: (p: ScanProgress) => void): Unsub => on('catalog:progress', cb)
  },

  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
    set: (s: Settings): Promise<Settings> => ipcRenderer.invoke('settings:set', s)
  },

  workspace: {
    get: (): Promise<Workspace> => ipcRenderer.invoke('workspace:get'),
    set: (w: Workspace): Promise<void> => ipcRenderer.invoke('workspace:set', w)
  },

  integration: {
    status: (): Promise<IntegrationStatus> => ipcRenderer.invoke('integration:status'),
    installContextMenu: (): Promise<OpResult> => ipcRenderer.invoke('integration:installContextMenu'),
    uninstallContextMenu: (): Promise<OpResult> => ipcRenderer.invoke('integration:uninstallContextMenu'),
    installCli: (): Promise<OpResult> => ipcRenderer.invoke('integration:installCli'),
    uninstallCli: (): Promise<OpResult> => ipcRenderer.invoke('integration:uninstallCli')
  },

  app: {
    pickFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickFolder'),
    paths: (): Promise<{
      home: string
      userData: string
      version: string
      packaged: boolean
      platform: string
    }> => ipcRenderer.invoke('app:paths'),
    openExternal: (url: string): void => ipcRenderer.send('app:openExternal', url),
    revealPath: (p: string): void => ipcRenderer.send('app:revealPath', p),
    openPath: (p: string): void => ipcRenderer.send('app:openPath', p),
    onOpenFolder: (cb: (dir: string) => void): Unsub => on('app:open-folder', cb)
  }
}

export type BuddyApi = typeof api

contextBridge.exposeInMainWorld('buddy', api)
