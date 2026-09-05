import { createReadStream, existsSync, statSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import type { Agent, FeedEvent } from '@shared/types'

/**
 * Turns a running agent into a readable conversation.
 *
 * Scraping the terminal would mean parsing a full-screen TUI's redraws, which
 * is hopeless. Both CLIs already write a structured JSONL transcript, so this
 * finds the file a live session is writing to and tails it, emitting clean
 * turns. The pty stays underneath as input and process lifetime; the transcript
 * is what you actually see.
 */

const HOME = homedir()
const CLAUDE_PROJECTS = join(HOME, '.claude', 'projects')
const CODEX_SESSIONS = join(HOME, '.codex', 'sessions')

/** `C:\Users\me\Some Project` -> `C--Users-me-Some-Project`, as Claude names it. */
export function claudeSlug(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-')
}

interface Attached {
  sessionId: string
  /** Unknown until a transcript turns up; that is what identifies the agent. */
  agent: Agent | null
  cwd: string
  since: number
  file: string | null
  offset: number
  seq: number
  lastLookup: number
}

function textFromClaude(content: unknown): { text: string; tools: { name: string; input: unknown }[] } {
  const parts: string[] = []
  const tools: { name: string; input: unknown }[] = []
  if (typeof content === 'string') return { text: content, tools }
  if (!Array.isArray(content)) return { text: '', tools }
  for (const b of content) {
    if (!b || typeof b !== 'object') continue
    const blk = b as Record<string, unknown>
    if (blk.type === 'text' && typeof blk.text === 'string') parts.push(blk.text)
    else if (blk.type === 'tool_use') tools.push({ name: String(blk.name ?? 'tool'), input: blk.input })
  }
  return { text: parts.join('\n'), tools }
}

/** A tool call, said the way a person would say it. */
export function describeTool(name: string, input: unknown): { verb: string; detail: string } {
  const i = (input ?? {}) as Record<string, unknown>
  const path = typeof i.file_path === 'string' ? i.file_path : typeof i.path === 'string' ? i.path : ''
  const short = path ? path.split(/[\\/]/).slice(-2).join('/') : ''

  switch (name) {
    case 'Read':
      return { verb: 'Opened', detail: short }
    case 'Write':
      return { verb: 'Wrote', detail: short }
    case 'Edit':
    case 'NotebookEdit':
      return { verb: 'Edited', detail: short }
    case 'Bash':
    case 'PowerShell':
      return { verb: 'Ran', detail: String(i.command ?? i.description ?? '').slice(0, 120) }
    case 'Glob':
    case 'Grep':
      return { verb: 'Searched', detail: String(i.pattern ?? '').slice(0, 80) }
    case 'WebFetch':
    case 'WebSearch':
      return { verb: 'Looked up', detail: String(i.url ?? i.query ?? '').slice(0, 80) }
    case 'Task':
      return { verb: 'Delegated', detail: String(i.description ?? '').slice(0, 80) }
    case 'TodoWrite':
      return { verb: 'Updated the plan', detail: '' }
    default:
      return { verb: name, detail: short }
  }
}

export class FeedService {
  private attached = new Map<string, Attached>()
  private timer: NodeJS.Timeout | null = null

  constructor(
    private emit: (sessionId: string, events: FeedEvent[]) => void,
    private onAgent: (sessionId: string, agent: Agent | null) => void
  ) {}

  /**
   * Watch a pane. The agent is not declared up front — whichever CLI starts
   * writing a transcript in this folder identifies itself by doing so, which
   * means running `claude` by hand works exactly like resuming from the catalog.
   */
  attach(sessionId: string, cwd: string): void {
    if (this.attached.has(sessionId)) return
    this.attached.set(sessionId, {
      sessionId,
      agent: null,
      cwd,
      since: Date.now() - 15_000,
      file: null,
      offset: 0,
      seq: 0,
      lastLookup: 0
    })
    if (!this.timer) this.timer = setInterval(() => void this.tick(), 500)
  }

  detach(sessionId: string): void {
    this.attached.delete(sessionId)
    if (this.attached.size === 0 && this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  dispose(): void {
    this.attached.clear()
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Transcripts already spoken for, so two panes never mirror each other. */
  private claimed(exceptSessionId: string): Set<string> {
    const out = new Set<string>()
    for (const a of this.attached.values()) {
      if (a.sessionId !== exceptSessionId && a.file) out.add(a.file)
    }
    return out
  }

  /** Newest unclaimed transcript either CLI could be writing for this folder. */
  private async findFile(a: Attached): Promise<{ file: string; agent: Agent } | null> {
    const candidates: { file: string; agent: Agent; mtime: number }[] = []
    const taken = this.claimed(a.sessionId)

    try {
      const dir = join(CLAUDE_PROJECTS, claudeSlug(a.cwd))
      if (existsSync(dir)) {
        const names = (await readdir(dir)).filter((n) => n.endsWith('.jsonl'))
        const hit = await newestSince(dir, names, a.since, taken)
        if (hit) candidates.push({ file: hit.path, agent: 'claude', mtime: hit.mtime })
      }
    } catch {
      /* nothing from Claude */
    }

    try {
      // Codex buries rollouts under a date tree; only today's can be live.
      const now = new Date()
      const dir = join(
        CODEX_SESSIONS,
        String(now.getFullYear()),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0')
      )
      if (existsSync(dir)) {
        const names = (await readdir(dir)).filter((n) => n.endsWith('.jsonl'))
        const hit = await newestSince(dir, names, a.since, taken)
        if (hit) candidates.push({ file: hit.path, agent: 'codex', mtime: hit.mtime })
      }
    } catch {
      /* nothing from Codex */
    }

    candidates.sort((x, y) => y.mtime - x.mtime)
    return candidates[0] ? { file: candidates[0].file, agent: candidates[0].agent } : null
  }

  private async tick(): Promise<void> {
    for (const a of this.attached.values()) {
      if (!a.file) {
        // Discovery is a directory scan, so do it far less often than tailing.
        if (Date.now() - a.lastLookup < 2000) continue
        a.lastLookup = Date.now()
        const found = await this.findFile(a)
        if (!found) continue
        a.file = found.file
        a.agent = found.agent
        a.offset = 0 // read from the top so a resumed chat shows its history
        this.onAgent(a.sessionId, found.agent)
      }
      try {
        const size = statSync(a.file).size
        if (size < a.offset) a.offset = 0 // truncated or rotated
        if (size === a.offset) continue
        const chunk = await readRange(a.file, a.offset, size)
        a.offset = size
        const events = this.parse(a, chunk)
        if (events.length) this.emit(a.sessionId, events)
      } catch {
        /* the file can vanish mid-read; the next tick re-finds it */
      }
    }
  }

  private parse(a: Attached, chunk: string): FeedEvent[] {
    const out: FeedEvent[] = []
    for (const line of chunk.split('\n')) {
      if (line.length < 12) continue
      let d: Record<string, unknown>
      try {
        d = JSON.parse(line)
      } catch {
        continue
      }
      const ts = Date.parse(String(d.timestamp ?? '')) || Date.now()
      const push = (e: Omit<FeedEvent, 'id' | 'ts'>): void => {
        out.push({ ...e, id: `${a.sessionId}:${a.seq++}`, ts })
      }

      if (a.agent === 'claude') {
        if (d.type === 'user' || d.type === 'assistant') {
          const msg = (d.message ?? {}) as Record<string, unknown>
          const { text, tools } = textFromClaude(msg.content)
          if (text.trim()) push({ role: d.type as 'user' | 'assistant', text: text.trim() })
          for (const t of tools) {
            const { verb, detail } = describeTool(t.name, t.input)
            push({ role: 'tool', text: detail, tool: verb })
          }
        }
      } else {
        const p = (d.payload ?? {}) as Record<string, unknown>
        if (d.type === 'event_msg' && typeof p.message === 'string') {
          if (p.type === 'user_message') push({ role: 'user', text: p.message.trim() })
          else if (p.type === 'agent_message') push({ role: 'assistant', text: p.message.trim() })
        }
      }
    }
    return out
  }
}

async function newestSince(
  dir: string,
  names: string[],
  since: number,
  skip: Set<string> = new Set()
): Promise<{ path: string; mtime: number } | null> {
  let best: { path: string; mtime: number } | null = null
  for (const n of names) {
    const p = join(dir, n)
    if (skip.has(p)) continue
    try {
      const st = await stat(p)
      if (st.mtimeMs < since) continue
      if (!best || st.mtimeMs > best.mtime) best = { path: p, mtime: st.mtimeMs }
    } catch {
      /* skip */
    }
  }
  return best
}

function readRange(file: string, start: number, end: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = []
    createReadStream(file, { start, end: Math.max(start, end - 1) })
      .on('data', (c) => parts.push(c as Buffer))
      .on('end', () => resolve(Buffer.concat(parts).toString('utf8')))
      .on('error', reject)
  })
}

export { basename }
