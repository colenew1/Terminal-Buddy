/**
 * Proves the conversation view end to end.
 *
 * Writes a real transcript into the folder a pane is sitting in, exactly as
 * Claude Code would, and checks the UI discovers it, tails it, and renders the
 * turns as conversation — including a tool call shown as "Opened notes/todo.md"
 * rather than as the call that produced it. No agent is started, so this costs
 * nothing to run.
 */
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 9231
const testRoot = mkdtempSync(join(tmpdir(), 'terminal-buddy-feed-'))
const HOME = join(testRoot, 'home')
const profile = join(testRoot, 'profile')
mkdirSync(HOME, { recursive: true })
mkdirSync(profile, { recursive: true })
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ walkthroughVersion: 1, desktopNotifications: false }))
const slug = HOME.replace(/[^A-Za-z0-9]/g, '-')
const projectDir = join(HOME, '.claude', 'projects', slug)
const transcript = join(projectDir, `feedtest-${Date.now()}.jsonl`)

const child = spawn('node_modules/electron/dist/electron.exe', [
  './out/main/index.js', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`
], {
  stdio: 'ignore',
  env: { ...process.env, HOME, USERPROFILE: HOME }
})

let exitedEarly = null
child.on('exit', (c) => { exitedEarly = c })

let ws
let nextId = 1
const pending = new Map()
let failures = 0

const check = (n, ok, d = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `  — ${d}` : ''}`)
}

function send(method, params = {}) {
  const id = nextId++
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((res, rej) => {
    pending.set(id, { res, rej })
    setTimeout(() => pending.delete(id) && rej(new Error(method + ' timeout')), 30000)
  })
}
async function newTerminal(selector = '.tab-new') {
  await ev(`document.querySelector(${JSON.stringify(selector)}).click()`)
  for (let i=0;i<60;i++) {
    if (await ev(`!!document.querySelector('[data-new-kind="shell"]:not(:disabled)')`)) break
    await sleep(50)
  }
  await ev(`document.querySelector('[data-new-kind="shell"]').click()`)
}

async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed')
  return r.result.value
}

const iso = () => new Date().toISOString()

