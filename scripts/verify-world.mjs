/** Drives the production renderer through World mode without touching the real app profile. */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 9237
const WANT = 5
const OUT = process.argv[2] ?? join(tmpdir(), 'terminal-buddy-world.png')
const profile = mkdtempSync(join(tmpdir(), 'terminal-buddy-world-'))
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ desktopNotifications: false, clickToPosition: false }))
const electron = process.env.BUDDY_EXE ?? (process.platform === 'win32'
  ? 'node_modules/electron/dist/electron.exe'
  : 'node_modules/.bin/electron')
const child = spawn(electron, [
  ...(process.env.BUDDY_EXE ? [] : ['./out/main/index.js']),
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`
], { stdio: 'ignore' })

let exitedEarly = null
child.on('exit', (code) => { exitedEarly = code })

let ws
let nextId = 1
const pending = new Map()
const errors = []
let failures = 0

const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function send(method, params = {}) {
  const id = nextId++
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    setTimeout(() => pending.delete(id) && reject(new Error(`${method} timeout`)), 40000)
  })
}

async function newTerminal(selector = '.tab-new') {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
  for (let i=0;i<60;i++) {
    if (await evaluate(`!!document.querySelector('[data-new-kind="shell"]:not(:disabled)')`)) break
    await sleep(50)
  }
  await evaluate(`document.querySelector('[data-new-kind="shell"]').click()`)
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'evaluation failed')
  return result.result.value
}

async function typeKeys(text) {
  for (const key of text) {
    const keyCode = key.toUpperCase().charCodeAt(0)
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: `Key${key.toUpperCase()}`, text: key, windowsVirtualKeyCode: keyCode })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: `Key${key.toUpperCase()}`, windowsVirtualKeyCode: keyCode })
  }
}

async function checkTyped(label, text) {
  const id = await evaluate(`document.querySelector('.cell.is-active').dataset.sessionId`)
  await evaluate(`window.__output={}`)
  await typeKeys(text)
  await sleep(500)
  check(label, await evaluate(`document.activeElement?.classList.contains('xterm-helper-textarea') && window.__output[${JSON.stringify(id)}]?.includes(${JSON.stringify(text)}) === true`))
}

async function click(selector) {
  const p = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r ? {x:r.x+r.width/2,y:r.y+r.height/2} : null })()`)
  if (!p) throw new Error(`Missing click target: ${selector}`)
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', {type, ...p, button:'left', clickCount:1})
}

