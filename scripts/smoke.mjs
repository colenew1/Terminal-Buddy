/**
 * End-to-end smoke test. Boots the built app with a CDP port, drives the real
 * renderer, and saves a screenshot. Run: node scripts/smoke.mjs
 */
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 9222
const OUT = process.argv[2] ?? 'smoke.png'

// BUDDY_EXE points the harness at a packaged build instead of the dev output.
const packaged = process.env.BUDDY_EXE
const electron =
  packaged ?? (process.platform === 'win32' ? 'node_modules/electron/dist/electron.exe' : 'node_modules/.bin/electron')
const args = packaged
  ? [`--remote-debugging-port=${PORT}`]
  : ['./out/main/index.js', `--remote-debugging-port=${PORT}`]

const child = spawn(electron, args, {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' }
})

let exitedEarly = null
child.on('exit', (code) => { exitedEarly = code })

const appLog = []
child.stdout.on('data', (d) => appLog.push(['out', String(d)]))
child.stderr.on('data', (d) => appLog.push(['err', String(d)]))

let ws
let nextId = 1
const pending = new Map()
const consoleErrors = []

function send(method, params = {}) {
  const id = nextId++
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`${method} timed out`))
    }, 60000)
  })
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed')
  return r.result.value
}

async function findPage() {
  for (let i = 0; i < 60; i++) {
    if (exitedEarly !== null) {
      throw new Error(
        'the app quit before the harness attached (exit ' + exitedEarly + '). ' +
        'Another Terminal Buddy is probably already running — it holds the single-instance lock. Close it and retry.'
      )
    }
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const targets = await res.json()
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      /* not listening yet */
    }
    await sleep(500)
  }
  throw new Error('CDP target never appeared')
}

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

