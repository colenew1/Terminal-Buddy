import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { join, basename, sep } from 'node:path'
import { homedir } from 'node:os'
import { parse as parseYaml } from 'yaml'
import type {
  Catalog,
  ChatEntry,
  ChatTranscript,
  ChatTurn,
  ProjectEntry,
  ScanProgress,
  SkillEntry,
  SkillSource
} from '@shared/types'

const HOME = homedir()
const CLAUDE_DIR = join(HOME, '.claude')
const CODEX_DIR = join(HOME, '.codex')

/** Prompts that are machinery, not something a human typed. */
const INJECTED = [
  '# AGENTS.md',
  '# Instructions',
  '<INSTRUCTIONS>',
  '<user_instructions>',
  '<permissions instructions>',
  '<environment_context>',
  '<system-reminder>',
  '<command-name>',
  '<command-message>',
  '<local-command-caveat>',
  '<local-command-stdout>',
  'The following is the Codex agent history',
  'Caveat: The messages below',
  'This session is being continued from a previous'
]

function looksInjected(text: string): boolean {
  const t = text.trimStart()
  return INJECTED.some((p) => t.startsWith(p))
}

function squish(s: string, max = 240): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}

async function walk(root: string, match: (p: string) => boolean, maxDepth = 8): Promise<string[]> {
  const found: string[] = []
  async function rec(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return
    let items: import('node:fs').Dirent[]
    try {
      items = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const it of items) {
      const p = join(dir, it.name)
      if (it.isDirectory()) {
        if (it.name === 'node_modules' || it.name === '.git') continue
        await rec(p, depth + 1)
      } else if (match(p)) {
        found.push(p)
      }
    }
  }
  await rec(root, 0)
  return found
}

async function pool<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) || 1 }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}

/* ------------------------------------------------------------------ skills */

function parseFrontmatter(raw: string): { meta: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw)
  if (!m) return { meta: {}, body: raw }
  try {
    const meta = parseYaml(m[1]) as Record<string, unknown>
    return { meta: meta && typeof meta === 'object' ? meta : {}, body: m[2] }
  } catch {
    return { meta: {}, body: m[2] }
  }
}

/** `.../<plugin>/<hash>/skills/<name>/SKILL.md` -> the plugin name. */
function pluginOrigin(path: string): string {
  const parts = path.split(sep)
  const i = parts.lastIndexOf('skills')
  if (i <= 0) return 'plugin'
  const prev = parts[i - 1]
  const isHash = /^[0-9a-f]{6,}$/i.test(prev)
  return (isHash ? parts[i - 2] : prev) || 'plugin'
}

async function readSkill(path: string, source: SkillSource, origin: string): Promise<SkillEntry | null> {
  try {
    const [raw, st] = await Promise.all([readFile(path, 'utf8'), stat(path)])
    const { meta } = parseFrontmatter(raw)
    const name = String(meta.name || basename(join(path, '..')))
    const description = String(meta.description ?? '').trim()
    return {
      id: `${source}:${origin}:${name}`,
      name,
      description: squish(description, 400),
      source,
      agent: source.startsWith('codex') ? 'codex' : 'claude',
      origin,
      path,
      mtime: st.mtimeMs
    }
  } catch {
    return null
  }
}

