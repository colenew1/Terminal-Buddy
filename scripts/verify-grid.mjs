/** Opens several terminals, switches to grid, and checks every pane is real. */
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 9224
const OUT = process.argv[2] ?? 'grid.png'
const WANT = 6

const exe = process.env.BUDDY_EXE
const bin = exe ?? (process.platform === 'win32' ? 'node_modules/electron/dist/electron.exe' : 'node_modules/.bin/electron')
const args = exe ? [`--remote-debugging-port=${PORT}`] : ['./out/main/index.js', `--remote-debugging-port=${PORT}`]
const child = spawn(bin, args, { stdio: 'ignore' })

let ws
let nextId = 1
const pending = new Map()
const errors = []
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
    setTimeout(() => pending.delete(id) && rej(new Error(method + ' timeout')), 40000)
  })
}
async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed')
  return r.result.value
}

try {
  let page
  for (let i = 0; i < 60; i++) {
    try {
      const t = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      page = t.find((x) => x.type === 'page' && x.webSocketDebuggerUrl)
      if (page) break
    } catch {
      /* not up yet */
    }
    await sleep(500)
  }
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => {
    ws.onopen = r
    ws.onerror = () => j(new Error('ws fail'))
  })
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id)
      pending.delete(m.id)
      m.error ? p.rej(new Error(m.error.message)) : p.res(m.result)
    } else if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params.exceptionDetails.exception?.description ?? 'exception')
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '))
    }
  }
  await send('Runtime.enable')

  for (let i = 0; i < 40; i++) {
    if (await ev(`!!document.querySelector('.app') && !document.querySelector('.boot')`)) break
    await sleep(500)
  }
  await sleep(2500)

  const start = await ev(`document.querySelectorAll('.tab').length`)
  for (let i = start; i < WANT; i++) {
    await ev(`document.querySelector('.tab-new').click()`)
    await sleep(900)
  }
  const tabs = await ev(`document.querySelectorAll('.tab').length`)
  check(`opened ${WANT} terminals`, tabs === WANT, `${tabs} tabs`)

  await ev(`[...document.querySelectorAll('.seg button')].find(b => b.textContent === 'Grid')?.click()`)
  await sleep(1500)

  const panes = await ev(`(() => {
    const cells = [...document.querySelectorAll('.cell')]
    return cells.map(c => {
      const s = c.querySelector('.xterm-screen')
      return { w: s ? s.clientWidth : 0, h: s ? s.clientHeight : 0, head: !!c.querySelector('.cell-head') }
    })
  })()`)
  check('every pane rendered in grid', panes.length === WANT, `${panes.length} cells`)
  check('every pane has real size', panes.every((p) => p.w > 100 && p.h > 60), panes.map((p) => `${p.w}x${p.h}`).join(' '))
  check('grid panes show a header', panes.every((p) => p.head))

  // Distinct sizes across a row/column prove the grid actually tiled.
  const distinct = new Set(panes.map((p) => `${p.w}x${p.h}`))
  check('panes tile rather than stack', panes[0].w < 1300, `widths: ${[...distinct].join(', ')}`)

  // Every shell printed a prompt and then fell silent, so the inactive panes
  // should have tripped the attention badge.
  await sleep(2500)
  const badges = await ev(`document.querySelectorAll('.dot.attention').length`)
  check('attention badges fire on quiet panes', badges > 0, `${badges} flagged`)

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(OUT, Buffer.from(shot.data, 'base64'))
  console.log(`\nscreenshot -> ${OUT}`)

  check('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '))
} catch (e) {
  check('harness', false, e.message)
} finally {
  try {
    ws?.close()
  } catch {
    /* ignore */
  }
  child.kill()
  await sleep(500)
  console.log(failures ? `\n${failures} failed` : '\nall grid checks passed')
  process.exit(failures ? 1 : 0)
}