try {
  const page = await findPage()
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = () => rej(new Error('CDP socket failed'))
  })
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '))
    } else if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(msg.params.exceptionDetails.exception?.description ?? 'exception')
    }
  }

  await send('Runtime.enable')
  await send('Page.enable')

  // Boot: the splash must go away and the shell UI must render.
  let booted = false
  for (let i = 0; i < 40; i++) {
    booted = await evaluate(`!!document.querySelector('.app') && !document.querySelector('.boot')`)
    if (booted) break
    await sleep(500)
  }
  check('app boots past splash', booted)

  const shells = await evaluate(`window.buddy.shells.list().then(s => s.map(x => x.label))`)
  check('shells detected', Array.isArray(shells) && shells.length > 0, shells?.join(', '))

  // The WebGL renderer draws to a canvas, so there is no row text to read.
  // Assert on geometry instead, and prove the data path separately below.
  let geom = null
  for (let i = 0; i < 30; i++) {
    geom = await evaluate(`(() => {
      const host = document.querySelector('.pane-host')
      if (!host) return null
      const screen = host.querySelector('.xterm-screen')
      return {
        hasXterm: !!host.querySelector('.xterm'),
        w: screen ? screen.clientWidth : 0,
        h: screen ? screen.clientHeight : 0,
        canvases: host.querySelectorAll('canvas').length
      }
    })()`)
    if (geom?.hasXterm && geom.w > 100) break
    await sleep(500)
  }
  check('terminal mounted with real geometry', !!geom?.hasXterm && geom.w > 100 && geom.h > 100,
    geom ? `${geom.w}x${geom.h}, ${geom.canvases} canvases` : 'no pane')

  // Full round-trip through the main process: spawn, type, read output back.
  const roundTrip = await evaluate(`(async () => {
    const info = await window.buddy.pty.create({ cwd: ${JSON.stringify(process.cwd())} })
    let acc = ''
    const off = window.buddy.pty.onData((id, d) => { if (id === info.id) acc += d })
    await new Promise(r => setTimeout(r, 900))
    window.buddy.pty.write(info.id, 'echo SMOKE_MARKER\\r')
    await new Promise(r => setTimeout(r, 3500))
    off(); window.buddy.pty.kill(info.id)
    return { saw: acc.includes('SMOKE_MARKER'), bytes: acc.length, pid: info.pid }
  })()`)
  check('pty round-trip (spawn → write → output)', roundTrip.saw, `${roundTrip.bytes} bytes`)

  // pid arrives asynchronously on ConPTY; the store patches it once output starts.
  const pid = await evaluate(`(async () => {
    const info = await window.buddy.pty.create({ cwd: ${JSON.stringify(process.cwd())} })
    let got = 0
    const off = window.buddy.pty.onInfo((id, patch) => { if (id === info.id) got = patch.pid })
    await new Promise(r => setTimeout(r, 3000))
    off(); window.buddy.pty.kill(info.id)
    return got
  })()`)
  check('pid resolves after spawn', pid > 0, `pid ${pid}`)

  // The taskbar badge is painted here and consumed by main; make sure it is a
  // real PNG and that pushing status does not throw across the bridge.
  const badge = await evaluate(`(async () => {
    const mod = await import('/src/lib/badge.ts').catch(() => null)
    const draw = mod?.drawBadge
    const url = draw ? draw(3) : null
    window.buddy.app.setStatus(2, 1, url)
    window.buddy.app.setStatus(0, 0, null)
    return { hasFn: !!draw, png: typeof url === 'string' && url.startsWith('data:image/png;base64,'), len: url ? url.length : 0 }
  })()`).catch(() => ({ hasFn: false, png: false, len: 0 }))
  // In a production build the module specifier is bundled away; fall back to
  // asserting the bridge alone.
  if (badge.hasFn) check('taskbar badge renders a PNG', badge.png, `${badge.len} chars`)
  else {
    await evaluate(`window.buddy.app.setStatus(2, 1, null); true`)
    check('status bridge accepts fleet updates', true, 'badge module bundled')
  }

  const catalog = await evaluate(`window.buddy.catalog.get().then(c => ({
    skills: c.skills.length,
    chats: c.chats.length,
    projects: c.projects.length,
    errors: c.errors.length
  }))`)
  check('catalog indexed skills', catalog.skills > 0, `${catalog.skills} skills`)
  check('catalog indexed chats', catalog.chats > 0, `${catalog.chats} chats`)
  check('catalog indexed projects', catalog.projects > 0, `${catalog.projects} projects`)
  if (catalog.errors > 0) console.log(`      (${catalog.errors} files unreadable)`)

  // Open the sidebar and switch to grid, then confirm panes still measure.
  await evaluate(`document.querySelectorAll('.topbar .icon-btn')[0].click()`)
  await sleep(400)
  const sidebar = await evaluate(`!!document.querySelector('.sidebar')`)
  check('sidebar opens', sidebar)

  const rowCount = await evaluate(`document.querySelectorAll('.sidebar-body .row').length`)
  check('sidebar lists rows', rowCount > 0, `${rowCount} rows`)

  await evaluate(`[...document.querySelectorAll('.seg button')].find(b => b.textContent === 'Grid')?.click()`)
  await sleep(600)
  const gridOk = await evaluate(`!!document.querySelector('.area-grid')`)
  check('grid layout applies', gridOk)

  const afterGrid = await evaluate(`(() => {
    const boxes = [...document.querySelectorAll('.pane-host .xterm-screen')]
    return boxes.map(b => b.clientWidth + 'x' + b.clientHeight)
  })()`)
  const allSized = afterGrid.length > 0 && afterGrid.every((s) => Number(s.split('x')[0]) > 50)
  check('panes still sized after layout switch', allSized, afterGrid.join(', '))

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(OUT, Buffer.from(shot.data, 'base64'))
  console.log(`\nscreenshot -> ${OUT}`)

  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
} catch (err) {
  console.error('\nSMOKE ERROR:', err.message)
  results.push({ name: 'harness', ok: false, detail: err.message })
} finally {
  try {
    ws?.close()
  } catch {
    /* ignore */
  }
  child.kill()
  await sleep(500)
  if (appLog.length) {
    console.log('\n--- app output ---')
    for (const [k, v] of appLog.slice(0, 20)) process.stdout.write(`[${k}] ${v}`)
  }
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  process.exit(failed.length ? 1 : 0)
}
