import { randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import type { WebContents } from 'electron'
import type { SessionInfo, SessionSpec, ShellDef } from '@shared/types'
import { resolveShell } from './shells'

type IPty = {
  pid: number
  onData(cb: (data: string) => void): void
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
}

// Required lazily so a load failure surfaces as a readable error rather than a
// blank window at startup.
function loadPty(): { spawn: (f: string, a: string[], o: object) => IPty } {
  return require('@lydell/node-pty')
}

/** Flush window for pty output. Batching matters a lot with 8 panes streaming at once. */
const FLUSH_MS = 8
const FLUSH_BYTES = 48 * 1024

interface Entry {
  id: string
  pty: IPty
  info: SessionInfo
  buffer: string[]
  bufferedBytes: number
  timer: NodeJS.Timeout | null
  exited: boolean
  sawFirstData: boolean
  pendingCommand: string | null
}

export class PtyManager {
  private entries = new Map<string, Entry>()
  private target: WebContents | null = null

  constructor(private shells: ShellDef[]) {}

  setTarget(wc: WebContents | null): void {
    this.target = wc
  }

  private send(channel: string, ...args: unknown[]): void {
    const wc = this.target
    if (wc && !wc.isDestroyed()) wc.send(channel, ...args)
  }

  private safeCwd(cwd: string | undefined): string {
    try {
      if (cwd && existsSync(cwd) && statSync(cwd).isDirectory()) return cwd
    } catch {
      /* fall through */
    }
    return homedir()
  }

  private buildEnv(): Record<string, string> {
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') env[k] = v
    // Electron leaks these into children and they confuse CLIs.
    delete env.ELECTRON_RUN_AS_NODE
    delete env.ELECTRON_NO_ATTACH_CONSOLE
    env.TERM = 'xterm-256color'
    env.COLORTERM = 'truecolor'
    env.TERM_PROGRAM = 'terminal-buddy'
    return env
  }

  create(spec: SessionSpec): SessionInfo {
    const shell = resolveShell(this.shells, spec.shellId)
    const cwd = this.safeCwd(spec.cwd)
    const id = randomUUID()

    const pty = loadPty().spawn(shell.path, shell.args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: this.buildEnv(),
      useConpty: true
    })

    const info: SessionInfo = {
      id,
      cwd,
      shellId: shell.id,
      shellLabel: shell.label,
      title: spec.title || basename(cwd),
      pid: pty.pid
    }

    const entry: Entry = {
      id,
      pty,
      info,
      buffer: [],
      bufferedBytes: 0,
      timer: null,
      exited: false,
      sawFirstData: false,
      pendingCommand: spec.initialCommand ?? null
    }
    this.entries.set(id, entry)

    pty.onData((data) => {
      entry.buffer.push(data)
      entry.bufferedBytes += data.length

      // ConPTY fills in the pid asynchronously, so the value at spawn time is
      // always 0. By the time output arrives the real process exists.
      if (entry.info.pid !== pty.pid && pty.pid) {
        entry.info.pid = pty.pid
        this.send('pty:info', id, { pid: pty.pid })
      }

      if (!entry.sawFirstData) {
        entry.sawFirstData = true
        // Give the shell a beat to finish drawing its prompt before typing.
        if (entry.pendingCommand) {
          const cmd = entry.pendingCommand
          entry.pendingCommand = null
          setTimeout(() => {
            if (!entry.exited) entry.pty.write(cmd + '\r')
          }, 250)
        }
      }

      if (entry.bufferedBytes >= FLUSH_BYTES) this.flush(entry)
      else if (!entry.timer) entry.timer = setTimeout(() => this.flush(entry), FLUSH_MS)
    })

    pty.onExit(({ exitCode }) => {
      entry.exited = true
      this.flush(entry)
      this.send('pty:exit', id, exitCode)
      this.entries.delete(id)
    })

    // Safety net: if the shell never emits anything, still run the command.
    if (entry.pendingCommand) {
      setTimeout(() => {
        if (entry.pendingCommand && !entry.exited) {
          const cmd = entry.pendingCommand
          entry.pendingCommand = null
          entry.pty.write(cmd + '\r')
        }
      }, 1500)
    }

    return info
  }

  private flush(entry: Entry): void {
    if (entry.timer) {
      clearTimeout(entry.timer)
      entry.timer = null
    }
    if (entry.buffer.length === 0) return
    const data = entry.buffer.join('')
    entry.buffer = []
    entry.bufferedBytes = 0
    this.send('pty:data', entry.id, data)
  }

  write(id: string, data: string): void {
    const e = this.entries.get(id)
    if (e && !e.exited) e.pty.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const e = this.entries.get(id)
    if (!e || e.exited) return
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) return
    const c = Math.max(2, Math.floor(cols))
    const r = Math.max(1, Math.floor(rows))
    try {
      e.pty.resize(c, r)
    } catch {
      /* pty raced with exit */
    }
  }

  kill(id: string): void {
    const e = this.entries.get(id)
    if (!e) return
    try {
      e.pty.kill()
    } catch {
      /* already gone */
    }
    this.entries.delete(id)
  }

  killAll(): void {
    for (const id of [...this.entries.keys()]) this.kill(id)
  }

  list(): SessionInfo[] {
    return [...this.entries.values()].map((e) => e.info)
  }
}

function basename(p: string): string {
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || p
}
