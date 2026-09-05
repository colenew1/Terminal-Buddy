/** Types shared between the Electron main process, the preload bridge and the renderer. */

export type LayoutMode = 'tabs' | 'grid'
export type Agent = 'claude' | 'codex'

/** A shell Terminal Buddy knows how to launch. Detected at startup. */
export interface ShellDef {
  id: string
  label: string
  path: string
  args: string[]
}

/** What the renderer asks for when opening a terminal. */
export interface SessionSpec {
  cwd: string
  shellId?: string
  title?: string
  /** Typed into the shell once it is ready (used by "resume this chat"). */
  initialCommand?: string
  /** Renderer-only: restore a specific critter instead of picking a fresh one. */
  critter?: string
}

/** What main returns once the pty is alive. */
export interface SessionInfo {
  id: string
  cwd: string
  shellId: string
  shellLabel: string
  title: string
  pid: number
}

export type SkillSource =
  | 'claude-user'
  | 'claude-plugin'
  | 'claude-project'
  | 'codex-prompt'
  | 'codex-plugin'

export interface SkillEntry {
  id: string
  name: string
  description: string
  source: SkillSource
  agent: Agent
  /** Plugin name, project name, or "user" — where this skill came from. */
  origin: string
  path: string
  mtime: number
}

export interface ChatEntry {
  /** The id to hand to `claude --resume` / `codex resume`. */
  id: string
  /** Codex records both a thread id and a rollout id; keep the other one around. */
  altId?: string
  agent: Agent
  title: string
  /** First user prompt, trimmed. Shown under the title. */
  preview: string
  cwd: string
  project: string
  path: string
  startedAt: number
  updatedAt: number
  /** Number of user turns — a cheap proxy for "how long was this". */
  turns: number
  bytes: number
  /** Sub-agent / injected-prompt runs. Hidden behind a toggle so the list stays useful. */
  internal: boolean
}

export interface ProjectEntry {
  path: string
  name: string
  chats: number
  lastActive: number
  exists: boolean
}

export interface Catalog {
  skills: SkillEntry[]
  chats: ChatEntry[]
  projects: ProjectEntry[]
  scannedAt: number
  errors: string[]
}

export interface ScanProgress {
  phase: 'skills' | 'chats' | 'done'
  done: number
  total: number
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
  ts: number
}

export interface ChatTranscript {
  entry: ChatEntry
  turns: ChatTurn[]
  truncated: boolean
}

export interface Settings {
  defaultShellId: string
  fontSize: number
  fontFamily: string
  scrollback: number
  layout: LayoutMode
  /** ms of silence after output before a background pane is flagged "needs you". */
  attentionDelayMs: number
  confirmCloseRunning: boolean
  cursorBlink: boolean
  restoreOnLaunch: boolean
  copyOnSelect: boolean
  /** `{id}` is replaced with the session id. Templates so a CLI change is a settings edit. */
  claudeResumeCommand: string
  codexResumeCommand: string
  /** Extra folders to scan for project-level `.claude/skills`. */
  extraSkillRoots: string[]
  /** Palette id from lib/themes.ts. */
  theme: string
  /** Give each terminal a critter so panes in the same folder stay tellable apart. */
  critters: boolean
  /** Soft chime when a pane starts waiting on you. */
  chime: boolean
  /** Stills every animation, including the buddy. */
  reduceMotion: boolean
  /** Click in the command line to put the cursor there, instead of arrowing over. */
  clickToPosition: boolean
  /** Keep an icon in the Windows notification area. */
  trayIcon: boolean
  /** Minimising hides to the tray instead of the taskbar. */
  minimizeToTray: boolean
  /** Closing the window hides it instead of killing every terminal. */
  closeToTray: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  defaultShellId: 'pwsh',
  fontSize: 13,
  fontFamily: '"Cascadia Mono", "JetBrains Mono", Consolas, "Courier New", monospace',
  scrollback: 5000,
  layout: 'tabs',
  attentionDelayMs: 1200,
  confirmCloseRunning: true,
  cursorBlink: true,
  restoreOnLaunch: true,
  copyOnSelect: false,
  claudeResumeCommand: 'claude --resume {id}',
  codexResumeCommand: 'codex resume {id}',
  extraSkillRoots: [],
  theme: 'midnight',
  critters: true,
  chime: false,
  reduceMotion: false,
  clickToPosition: true,
  trayIcon: true,
  minimizeToTray: false,
  closeToTray: false
}

export interface PersistedSession {
  cwd: string
  shellId: string
  title: string
  /** Restored so a pane keeps its critter across launches. */
  critter?: string
}

export interface WindowBounds {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

export interface Workspace {
  sessions: PersistedSession[]
  layout: LayoutMode
  bounds?: WindowBounds
}

export interface IntegrationStatus {
  contextMenuInstalled: boolean
  cliInstalled: boolean
  cliDir: string
  packaged: boolean
}

export interface OpResult {
  ok: boolean
  message: string
}
