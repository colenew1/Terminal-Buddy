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
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 9231
const HOME = homedir()
const slug = HOME.replace(/[^A-Za-z0-9]/g, '-')
const projectDir = join(HOME, '.claude', 'projects', slug)
const transcript = join(projectDir, `feedtest-${Date.now()}.jsonl`)

const wsFile = join(process.env.APPDATA ?? '', 'terminal-buddy', 'workspace.json')
if (existsSync(wsFile)) {
  const w = JSON.parse(readFileSync(wsFile, 'utf8'))
  writeFileSync(wsFile, JSON.stringify({ ...w, sessions: [], layout: 'tabs' }, null, 2))
}

const child = spawn('node_modules/electron/dist/electron.exe', [
  './out/main/index.js', `--remote-debugging-port=${PORT}`
], { stdio: 'ignore' })

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
  for (let i = 0; i < 40; i++) {
    if (await ev(`!!document.querySelector('.app') && !document.querySelector('.boot')`)) break
    await sleep(500)
  }
  await sleep(2500)

  check('pane opens on the conversation, not the terminal', await ev(`!!document.querySelector('.agent')`))
  check('composer is present', await ev(`!!document.querySelector('.composer-input')`))

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
      bubbles: [...document.querySelectorAll('.bubble-text')].map(b => b.textContent),
      roles: [...document.querySelectorAll('.bubble')].map(b => b.className.replace('bubble ','')),
      tools: [...document.querySelectorAll('.turn-tool')].map(t => t.textContent),
      badge: document.querySelector('.cell-head .badge')?.textContent ?? ''
    })`)
    if (state.bubbles.length >= 2) break
  }

  check('conversation renders both turns', state.bubbles.length >= 2, JSON.stringify(state.bubbles))
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
    tailed = await ev(`[...document.querySelectorAll('.bubble-text')].map(b => b.textContent)`)
    if (tailed.length >= 3) break
  }
  const once = tailed.filter((t) => t === 'Ping from the feed test').length
  check('appended turns stream in', tailed.length >= 3, `${tailed.length} bubbles`)
  check('nothing is replayed twice', once === 1, `first turn appears ${once}x`)

  // Dev mode lifts the lid on the real terminal.
  await ev(`[...document.querySelectorAll('.seg button')].find(b => b.textContent === 'Grid')?.click()`)
  await sleep(900)
  await ev(`[...document.querySelectorAll('.cell-head .icon-btn')].find(b => b.textContent === '</>')?.click()`)
  await sleep(800)
  check('dev mode reveals the terminal', await ev(`!document.querySelector('.agent') && !!document.querySelector('.xterm')`))
} catch (e) {
  check('harness', false, e.message)
} finally {
  try { ws?.close() } catch { /* ignore */ }
  child.kill()
  rmSync(transcript, { force: true })
  await sleep(400)
  console.log(failures ? `\n${failures} failed` : '\nall feed checks passed')
  process.exit(failures ? 1 : 0)
}