async function scanSkills(extraRoots: string[], errors: string[]): Promise<SkillEntry[]> {
  const found: SkillEntry[] = []

  // 1. User-level Claude skills.
  const userSkills = join(CLAUDE_DIR, 'skills')
  if (existsSync(userSkills)) {
    for (const f of await walk(userSkills, (p) => basename(p) === 'SKILL.md', 3)) {
      const s = await readSkill(f, 'claude-user', 'user')
      if (s) found.push(s)
    }
  }

  // 2. Plugin skills. The cache keeps every downloaded version, so collapse to newest.
  const pluginDir = join(CLAUDE_DIR, 'plugins')
  if (existsSync(pluginDir)) {
    const files = await walk(pluginDir, (p) => basename(p) === 'SKILL.md', 9)
    const entries = (await pool(files, 12, (f) => readSkill(f, 'claude-plugin', pluginOrigin(f)))).filter(
      (e): e is SkillEntry => e !== null
    )
    const newest = new Map<string, SkillEntry>()
    for (const e of entries) {
      const key = `${e.origin}/${e.name}`
      const cur = newest.get(key)
      if (!cur || e.mtime > cur.mtime) newest.set(key, e)
    }
    found.push(...newest.values())
  }

  // 3. Project-level skills, for every project we know about.
  for (const root of extraRoots) {
    const dir = join(root, '.claude', 'skills')
    if (!existsSync(dir)) continue
    for (const f of await walk(dir, (p) => basename(p) === 'SKILL.md', 3)) {
      const s = await readSkill(f, 'claude-project', basename(root))
      if (s) found.push(s)
    }
  }

  // 4. Codex prompts and plugin skills.
  const prompts = join(CODEX_DIR, 'prompts')
  if (existsSync(prompts)) {
    try {
      for (const name of await readdir(prompts)) {
        if (!name.endsWith('.md')) continue
        const p = join(prompts, name)
        const [raw, st] = await Promise.all([readFile(p, 'utf8'), stat(p)])
        const { meta, body } = parseFrontmatter(raw)
        found.push({
          id: `codex-prompt:${name}`,
          name: String(meta.name || name.replace(/\.md$/, '')),
          description: squish(String(meta.description ?? body), 400),
          source: 'codex-prompt',
          agent: 'codex',
          origin: 'prompts',
          path: p,
          mtime: st.mtimeMs
        })
      }
    } catch (e) {
      errors.push(`codex prompts: ${(e as Error).message}`)
    }
  }

  const codexPlugins = join(CODEX_DIR, 'plugins')
  if (existsSync(codexPlugins)) {
    for (const f of await walk(codexPlugins, (p) => basename(p) === 'SKILL.md', 9)) {
      const s = await readSkill(f, 'codex-plugin', pluginOrigin(f))
      if (s) found.push(s)
    }
  }

  found.sort((a, b) => a.name.localeCompare(b.name))
  return found
}

/* ------------------------------------------------------------------- chats */

/** Claude writes JSON with a space after the colon; be tolerant of both forms. */
function hasType(line: string, type: string): boolean {
  return line.includes(`"type": "${type}"`) || line.includes(`"type":"${type}"`)
}

function textFromClaudeContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const b of content) {
    if (!b || typeof b !== 'object') continue
    const blk = b as Record<string, unknown>
    if (blk.type === 'text' && typeof blk.text === 'string') parts.push(blk.text)
    else if (blk.type === 'tool_use') parts.push(`[tool: ${String(blk.name ?? 'unknown')}]`)
  }
  return parts.join('\n')
}

/** `C--Users-Owner-Desktop-code-projects-Foo` -> a best-effort path. Lossy on purpose. */
function projectSlugToPath(slug: string): string {
  const m = /^([A-Za-z])--(.*)$/.exec(slug)
  if (!m) return ''
  return `${m[1]}:\\${m[2].split('-').join('\\')}`
}

async function parseClaudeChat(path: string, bytes: number, mtime: number): Promise<ChatEntry> {
  const id = basename(path).replace(/\.jsonl$/, '')
  const project = basename(join(path, '..'))
  let title = ''
  let clean = ''
  let anyUser = ''
  let cwd = ''
  let startedAt = 0
  let turns = 0

  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity })
  try {
    for await (const line of rl) {
      if (line.length < 12) continue
      // Titles are regenerated as the session grows; the last one is current.
      if (line.includes('"ai-title"')) {
        try {
          const d = JSON.parse(line)
          if (d.type === 'ai-title' && typeof d.aiTitle === 'string') title = d.aiTitle
        } catch {
          /* ignore malformed line */
        }
        continue
      }
      if (!hasType(line, 'user')) continue
      turns++
      if (clean) continue
      try {
        const d = JSON.parse(line)
        if (d.type !== 'user') continue
        if (!cwd && typeof d.cwd === 'string') cwd = d.cwd
        if (!startedAt && d.timestamp) startedAt = Date.parse(d.timestamp) || 0
        const text = textFromClaudeContent(d.message?.content)
        if (!text.trim()) continue
        if (!anyUser) anyUser = squish(text)
        // A resumed session often opens with a caveat block or a slash command.
        // Keep looking for something a person actually typed.
        if (!looksInjected(text)) clean = squish(text)
      } catch {
        /* ignore malformed line */
      }
    }
  } finally {
    rl.close()
  }

  const preview = clean || anyUser
  return {
    id,
    agent: 'claude',
    title: title || (preview ? squish(preview, 70) : 'Untitled session'),
    preview,
    cwd: cwd || projectSlugToPath(project),
    project,
    path,
    startedAt: startedAt || mtime,
    updatedAt: mtime,
    turns,
    bytes,
    // An AI title means Claude summarised a real conversation here.
    internal: !clean && !title
  }
}

