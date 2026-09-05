/** Opens several terminals, switches to grid, and checks every pane is real. */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'

import { join } from 'node:path'

const PORT = 9224
const OUT = process.argv[2] ?? join(tmpdir(), 'terminal-buddy-grid.png')
const WANT = 6
const profile = mkdtempSync(join(tmpdir(), 'terminal-buddy-grid-'))
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ walkthroughVersion: 1, desktopNotifications: false }))

const exe = process.env.BUDDY_EXE
const bin = exe ?? (process.platform === 'win32' ? 'node_modules/electron/dist/electron.exe' : 'node_modules/.bin/electron')
const args = exe
  ? [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`]
  : ['./out/main/index.js', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`]
const child = spawn(bin, args, { stdio: 'ignore' })

let exitedEarly = null
child.on('exit', (code) => { exitedEarly = code })

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

try {
  let page
  for (let i = 0; i < 60; i++) {
    if (exitedEarly !== null) {
      throw new Error(
        'the app quit before the harness attached (exit ' + exitedEarly + '). ' +
        'Another Terminal Buddy is probably already running — it holds the single-instance lock. Close it and retry.'
      )
    }
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
  await send('Input.enable').catch(() => undefined)

  for (let i = 0; i < 40; i++) {
    if (await ev(`!!document.querySelector('.app') && !document.querySelector('.boot')`)) break
    await sleep(500)
  }
  await sleep(2500)

  const start = await ev(`document.querySelectorAll('.tab').length`)
  for (let i = start; i < WANT; i++) {
    await newTerminal()
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

  // Six tabs in the same folder are all called the same thing; the critter is
  // the only thing telling them apart, so it must be unique per pane.
  const critters = await ev(`[...document.querySelectorAll('.tab-critter')].map(e => e.textContent)`)
  check('every pane has a critter', critters.length === WANT, critters.join(' '))
  check('critters are unique', new Set(critters).size === critters.length)

  const hues = await ev(`[...document.querySelectorAll('.tab')].map(t => t.style.getPropertyValue('--critter'))`)
  check('critters carry distinct hues', new Set(hues).size === hues.length && hues.every(Boolean))

  // A shell prompt going quiet is normal. It must not masquerade as an agent
  // asking for the user's attention.
  await sleep(2500)
  const badges = await ev(`document.querySelectorAll('.dot.attention').length`)
  check('plain shell prompts do not ask for attention', badges === 0, `${badges} flagged`)

  const mood = await ev(`document.querySelector('.buddy')?.className ?? ''`)
  check('buddy stays calm for plain shells', !mood.includes('buddy-alert'), mood)

  // Lock/unlock and drag-to-swap.
  const before = await ev(`[...document.querySelectorAll('.tab-critter')].map(e => e.textContent)`)
  await ev(`[...document.querySelectorAll('.topbar .icon-btn')].find(b => b.textContent === '🔒')?.click()`)
  await sleep(600)
  const shields = await ev(`document.querySelectorAll('.cell-shield').length`)
  check('unlocking puts a drag shield over every pane', shields === WANT, `${shields} shields`)

  const boxes = await ev(`[...document.querySelectorAll('.cell')].slice(0, 2).map(c => {
    const r = c.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })`)
  if (boxes.length === 2) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: boxes[0].x, y: boxes[0].y, button: 'left', clickCount: 1, pointerType: 'mouse' })
    await sleep(150)
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: boxes[1].x, y: boxes[1].y, button: 'left', buttons: 1, pointerType: 'mouse' })
    await sleep(150)
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: boxes[1].x, y: boxes[1].y, button: 'left', clickCount: 1, pointerType: 'mouse' })
    await sleep(600)
  }
  const after = await ev(`[...document.querySelectorAll('.tab-critter')].map(e => e.textContent)`)
  const swapped = after[0] === before[1] && after[1] === before[0]
  check('dragging one pane onto another swaps them', swapped, `${before.slice(0,2).join(' ')} -> ${after.slice(0,2).join(' ')}`)

  await ev(`[...document.querySelectorAll('.topbar .icon-btn')].find(b => b.textContent === '🔓')?.click()`)
  await sleep(500)
  const relocked = await ev(`document.querySelectorAll('.cell-shield').length`)
  check('locking removes the shields', relocked === 0, `${relocked} shields`)

  // Agent probe: one entry per live session, even when nothing is running.
  const probe = await ev(`window.buddy.pty.probeAgents().then(m => ({ keys: Object.keys(m).length, values: [...new Set(Object.values(m))] }))`)
  check('agent probe answers for every pane', probe.keys === WANT, `${probe.keys} entries, values ${JSON.stringify(probe.values)}`)

  // Dragging a skill from the catalog should light up only the panes that can
  // take it. Nothing is running here, so every pane is a legal target.
  await ev(`document.querySelectorAll('.topbar .icon-btn')[0].click()`)
  await sleep(1500)
  await ev(`[...document.querySelectorAll('.sidebar-head .seg button')].find(b => b.textContent.startsWith('Skills'))?.click()`)
  await sleep(900)

  // Dispatch and assert in separate turns: React batches state updates, so the
  // DOM does not reflect them until after the current task.
  const dispatched = await ev(`(() => {
    const row = document.querySelector('.sidebar-body .row.is-draggable')
    if (!row) return 'no draggable row'
    window.__dt = new DataTransfer()
    row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: window.__dt }))
    return document.body.classList.contains('is-dragging-item') ? 'started' : 'dragstart did not fire'
  })()`)
  check('sidebar row starts a drag', dispatched === 'started', String(dispatched))
  await sleep(200)

  await ev(`(() => {
    const cell = document.querySelector('.cell')
    cell.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: window.__dt }))
    cell.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: window.__dt }))
    return true
  })()`)
  await sleep(400)

  const dragState = await ev(`({
    areaFlagged: !!document.querySelector('.area.is-item-drag'),
    canDrop: document.querySelectorAll('.cell.can-drop').length,
    cannotDrop: document.querySelectorAll('.cell.cannot-drop').length,
    target: !!document.querySelector('.cell.is-drop-target'),
    hint: document.querySelector('.drop-hint')?.textContent ?? ''
  })`)
  check('dragging a skill marks the grid', dragState.areaFlagged === true, JSON.stringify(dragState))
  check('idle panes accept the skill', dragState.canDrop === WANT && dragState.cannotDrop === 0,
    `${dragState.canDrop} ok / ${dragState.cannotDrop} refused`)
  check('hovered pane explains what will happen', /start|type/i.test(dragState.hint), dragState.hint)

  await ev(`(() => { window.dispatchEvent(new Event('dragend')); return true })()`)
  await sleep(300)
  await ev(`document.querySelectorAll('.topbar .icon-btn')[0].click()`)
  await sleep(700)

  // A short, real mouse drag must resize neighboring columns immediately.
  await ev(`[...document.querySelectorAll('.topbar .icon-btn')].find(b => b.textContent === '🔒')?.click()`)
  await sleep(400)
  const handle = await ev(`(() => {
    const h = document.querySelector('.grid-divider.is-vertical span')
    const r = h.getBoundingClientRect()
    return {x:r.x+r.width/2,y:r.y+r.height/2,w:document.querySelector('.cell').getBoundingClientRect().width}
  })()`)
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:handle.x,y:handle.y,button:'left',clickCount:1})
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:handle.x+24,y:handle.y,button:'left',buttons:1})
  await sleep(200)
  const width = await ev(`document.querySelector('.cell').getBoundingClientRect().width`)
  check('a short divider drag resizes continuously before release',Math.abs(width-handle.w-24)<2,`24px drag -> ${Math.round(width-handle.w)}px resize`)
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:handle.x+24,y:handle.y,button:'left',clickCount:1})
  await sleep(500)

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
  rmSync(profile, { recursive: true, force: true })
  console.log(failures ? `\n${failures} failed` : '\nall grid checks passed')
  process.exit(failures ? 1 : 0)
}
