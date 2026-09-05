/** Walks the UI and screenshots each view. node scripts/tour.mjs <outDir> */
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 9225
const DIR = process.argv[2] ?? '.'
mkdirSync(DIR, { recursive: true })

const exe = process.env.BUDDY_EXE
const bin = exe ?? 'node_modules/electron/dist/electron.exe'
const args = exe ? [`--remote-debugging-port=${PORT}`] : ['./out/main/index.js', `--remote-debugging-port=${PORT}`]
const child = spawn(bin, args, { stdio: 'ignore' })

let ws
let nextId = 1
const pending = new Map()

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
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(DIR, name + '.png'), Buffer.from(r.data, 'base64'))
  console.log('shot ' + name)
}
const clickTheme = (name) =>
  ev(`[...document.querySelectorAll('.theme-card')].find(c => c.textContent.startsWith(${JSON.stringify(name)}))?.click()`)

try {
  let page
  for (let i = 0; i < 60; i++) {
    try {
      const t = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      page = t.find((x) => x.type === 'page' && x.webSocketDebuggerUrl)
      if (page) break
    } catch {}
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
  await send('Page.enable')

  for (let i = 0; i < 40; i++) {
    if (await ev(`!!document.querySelector('.app') && !document.querySelector('.boot')`)) break
    await sleep(500)
  }
  await sleep(2500)

  // Several panes, so the critters have something to distinguish.
  const have = await ev(`document.querySelectorAll('.tab').length`)
  for (let i = have; i < 5; i++) {
    await ev(`document.querySelector('.tab-new').click()`)
    await sleep(800)
  }
  // Let the shells fall quiet so the buddy goes to 'alert'.
  await sleep(2600)
  await shot('1-tabs-critters')

  await ev(`[...document.querySelectorAll('.seg button')].find(b => b.textContent === 'Grid')?.click()`)
  await sleep(1400)
  await shot('2-grid-critters')

  // Settings, parked on the new section.
  await ev(`[...document.querySelectorAll('.topbar .icon-btn')].pop().click()`)
  await sleep(900)
  await ev(`document.querySelector('.themes')?.scrollIntoView({ block: 'center' })`)
  await sleep(500)
  await shot('3-look-and-feel')

  await clickTheme('Bubblegum')
  await sleep(900)
  await shot('4-bubblegum')

  await clickTheme('Paper')
  await sleep(900)
  await shot('5-paper')

  // Same theme with nothing overlaying it, to check the terminals too.
  await ev(`document.querySelector('.modal-head .icon-btn').click()`)
  await sleep(1200)
  await shot('5b-paper-grid')
  await ev(`[...document.querySelectorAll('.topbar .icon-btn')].pop().click()`)
  await sleep(800)

  await clickTheme('Grove')
  await sleep(700)
  await ev(`document.querySelector('.modal-head .icon-btn').click()`)
  await sleep(800)
  await shot('6-grove-grid')

  // Back to the default so the app is left as found.
  await ev(`[...document.querySelectorAll('.topbar .icon-btn')].pop().click()`)
  await sleep(800)
  await clickTheme('Midnight')
  await sleep(600)
  await ev(`document.querySelector('.modal-head .icon-btn').click()`)

  console.log('done')
} catch (e) {
  console.error('TOUR ERROR', e.message)
} finally {
  try { ws?.close() } catch {}
  child.kill()
  await sleep(400)
  process.exit(0)
}