async function parseCodexChat(path: string, bytes: number, mtime: number): Promise<ChatEntry> {
  let sessionId = ''
  let rolloutId = ''
  let cwd = ''
  let startedAt = 0
  let preview = ''
  let anyUser = ''
  let turns = 0

  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity })
  try {
    for await (const line of rl) {
      if (line.length < 12) continue
      if (!sessionId && line.includes('session_meta')) {
        try {
          const d = JSON.parse(line)
          const p = d.payload ?? {}
          sessionId = String(p.session_id ?? '')
          rolloutId = String(p.id ?? '')
          cwd = String(p.cwd ?? '')
          startedAt = Date.parse(p.timestamp ?? d.timestamp ?? '') || 0
        } catch {
          /* ignore malformed line */
        }
        continue
      }
      if (!line.includes('"user_message"')) continue
      turns++
      if (preview) continue
      try {
        const d = JSON.parse(line)
        const msg = d?.payload?.message
        if (typeof msg !== 'string' || !msg.trim()) continue
        if (!anyUser) anyUser = squish(msg)
        // The first user_message is usually an AGENTS.md injection, not the prompt.
        if (!looksInjected(msg)) preview = squish(msg)
      } catch {
        /* ignore malformed line */
      }
    }
  } finally {
    rl.close()
  }

  const fileId = /rollout-[\dT-]*?-([0-9a-f]{8}-[0-9a-f-]{27})/i.exec(basename(path))?.[1] ?? ''
  const primary = sessionId || rolloutId || fileId
  const alt = primary === rolloutId ? sessionId : rolloutId || fileId
  const shown = preview || anyUser

  return {
    id: primary,
    altId: alt && alt !== primary ? alt : undefined,
    agent: 'codex',
    title: shown ? squish(shown, 70) : 'Untitled session',
    preview: shown,
    cwd,
    project: cwd ? basename(cwd) : 'unknown',
    path,
    startedAt: startedAt || mtime,
    updatedAt: mtime,
    turns,
    bytes,
    internal: !preview
  }
}

/* ------------------------------------------------------------- cache + api */

interface CacheShape {
  version: number
  files: Record<string, { size: number; mtimeMs: number; entry: ChatEntry }>
}

// Bump whenever parsing changes, so cached entries are re-derived.
const CACHE_VERSION = 5

/**
 * Indexes ~300MB of agent transcripts. Every parse is keyed on (size, mtime),
 * so the expensive pass happens once and later launches are effectively free.
 */
export class CatalogService {
  private cache: CacheShape = { version: CACHE_VERSION, files: {} }
  private cacheLoaded = false
  private inFlight: Promise<Catalog> | null = null
  private last: Catalog | null = null

  constructor(
    private cachePath: string,
    private onProgress: (p: ScanProgress) => void
  ) {}

  get cached(): Catalog | null {
    return this.last
  }

  private loadCache(): void {
    if (this.cacheLoaded) return
    this.cacheLoaded = true
    try {
      if (!existsSync(this.cachePath)) return
      const parsed = JSON.parse(readFileSync(this.cachePath, 'utf8')) as CacheShape
      if (parsed.version === CACHE_VERSION && parsed.files) this.cache = parsed
    } catch {
      /* start cold */
    }
  }

  private async saveCache(): Promise<void> {
    try {
      await writeFile(this.cachePath, JSON.stringify(this.cache), 'utf8')
    } catch {
      /* non-fatal */
    }
  }

