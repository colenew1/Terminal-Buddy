/** Real independent workspaces, IPC isolation, pop-outs, close, and recovery. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs'
import { join, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'
const require = createRequire(import.meta.url)
const root = realpathSync(mkdtempSync(join(tmpdir(), 'buddy-windows-')))
const profile = join(root, 'profile'), testHome = join(root, 'home')
mkdirSync(profile); mkdirSync(testHome)
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ walkthroughVersion: 1, desktopNotifications: false,
  trayIcon: false, closeToTray: false, defaultShellId: process.platform === 'win32' ? 'cmd' : 'default' }))
const mock = join(root, 'codex.js')
writeFileSync(mock, `process.stdin.setRawMode(true); process.stdin.resume(); console.log('MOCK_READY:' + process.pid); process.stdin.on('data', b => console.log('INPUT:' + b.toString('hex')));`)
let child, logs = '', connections = []
const PORT = 9257
const pages = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).filter(page => page.type === 'page')
const pass = name => console.log('PASS ' + name)
async function until(fn, name = 'condition') {
  for (let i = 0; i < 120; i++) { if (await fn()) return; await sleep(100) }
  throw Error('Timed out: ' + name)
}
async function connect(find) {
  let page
  await until(async () => { try { page = (await pages()).find(find); return !!page } catch { return false } }, 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
  const pending = new Map(); let serial = 0
  ws.onmessage = event => {
    const r = JSON.parse(event.data), p = pending.get(r.id)
    if (!p) return
    pending.delete(r.id); clearTimeout(p.timer)
    r.error ? p.reject(Error(r.error.message)) : p.resolve(r.result)
  }
  ws.onclose = () => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error('Window closed')) }; pending.clear() }
  const client = {
    close: () => ws.close(),
    send: (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++serial
      const timer = setTimeout(() => { pending.delete(id); reject(Error('Timed out: ' + method)) }, 10000)
      pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }))
    }),
    async ev(expression) {
      const r = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
      return r.result.value
    }
  }
  connections.push(client)
  return client
}
const workspacePage = id => page => new URL(page.url).searchParams.get('workspace') === id
const ready = client => until(() => client.ev("!!document.querySelector('.xterm-helper-textarea')"), 'terminal ready')
const sessionId = client => client.ev("document.querySelector('.tab[data-session-id]').dataset.sessionId")
async function boot() {
  const env = { ...process.env, HOME: testHome, USERPROFILE: testHome }
  delete env.ELECTRON_RUN_AS_NODE
  child = spawn(process.env.BUDDY_EXE ?? require('electron'), [
    ...(process.env.BUDDY_EXE ? [] : ['./out/main/index.js']), `--remote-debugging-port=${PORT}`, '--user-data-dir=' + profile
  ], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', b => { logs += b }); child.stderr.on('data', b => { logs += b })
  child.on('error', error => { logs += error.message })
}
async function quit(client) {
  void client.send('Browser.close').catch(() => {})
  await until(() => child.exitCode !== null || child.signalCode !== null, 'whole app quits')
  for (const client of connections) client.close()
  connections = []
  await sleep(400)
}
async function rename(client, title) {
  await client.ev('window.buddy.app.windows().then(windows=>window.buddy.app.focusWindow(windows.find(w=>w.current).id))')
  await client.ev("document.querySelector('.tab').dispatchEvent(new MouseEvent('dblclick', {bubbles:true}))")
  await client.ev("document.querySelector('.tab-rename').select()")
  await client.send('Input.insertText', { text: title })
  for (const type of ['keyDown', 'keyUp']) await client.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
}
async function startMock(client, id) {
  await client.ev("window.__output='';window.buddy.pty.onData((_id,data)=>window.__output+=data)")
  const command = `"${process.execPath}" "${mock}"\r`
  await client.ev(`window.buddy.pty.write(${JSON.stringify(id)}, ${JSON.stringify(command)})`)
  await until(() => client.ev("window.__output.includes('MOCK_READY:')"), 'mock starts')
  return client.ev("Number(/MOCK_READY:(\\d+)/.exec(window.__output)[1])")
}
async function write(client, id, text) {
  await client.ev(`window.buddy.pty.write(${JSON.stringify(id)}, ${JSON.stringify(text)})`)
}
try {
  await boot()
  let first = await connect(workspacePage('primary'))
  await ready(first)
  await first.ev("document.querySelector('[data-new-window]').click()")
  await until(async () => (await first.ev('window.buddy.app.windows()')).length === 2, 'second window')
  const secondId = (await first.ev('window.buddy.app.windows()')).find(w => !w.current).id
  let second = await connect(workspacePage(secondId))
  await ready(second)
  const a = await sessionId(first), b = await sessionId(second)
  assert.notEqual(a, b)
  assert.equal(await first.ev("document.querySelectorAll('.tab[data-session-id]').length"), 1)
  assert.equal(await second.ev("document.querySelectorAll('.tab[data-session-id]').length"), 1)
  pass('New Window button creates a separate full workspace with its own terminal')
  await rename(first, 'Workspace Alpha'); await rename(second, 'Workspace Beta')
  await first.ev("document.querySelector('.topbar .seg button:last-child').click()")
  await sleep(500)
  assert.equal((await first.ev('window.buddy.workspace.get()')).layout, 'grid')
  assert.equal((await second.ev('window.buddy.workspace.get()')).layout, 'tabs')
  assert.equal((await first.ev('window.buddy.workspace.get()')).sessions[0].title, 'Workspace Alpha')
  assert.equal((await second.ev('window.buddy.workspace.get()')).sessions[0].title, 'Workspace Beta')
  pass('names and layouts save independently without overwriting another window')
  const apid = await startMock(first, a), bpid = await startMock(second, b)
  assert.notEqual(apid, bpid)
  assert.deepEqual(Object.keys(await first.ev('window.buddy.pty.probeAgents()')), [a])
  assert.deepEqual(Object.keys(await second.ev('window.buddy.pty.probeAgents()')), [b])
  await write(first, b, 'FORBIDDEN')
  await first.ev(`window.buddy.pty.write(${JSON.stringify(b)}, 'FORBIDDEN', true);window.buddy.pty.kill(${JSON.stringify(b)});window.buddy.pty.rename(${JSON.stringify(b)},'FORBIDDEN');window.buddy.feed.detach(${JSON.stringify(b)})`)
  assert.match(await first.ev(`window.buddy.popout.open(${JSON.stringify(b)}).then(()=>'UNEXPECTED',e=>e.message)`), /workspace/)
  assert.match(await first.ev(`window.buddy.pty.submit(${JSON.stringify(b)},'FORBIDDEN').then(()=>'UNEXPECTED',e=>e.message)`), /window/)
  await write(second, b, 'B_ONLY')
  await until(() => second.ev("window.__output.includes('INPUT:425f4f4e4c59')"), 'second workspace accepts input')
  assert.equal(await first.ev("window.__output.includes('INPUT:425f4f4e4c59')"), false)
  assert.equal(await second.ev("window.__output.includes('464f5242494444454e')"), false)
  pass('terminal input, broadcast, kill, rename, process probes and output respect window ownership')
  await second.ev("window.buddy.settings.get().then(s=>window.buddy.settings.set({...s,fontSize:17}))")
  await until(() => first.ev("window.buddy.settings.get().then(s=>s.fontSize===17)"), 'shared settings')
  await first.ev("document.querySelector('[data-window-menu]').click()")
  assert.equal(await first.ev("document.querySelectorAll('[data-window-target]').length"), 2)
  await first.ev("document.querySelector('[data-window-menu]').click()")
  pass('window switcher lists both workspaces and preferences are shared')
  await first.ev(`window.buddy.popout.open(${JSON.stringify(a)})`)
  const popA = await connect(page => new URL(page.url).searchParams.get('popout') === a)
  await ready(popA)
  assert.equal(await first.ev("!!document.querySelector('.detached-placeholder')"), true)
  assert.equal(await second.ev("!!document.querySelector('.detached-placeholder')"), false)
  assert.match(await popA.ev('window.buddy.app.newWindow().then(()=>"UNEXPECTED",e=>e.message)'), /workspace/)
  await first.ev(`window.buddy.popout.dock(${JSON.stringify(b)})`)
  await popA.ev("document.querySelector('[data-dock-back]').click()").catch(() => {})
  await until(() => first.ev("!document.querySelector('.detached-placeholder')"), 'pop-out docks to Alpha')
  await second.ev(`window.buddy.popout.open(${JSON.stringify(b)})`)
  const popB = await connect(page => new URL(page.url).searchParams.get('popout') === b)
  await ready(popB)
  await first.ev(`window.buddy.popout.dock(${JSON.stringify(b)})`)
  await sleep(100)
  assert.equal(await second.ev("!!document.querySelector('.detached-placeholder')"), true)
  await popB.ev("document.querySelector('[data-dock-back]').click()").catch(() => {})
  await until(() => second.ev("!document.querySelector('.detached-placeholder')"), 'pop-out docks to Beta')
  pass('pop-outs belong to their workspace and cannot be docked or controlled by another')
  // Quit with both windows open, then confirm both recover their own snapshots.
  await quit(first)
  assert.deepEqual(JSON.parse(readFileSync(join(profile, 'windows.json'), 'utf8')), ['primary', secondId])
  await boot()
  first = await connect(workspacePage('primary')); second = await connect(workspacePage(secondId))
  for (const client of [first, second]) {
    await until(() => client.ev("!!document.querySelector('[data-restore-all]')"), 'window recovery chooser')
    await client.ev("document.querySelector('[data-restore-all]').click()")
    await ready(client)
  }
  assert.equal(await first.ev("document.querySelector('.tab-title').textContent"), 'Workspace Alpha')
  assert.equal(await second.ev("document.querySelector('.tab-title').textContent"), 'Workspace Beta')
  pass('quitting restores both workspace windows with separate names and session recovery')
  const newA = await sessionId(first), newB = await sessionId(second)
  await startMock(first, newA); await startMock(second, newB)
  await first.ev(`window.buddy.popout.open(${JSON.stringify(newA)})`)
  const closingPop = await connect(page => new URL(page.url).searchParams.get('popout') === newA)
  await ready(closingPop)
  await first.ev('window.close()').catch(() => {})
  await until(async () => (await pages()).length === 1, 'first workspace and its pop-out close')
  await write(second, newB, 'STILL_RUNNING')
  await until(() => second.ev("window.__output.includes('INPUT:5354494c4c5f52554e4e494e47')"), 'second process stays live')
  assert.deepEqual(JSON.parse(readFileSync(join(profile, 'windows.json'), 'utf8')), [secondId])
  pass('closing one workspace closes its pop-outs while the other process stays running')
  await second.ev("document.querySelector('.xterm-helper-textarea').focus()")
  for (const type of ['keyDown', 'keyUp']) await second.send('Input.dispatchKeyEvent', {
    type, code: 'KeyN', key: 'N', windowsVirtualKeyCode: 78, modifiers: process.platform === 'darwin' ? 12 : 10
  })
  await until(async () => (await second.ev('window.buddy.app.windows()')).length === 2, 'New Window shortcut')
  pass('Ctrl/Cmd+Shift+N opens another full workspace')
  const screenshot = await second.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(tmpdir(), 'buddy-windows.png'), Buffer.from(screenshot.data, 'base64'))
  await quit(second)
} catch (error) {
  console.error(error.stack, logs.slice(-7000)); process.exitCode = 1
} finally {
  for (const client of connections) client.close()
  if (child && child.exitCode === null && child.signalCode === null) child.kill()
  await sleep(1000)
  const target = realpathSync(root)
  assert.ok(target === root && target.startsWith(realpathSync(tmpdir()) + sep))
  rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
}