try {
  let page
  for (let i = 0; i < 60; i++) {
    if (exitedEarly !== null) throw new Error(`app exited before attach (${exitedEarly})`)
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) break
    } catch { /* still starting */ }
    await sleep(500)
  }
  if (!page) throw new Error('CDP target never appeared')

  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error('CDP socket failed'))
  })
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const promise = pending.get(message.id)
      pending.delete(message.id)
      message.error ? promise.reject(new Error(message.error.message)) : promise.resolve(message.result)
    } else if (message.method === 'Runtime.exceptionThrown') {
      errors.push(message.params.exceptionDetails.exception?.description ?? 'exception')
    } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      errors.push(message.params.args.map((a) => a.value ?? a.description).join(' '))
    }
  }
  await send('Runtime.enable')

  for (let i = 0; i < 40; i++) {
    if (await evaluate(`!!document.querySelector('.app') && !document.querySelector('.boot')`)) break
    await sleep(500)
  }
  await sleep(1200)

  check('startup focuses the live terminal', await evaluate(`document.activeElement?.classList.contains('xterm-helper-textarea') === true`))
  await evaluate(`window.__output={}; window.buddy.pty.onData((id,data)=>{window.__output[id]=(window.__output[id]??'')+data})`)
  check('there is no secondary input box', await evaluate(`!document.querySelector('.composer-input, .terminal-entry')`))
  await checkTyped('ordinary keys reach the terminal on startup', 'hello')

  for (let i = 1; i < WANT; i++) {
    await newTerminal()
    await sleep(500)
  }
  await evaluate(`[...document.querySelectorAll('.seg button')].find(b => b.textContent === 'World')?.click()`)
  await sleep(1200)

  const state = await evaluate(`(() => {
    const world = document.querySelector('.world')
    const orbs = [...document.querySelectorAll('.orb')]
    const hidden = document.querySelector('.area.is-behind')
    return {
      world: !!world,
      orbs: orbs.length,
      sizes: orbs.map(o => [o.getBoundingClientRect().width, o.getBoundingClientRect().height]),
      positions: orbs.map(o => [Math.round(o.getBoundingClientRect().x), Math.round(o.getBoundingClientRect().y)]),
      inert: hidden?.inert === true,
      tabbar: !!document.querySelector('.tabbar'),
      hud: document.querySelector('.world-kicker')?.textContent ?? '',
      lock: [...document.querySelectorAll('.topbar .icon-btn')].some(b => /🔒|🔓/.test(b.textContent ?? ''))
    }
  })()`)
  check('World mode renders', state.world && state.hud === 'Your terminal world')
  check('one inhabitant per terminal', state.orbs === WANT, `${state.orbs} orbs`)
  check('inhabitants have real geometry', state.sizes.every(([w, h]) => w === 116 && h === 116), JSON.stringify(state.sizes))
  check('inhabitants are spatially distinct', new Set(state.positions.map(String)).size === WANT, JSON.stringify(state.positions))
  check('hidden terminals are inert', state.inert)
  check('pane-only controls leave World mode', !state.tabbar && !state.lock)

  const first = await evaluate(`(() => {
    const r = document.querySelector('.orb').getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })()`)
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', {
      type, x: first.x, y: first.y, button: 'left', clickCount: 1, pointerType: 'mouse'
    })
  }
  await sleep(500)
  check('World opens the existing live terminal in Tabs', await evaluate(`!document.querySelector('.world') && !document.querySelector('.agent') && !!document.querySelector('.cell.is-active .xterm')`))
  await checkTyped('World returns focus to the existing terminal', 'world')
  await click('.cell.is-active .xterm-screen')
  await checkTyped('clicking the terminal retains keyboard input', 'typing')
  await evaluate(`[...document.querySelectorAll('.seg button')].find(b => b.textContent === 'World')?.click()`)
  await sleep(250)

  const before = await evaluate(`(() => {
    const r = document.querySelector('.orb').getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })()`)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: before.x, y: before.y, button: 'left', clickCount: 1, pointerType: 'mouse' })
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: before.x + 80, y: before.y + 45, button: 'left', buttons: 1, pointerType: 'mouse' })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: before.x + 80, y: before.y + 45, button: 'left', clickCount: 1, pointerType: 'mouse' })
  await sleep(500)
  const after = await evaluate(`(() => {
    const r = document.querySelector('.orb').getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })()`)
  check('inhabitants can be rearranged', Math.abs(after.x - before.x) > 50 && Math.abs(after.y - before.y) > 25, `${before.x},${before.y} → ${after.x},${after.y}`)

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(OUT, Buffer.from(shot.data, 'base64'))

  await evaluate(`[...document.querySelectorAll('.seg button')].find(b => b.textContent === 'Grid')?.click()`)
  await sleep(400)
  await click('.cell:not(.is-active) .xterm-screen')
  await checkTyped('clicking a different grid terminal routes keys to that pane', 'grid')
  await click('.cell.is-active .cell-head button[title="Close terminal"]')
  check('close confirmation stays inside the app', await evaluate(`!!document.querySelector('.close-session-dialog[open]')`))
  await click('.close-session-dialog .btn:not(.primary)')
  await checkTyped('typing still works after cancelling close', 'cancel')
  await click('.cell.is-active .cell-head button[title="Close terminal"]')
  await click('.close-session-dialog .primary')
  await sleep(400)
  await checkTyped('typing still works after confirming close', 'after')

  await evaluate(`document.querySelector('.cell.is-active .xterm-helper-textarea').focus()`)
  await sleep(300)
  check('raw terminal takes focus when revealed', await evaluate(`document.activeElement?.classList.contains('xterm-helper-textarea') === true`))
  await evaluate(`window.__keyOutput=''; window.__offKeys=window.buddy.pty.onData((id,data)=>{window.__keyOutput+=data})`)
  await typeKeys('rawkeys')
  await sleep(500)
  check('raw terminal receives ordinary keys', await evaluate(`window.__keyOutput.includes('rawkeys')`))
  await evaluate(`window.__offKeys()`)
  check('no renderer errors', errors.length === 0, errors.slice(0, 2).join(' | '))
  console.log(`screenshot -> ${OUT}`)
} catch (error) {
  check('harness', false, error.message)
} finally {
  try { ws?.close() } catch { /* ignore */ }
  child.kill()
  await sleep(500)
  rmSync(profile, { recursive: true, force: true })
  console.log(failures ? `\n${failures} failed` : '\nall world checks passed')
  process.exit(failures ? 1 : 0)
}