  scan(extraRoots: string[] = []): Promise<Catalog> {
    if (this.inFlight) return this.inFlight
    this.inFlight = this.doScan(extraRoots).finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  private async doScan(extraRoots: string[]): Promise<Catalog> {
    this.loadCache()
    const errors: string[] = []

    this.onProgress({ phase: 'skills', done: 0, total: 1 })
    const skills = await scanSkills(extraRoots, errors).catch((e: Error) => {
      errors.push(`skills: ${e.message}`)
      return [] as SkillEntry[]
    })

    const files: { path: string; agent: 'claude' | 'codex' }[] = []
    const claudeProjects = join(CLAUDE_DIR, 'projects')
    if (existsSync(claudeProjects)) {
      for (const p of await walk(claudeProjects, (f) => f.endsWith('.jsonl'), 2)) {
        files.push({ path: p, agent: 'claude' })
      }
    }
    const codexSessions = join(CODEX_DIR, 'sessions')
    if (existsSync(codexSessions)) {
      for (const p of await walk(codexSessions, (f) => f.endsWith('.jsonl'), 5)) {
        files.push({ path: p, agent: 'codex' })
      }
    }

    let done = 0
    this.onProgress({ phase: 'chats', done: 0, total: files.length })

    const parsed = await pool(files, 6, async ({ path, agent }) => {
      let entry: ChatEntry | null = null
      try {
        const st = await stat(path)
        const hit = this.cache.files[path]
        if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) {
          entry = hit.entry
        } else if (st.size > 0 && st.size < 256 * 1024 * 1024) {
          entry =
            agent === 'claude'
              ? await parseClaudeChat(path, st.size, st.mtimeMs)
              : await parseCodexChat(path, st.size, st.mtimeMs)
          this.cache.files[path] = { size: st.size, mtimeMs: st.mtimeMs, entry }
        }
      } catch (e) {
        errors.push(`${basename(path)}: ${(e as Error).message}`)
      }
      done++
      if (done % 5 === 0 || done === files.length) {
        this.onProgress({ phase: 'chats', done, total: files.length })
      }
      return entry
    })

    const chats = parsed.filter((c): c is ChatEntry => c !== null && c.turns > 0)

    // Forget cache rows whose files are gone.
    const live = new Set(files.map((f) => f.path))
    for (const k of Object.keys(this.cache.files)) if (!live.has(k)) delete this.cache.files[k]
    await this.saveCache()

    chats.sort((a, b) => b.updatedAt - a.updatedAt)

    const byProject = new Map<string, ProjectEntry>()
    for (const c of chats) {
      if (!c.cwd) continue
      const cur = byProject.get(c.cwd)
      if (cur) {
        cur.chats++
        cur.lastActive = Math.max(cur.lastActive, c.updatedAt)
      } else {
        byProject.set(c.cwd, {
          path: c.cwd,
          name: basename(c.cwd) || c.cwd,
          chats: 1,
          lastActive: c.updatedAt,
          exists: existsSync(c.cwd)
        })
      }
    }
    const projects = [...byProject.values()].sort((a, b) => b.lastActive - a.lastActive)

    this.onProgress({ phase: 'done', done: files.length, total: files.length })
    this.last = { skills, chats, projects, scannedAt: Date.now(), errors }
    return this.last
  }

  /** Reads a transcript back into readable turns, tool noise collapsed. */
  async transcript(path: string, agent: 'claude' | 'codex', limit = 400): Promise<{ turns: ChatTurn[]; truncated: boolean }> {
    const turns: ChatTurn[] = []
    let truncated = false
    const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity })
    try {
      for await (const line of rl) {
        if (turns.length >= limit) {
          truncated = true
          break
        }
        if (line.length < 12) continue
        try {
          if (agent === 'claude') {
            if (!hasType(line, 'user') && !hasType(line, 'assistant')) continue
            const d = JSON.parse(line)
            if (d.type !== 'user' && d.type !== 'assistant') continue
            const text = textFromClaudeContent(d.message?.content).trim()
            if (!text) continue
            turns.push({ role: d.type, text, ts: Date.parse(d.timestamp ?? '') || 0 })
          } else {
            if (!line.includes('"user_message"') && !line.includes('"agent_message"')) continue
            const d = JSON.parse(line)
            const kind = d?.payload?.type
            const msg = d?.payload?.message
            if (typeof msg !== 'string' || !msg.trim()) continue
            if (kind === 'user_message') turns.push({ role: 'user', text: msg, ts: Date.parse(d.timestamp ?? '') || 0 })
            else if (kind === 'agent_message')
              turns.push({ role: 'assistant', text: msg, ts: Date.parse(d.timestamp ?? '') || 0 })
          }
        } catch {
          /* ignore malformed line */
        }
      }
    } finally {
      rl.close()
    }
    return { turns, truncated }
  }
}

export function buildMarkdown(t: ChatTranscript, resumeCommand: string): string {
  const e = t.entry
  const iso = (n: number): string => (n ? new Date(n).toISOString() : 'unknown')
  const head = [
    '---',
    `title: ${JSON.stringify(e.title)}`,
    `agent: ${e.agent}`,
    `session_id: ${e.id}`,
    e.altId ? `alt_id: ${e.altId}` : '',
    `cwd: ${JSON.stringify(e.cwd)}`,
    `started: ${iso(e.startedAt)}`,
    `updated: ${iso(e.updatedAt)}`,
    `turns: ${e.turns}`,
    `source: ${JSON.stringify(e.path)}`,
    '---',
    '',
    `# ${e.title}`,
    '',
    `> Resume with \`${resumeCommand}\` in \`${e.cwd || 'the original folder'}\``,
    ''
  ].filter(Boolean)

  const body: string[] = []
  for (const turn of t.turns) {
    body.push(`## ${turn.role === 'user' ? 'User' : 'Assistant'}${turn.ts ? ` — ${iso(turn.ts)}` : ''}`, '', turn.text, '')
  }
  if (t.truncated) body.push('---', '', '_Transcript truncated by Terminal Buddy._')
  return [...head, ...body].join('\n')
}
