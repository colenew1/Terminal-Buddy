/** Real shell/keyboard/process-probe smoke test, also run against each Mac package. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
const require = createRequire(import.meta.url)
const root = realpathSync(mkdtempSync(join(tmpdir(), 'buddy-platform-')))
const profile = join(root, 'profile'), testHome = join(root, 'home')
mkdirSync(profile); mkdirSync(testHome)
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ walkthroughVersion: 1, trayIcon: false,
  defaultShellId: process.platform === 'win32' ? 'cmd' : 'default', desktopNotifications: false }))
const mock = join(root, 'codex.js')
writeFileSync(mock, `process.stdin.setRawMode(true); process.stdin.resume(); console.log('BUDDY_AGENT_READY'); process.stdin.on('data', b => console.log('INPUT:' + b.toString('hex')));`)
const env = { ...process.env, HOME: testHome, USERPROFILE: testHome }
delete env.ELECTRON_RUN_AS_NODE
delete env.SHELL // Exercise a GUI launch without a shell-provided environment.
const child = spawn(process.env.BUDDY_EXE ?? require('electron'), [
  ...(process.env.BUDDY_EXE ? [] : ['./out/main/index.js']), '--remote-debugging-port=9255', '--user-data-dir=' + profile
], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
let logs = '', ws, serial = 0, originalClipboard
child.stdout.on('data', b => { logs += b }); child.stderr.on('data', b => { logs += b })
child.on('error', error => { logs += error.message })
const pending = new Map()
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++serial
    const timer = setTimeout(() => { pending.delete(id); reject(Error('Timed out: ' + method)) }, 12000)
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }))
  })
}
async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result.value
}
async function until(expression) {
  for (let n = 0; n < 120; n++) { if (await ev(expression)) return; await sleep(100) }
  throw Error('Not ready: ' + expression)
}
async function key(code, key, modifiers, vk) {
  for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, code, key, modifiers, windowsVirtualKeyCode: vk })
}
try {
  let page
  for (let n = 0; n < 100 && !page; n++) {
    try { page = (await (await fetch('http://127.0.0.1:9255/json')).json()).find(p => p.type === 'page') } catch {}
    if (!page) await sleep(150)
  }
  assert.ok(page, 'Electron starts: ' + logs)
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
  ws.onmessage = event => {
    const r = JSON.parse(event.data), p = pending.get(r.id)
    if (!p) return
    pending.delete(r.id); clearTimeout(p.timer)
    r.error ? p.reject(Error(r.error.message)) : p.resolve(r.result)
  }
  await until("!!document.querySelector('[data-new-kind=\"shell\"]:not(:disabled)')")
  assert.equal(await ev("document.querySelectorAll('.cell').length"), 0)
  await ev("document.querySelector('[data-new-kind=\"shell\"]').click()")
  await until("!!document.querySelector('.xterm-helper-textarea')")
  assert.equal(await ev('window.buddy.platform'), process.platform)
  await ev("window.__platformOutput = ''; window.buddy.pty.onData((_id, data) => window.__platformOutput += data)")
  const sessions = await ev("Array.from(document.querySelectorAll('.tab[data-session-id]'), el => el.dataset.sessionId)")
  assert.equal(sessions.length, 1)
  const id = sessions[0]
  await ev(`window.buddy.pty.write(${JSON.stringify(id)}, ${JSON.stringify('echo BUDDY_SHELL_OK\r')})`)
  await until("window.__platformOutput.includes('BUDDY_SHELL_OK')")
  console.log('PASS real native PTY opens and round-trips a shell command')
  // Start an isolated fixture whose executable name is recognized by the probe.
  const command = `"${process.execPath}" "${mock}"\r`
  await ev(`window.buddy.pty.write(${JSON.stringify(id)}, ${JSON.stringify(command)})`)
  await until("window.__platformOutput.includes('BUDDY_AGENT_READY')")
  assert.equal((await ev('window.buddy.pty.probeAgents()'))[id], 'codex')
  console.log('PASS real process tree recognizes the mock Node agent')
  await ev("document.querySelector('.xterm-helper-textarea').focus()")
  await key('KeyC', 'c', 2, 67)
  await until("window.__platformOutput.includes('INPUT:03')")
  originalClipboard = await ev('window.buddy.clipboard.read()')
  await ev("window.buddy.clipboard.write('BUDDY_PASTE')")
  await key('KeyV', 'v', process.platform === 'darwin' ? 4 : 2, 86)
  await until("window.__platformOutput.includes('INPUT:42554444595f5041535445')")
  console.log('PASS Control+C interrupts and platform clipboard shortcut pastes into the terminal')
  await ev("document.querySelector('.topbar button[title^=Settings]').click()")
  await until("!!document.querySelector('.settings')")
  if (process.platform === 'darwin') {
    assert.equal(await ev("document.querySelector('.settings').innerText.includes('Windows integration')"), false)
    assert.equal(await ev("getComputedStyle(document.querySelector('.topbar')).paddingLeft"), '88px')
    assert.equal(await ev("document.querySelector('.settings').innerText.includes('Cmd+V')"), true)
  }
  await ev("document.querySelector('.modal-head button').click()")
  const screenshot = await send('Page.captureScreenshot', { format: 'png' })
  const screenshotPath = join(tmpdir(), 'buddy-platform-' + process.platform + '.png')
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'))
  console.log('PASS platform settings and window layout; screenshot: ' + screenshotPath)
} catch (error) {
  console.error(error.stack, logs.slice(-5000)); process.exitCode = 1
} finally {
  if (originalClipboard !== undefined) {
    try { await ev(`window.buddy.clipboard.write(${JSON.stringify(originalClipboard)})`) } catch {}
  }
  ws?.close()
  for (const p of pending.values()) clearTimeout(p.timer)
  child.kill(); await sleep(1000)
  // Only remove the exact temporary workspace created by this harness.
  const resolved = realpathSync(root)
  assert.ok(resolved.startsWith(realpathSync(tmpdir()) + sep) && resolve(root) === resolved)
  rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
}
