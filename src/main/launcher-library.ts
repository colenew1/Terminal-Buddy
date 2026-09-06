import { ipcMain, type WebContents } from 'electron'
import { readFileSync, writeFileSync, renameSync, mkdirSync, statSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ChatEntry, LauncherLibrary, WorkspacePreset } from '@shared/types'
import { cacheFile } from './store'

const empty = (): LauncherLibrary => ({ recentFolders: [], pinnedChats: [], presets: [] })
const text = (s: unknown, max = 4096): s is string => typeof s === 'string' && s.length > 0 && s.length <= max
function validChat(c: ChatEntry): boolean {
  return !!c && ['claude', 'codex'].includes(c.agent) && text(c.id) && text(c.path) && text(c.title) && typeof c.cwd === 'string'
}
function validPreset(p: Omit<WorkspacePreset, 'id'>): boolean {
  return !!p && text(p.name, 80) && ['tabs', 'grid'].includes(p.layout) && Array.isArray(p.sessions) && p.sessions.length > 0 && p.sessions.length <= 16 &&
    p.sessions.every(s => s && text(s.cwd) && isAbsolute(s.cwd) && text(s.shellId, 100) && text(s.title, 100) && (!s.agent || ['claude', 'codex'].includes(s.agent)) &&
      (!s.assistantId || (text(s.assistantId, 36) && /^[0-9a-f-]{36}$/.test(s.assistantId) && !s.agent))) &&
    (!p.gridSizes || ['columns', 'rows'].every(axis => {
      const weights = p.gridSizes![axis as 'columns' | 'rows']
      return Array.isArray(weights) && weights.length <= 16 && weights.every(w => Number.isFinite(w) && w > 0)
    }))
}
function read(file: string): LauncherLibrary | null {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8')) as LauncherLibrary
    if (!Array.isArray(value.recentFolders) || !Array.isArray(value.pinnedChats) || !Array.isArray(value.presets)) return null
    if (value.recentFolders.length > 8 || value.pinnedChats.length > 12 || value.presets.length > 20 ||
      !value.recentFolders.every(p => text(p) && isAbsolute(p)) || !value.pinnedChats.every(validChat) || !value.presets.every(p => text(p.id) && validPreset(p))) return null
    return value
  } catch { return null }
}
export function registerLauncherLibrary(allowed: (sender: WebContents) => void, changed: (value: LauncherLibrary) => void): void {
  const file = cacheFile('launcher.json')
  let library = read(file) ?? read(file + '.bak') ?? empty()
  const write = (path: string, value: LauncherLibrary): void => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path + '.tmp', JSON.stringify(value, null, 2), { encoding: 'utf8', flush: true })
    renameSync(path + '.tmp', path)
  }
  const save = (next: LauncherLibrary): LauncherLibrary => {
    write(file + '.bak', library); write(file, next)
    library = next; changed(library); return library
  }
  ipcMain.handle('library:get', event => { allowed(event.sender); return library })
  ipcMain.handle('library:folder', (event, path: string) => {
    allowed(event.sender)
    if (!text(path) || !isAbsolute(path) || !statSync(path).isDirectory()) throw Error('Choose an existing folder.')
    const key = (p: string): string => process.platform === 'win32' ? p.toLowerCase() : p
    return save({ ...library, recentFolders: [path, ...library.recentFolders.filter(p => key(p) !== key(path))].slice(0, 8) })
  })
  ipcMain.handle('library:pin', (event, chat: ChatEntry, pinned: boolean) => {
    allowed(event.sender)
    if (!validChat(chat)) throw Error('This saved chat is unavailable. Rescan the catalog.')
    const others = library.pinnedChats.filter(c => c.agent !== chat.agent || c.id !== chat.id)
    if (pinned && others.length >= 12) throw Error('Unpin a chat first (12 favorites maximum).')
    return save({ ...library, pinnedChats: pinned ? [chat, ...others] : others })
  })
  ipcMain.handle('library:savePreset', (event, preset: Omit<WorkspacePreset, 'id'>) => {
    allowed(event.sender)
    if (!validPreset(preset)) throw Error('Give the preset a name and open at least one terminal first.')
    if (library.presets.length >= 20) throw Error('Remove a preset first (20 maximum).')
    const clean: WorkspacePreset = { id: randomUUID(), name: preset.name.trim(), layout: preset.layout, gridSizes: preset.gridSizes,
      sessions: preset.sessions.map(s => ({ cwd: s.cwd, shellId: s.shellId, title: s.title, agent: s.agent, critter: s.critter, assistantId: s.assistantId, assistantName: s.assistantName })) }
    return save({ ...library, presets: [...library.presets, clean] })
  })
  ipcMain.handle('library:deletePreset', (event, id: string) => {
    allowed(event.sender)
    return save({ ...library, presets: library.presets.filter(p => p.id !== id) })
  })
}
