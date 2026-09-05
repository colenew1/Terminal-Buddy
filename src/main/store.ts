import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { DEFAULT_SETTINGS, type Settings, type Workspace } from '@shared/types'

function readJson<T>(file: string, fallback: T): T {
  try {
    if (!existsSync(file)) return fallback
    return { ...fallback, ...(JSON.parse(readFileSync(file, 'utf8')) as object) } as T
  } catch {
    return fallback
  }
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true })
  // A partial write must not replace the last usable workspace.
  const temporary = file + '.tmp'
  writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', flush: true })
  renameSync(temporary, file)
}

const settingsFile = (): string => join(app.getPath('userData'), 'settings.json')
const workspaceFile = (): string => join(app.getPath('userData'), 'workspace.json')

export function loadSettings(): Settings {
  const settings = readJson<Settings>(settingsFile(), { ...DEFAULT_SETTINGS, alertsOptInVersion: 0 })
  // Previous versions enabled notifications without consent. Move everyone to
  // an explicit opt-in once; subsequent choices (including chimes) are retained.
  if (settings.alertsOptInVersion < 1) {
    Object.assign(settings, { desktopNotifications: false, chime: false, alertsOptInVersion: 1 })
    saveSettings(settings)
  }
  if (!['tabs', 'grid'].includes(settings.layout)) settings.layout = 'grid'
  return settings
}

export function saveSettings(s: Settings): void {
  writeJson(settingsFile(), s)
}

export function loadWorkspace(): Workspace {
  return readWorkspace(workspaceFile()) ?? readWorkspace(workspaceFile() + '.bak') ?? { sessions: [], layout: 'tabs' }
}

export function saveWorkspace(w: Workspace): void {
  const previous = readWorkspace(workspaceFile())
  // Keep the last valid snapshot. A corrupt primary must never poison backup.
  if (previous) writeJson(workspaceFile() + '.bak', previous)
  writeJson(workspaceFile(), w)
}

function readWorkspace(file: string): Workspace | null {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8')) as Workspace
    if (!value || !Array.isArray(value.sessions) || !['tabs', 'grid', 'world'].includes(value.layout)) return null
    // Keep old World workspaces and their conversations, but open them in Grid.
    if ((value.layout as string) === 'world') value.layout = 'grid'
    if (value.unrestoredSessions !== undefined && !Array.isArray(value.unrestoredSessions)) return null
    if (![...value.sessions, ...(value.unrestoredSessions ?? [])].every((s) => s && typeof s.cwd === 'string')) return null
    return value
  } catch { return null }
}

export function cacheFile(name: string): string {
  return join(app.getPath('userData'), name)
}