try {
  let page
  for (let i = 0; i < 60; i++) {
    if (exitedEarly !== null) throw new Error('app quit early — another instance running?')
    try {
      const t = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      page = t.find((x) => x.type === 'page' && x.webSocketDebuggerUrl)
      if (page) break
    } catch { /* not up */ }
    await sleep(500)
  }
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('ws')) })
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id)
      m.error ? p.rej(new Error(m.error.message)) : p.res(m.result)
    }
  }
  await send('Runtime.enable')
  await ev(`window.__feed=[]; window.buddy.feed.onEvents((id,events)=>window.__feed.push(...events))`)
  for (let i = 0; i < 40; i++) {
    if (await ev(`!!document.querySelector('.app') && !document.querySelector('.boot')`)) break
    await sleep(500)
  }
  await newTerminal()
  await sleep(2500)

  check('pane opens on the live terminal, not a transcript overlay', await ev(`!document.querySelector('.agent') && !!document.querySelector('.xterm')`))
  check('native terminal is the only input surface', await ev(`!!document.querySelector('.xterm-helper-textarea') && !document.querySelector('.composer-input')`))

  // Write a transcript the way Claude Code does, one JSON object per line.
  mkdirSync(projectDir, { recursive: true })
  const lines = [
    { type: 'user', timestamp: iso(), cwd: HOME, message: { role: 'user', content: 'Ping from the feed test' } },
    {
      type: 'assistant',
      timestamp: iso(),
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Pong. Opening a file now.' },
          { type: 'tool_use', name: 'Read', input: { file_path: join(HOME, 'notes', 'todo.md') } }
        ]
      }
    }
  ]
  writeFileSync(transcript, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')

  let state = null
  for (let i = 0; i < 30; i++) {
    await sleep(700)
    state = await ev(`({
      bubbles: window.__feed.filter(e=>e.role==='user'||e.role==='assistant').map(e=>e.text),
      roles: window.__feed.map(e=>e.role),
      tools: window.__feed.filter(e=>e.role==='tool').map(e=>e.tool+' '+e.text),
      badge: document.querySelector('.cell-head .badge')?.textContent ?? ''
    })`)
    if (state.bubbles.length >= 2) break
  }

  check('background telemetry receives both turns without a transcript UI', state.bubbles.length >= 2, JSON.stringify(state.bubbles))
  check('turns are attributed', state.roles.includes('user') && state.roles.includes('assistant'), state.roles.join(', '))
  check(
    'a tool call reads as plain language',
    state.tools.some((t) => /Opened/.test(t) && /todo\.md/.test(t)),
    JSON.stringify(state.tools)
  )

  // Appending should stream in without re-reading the file from the top.
  writeFileSync(
    transcript,
    JSON.stringify({ type: 'assistant', timestamp: iso(), message: { role: 'assistant', content: 'One more thing.' } }) + '\n',
    { flag: 'a' }
  )
  let tailed = []
  for (let i = 0; i < 20; i++) {
    await sleep(700)
    tailed = await ev(`window.__feed.filter(e=>e.role==='user'||e.role==='assistant').map(e=>e.text)`)
    if (tailed.length >= 3) break
  }
  const once = tailed.filter((t) => t === 'Ping from the feed test').length
  check('appended turns stream in', tailed.length >= 3, `${tailed.length} bubbles`)
  check('nothing is replayed twice', once === 1, `first turn appears ${once}x`)

  // A second pane proves the current Codex response-item format and its MCP
  // namespaces become readable tool activity with an explicit server name.
  await newTerminal()
  await sleep(900)
  const now = new Date()
  const codexDir = join(
    HOME,
    '.codex',
    'sessions',
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  )
  mkdirSync(codexDir, { recursive: true })
  const codexTranscript = join(codexDir, `rollout-feedtest-${Date.now()}.jsonl`)
  const codexLines = [
    { type: 'session_meta', timestamp: iso(), payload: { session_id: 'feed-test', cwd: HOME } },
    { type: 'event_msg', timestamp: iso(), payload: { type: 'user_message', message: 'Codex feed ping' } },
    {
      type: 'response_item',
      timestamp: iso(),
      payload: {
        type: 'function_call',
        namespace: 'mcp__filesystem',
        name: 'read_file',
        arguments: JSON.stringify({ path: join(HOME, 'notes.md') })
      }
    },
    { type: 'event_msg', timestamp: iso(), payload: { type: 'agent_message', message: 'Codex feed pong' } }
  ]
  writeFileSync(codexTranscript, codexLines.map((line) => JSON.stringify(line)).join('\n') + '\n')

  let codexState = null
  for (let i = 0; i < 30; i++) {
    await sleep(600)
    codexState = await ev(`({
      bubbles: window.__feed.filter(e=>e.role==='user'||e.role==='assistant').map(e=>e.text),
      tools: window.__feed.filter(e=>e.role==='tool').map(e=>e.tool+' '+e.text)
    })`)
    if (codexState.bubbles.includes('Codex feed pong')) break
  }
  check('Codex response items join the conversation', codexState.bubbles.includes('Codex feed pong'))
  check('Codex MCP calls identify their server', codexState.tools.some((t) => /filesystem/.test(t)), JSON.stringify(codexState.tools))


  // Telemetry never covers the real terminal.
  await ev(`[...document.querySelectorAll('.seg button')].find(b => b.textContent === 'Grid')?.click()`)
  await sleep(900)
  await sleep(800)
  check(
    'background telemetry never replaces the terminal',
    await ev(`!document.querySelector('.cell.is-active .agent') && !!document.querySelector('.cell.is-active .xterm')`)
  )
} catch (e) {
  check('harness', false, e.message)
} finally {
  try { ws?.close() } catch { /* ignore */ }
  child.kill()
  // ConPTY can outlive Electron by a beat while Windows releases its cwd.
  await sleep(800)
  rmSync(testRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
  console.log(failures ? `\n${failures} failed` : '\nall feed checks passed')
  process.exit(failures ? 1 : 0)
}
