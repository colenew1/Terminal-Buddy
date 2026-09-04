import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
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
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(value, null, 2), 'utf8')
  } catch (err) {
    console.error('[store] write failed', file, err)
  }
}

const settingsFile = (): string => join(app.getPath('userData'), 'settings.json')
const workspaceFile = (): string => join(app.getPath('userData'), 'workspace.json')

export function loadSettings(): Settings {
  return readJson<Settings>(settingsFile(), DEFAULT_SETTINGS)
}

export function saveSettings(s: Settings): void {
  writeJson(settingsFile(), s)
}

export function loadWorkspace(): Workspace {
  return readJson<Workspace>(workspaceFile(), { sessions: [], layout: 'tabs' })
}

export function saveWorkspace(w: Workspace): void {
  writeJson(workspaceFile(), w)
}

export function cacheFile(name: string): string {
  return join(app.getPath('userData'), name)
}
