/** Real launcher favorites, fresh workspace presets, retry actions, and persistence. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmdirSync, rmSync, realpathSync, chmodSync } from 'node:fs'
import { join, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'
const require = createRequire(import.meta.url)
const root = realpathSync(mkdtempSync(join(tmpdir(), 'buddy-launcher-')))
const profile = join(root, 'profile'), testHome = join(root, 'home')
mkdirSync(profile); mkdirSync(testHome)
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ walkthroughVersion: 1, desktopNotifications: false,
  trayIcon: false, closeToTray: false, defaultShellId: process.platform === 'win32' ? 'cmd' : 'default' }))
const mock = join(root, 'codex.js')
writeFileSync(mock, `process.stdin.setRawMode(true); process.stdin.resume(); console.log('MOCK_READY:' + process.pid); process.stdin.on('data', b => console.log('INPUT:' + b.toString('hex')));`)
let child, logs = '', connections = []
const PORT = 9262
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
async function boot() {
  const env = { ...process.env, HOME: testHome, USERPROFILE: testHome }
  delete env.ELECTRON_RUN_AS_NODE
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'PATH'
  env[pathKey] = bin + (process.platform === 'win32' ? ';' : ':') + (env[pathKey] ?? '')
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
const bin = join(root, 'bin'), project = join(root, 'project')
mkdirSync(bin); mkdirSync(project)
for (const agent of ['claude', 'codex']) {
  const file = join(bin, process.platform === 'win32' ? agent + '.cmd' : agent)
  writeFileSync(file, process.platform === 'win32'
    ? `@echo FRESH_${agent}_ARGS:%*\r\n@"${process.execPath}" "${mock}" %*\r\n`
    : `#!/bin/sh\necho FRESH_${agent}_ARGS:"$@"\nexec "${process.execPath}" "${mock}" "$@"\n`)
  if (process.platform !== 'win32') chmodSync(file, 0o755)
}
const chatId = '11111111-1111-4111-8111-111111111111'
const historyDir = join(testHome, '.claude', 'projects', project.replace(/[^A-Za-z0-9]/g, '-'))
mkdirSync(historyDir, { recursive: true })
writeFileSync(join(historyDir, chatId + '.jsonl'), [
  { type: 'ai-title', aiTitle: 'Pinned fixture' },
  { type: 'user', timestamp: '2026-01-01T12:00:00Z', cwd: project, sessionId: chatId, message: { content: 'Test pinned history' } }
].map(JSON.stringify).join('\n') + '\n')
const settingsPath = join(profile, 'settings.json')
writeFileSync(settingsPath, JSON.stringify({ ...JSON.parse(readFileSync(settingsPath, 'utf8')), claudeResumeCommand: 'echo {id}' }))
const click = (client, selector) => client.ev(`document.querySelector(${JSON.stringify(selector)}).click()`)
async function chooser(client) {
  await click(client, '.tab-new')
  await until(() => client.ev(`!!document.querySelector('[data-new-kind="shell"]:not(:disabled)')`), 'chooser')
}
try {
  await boot()
  let client = await connect(workspacePage('primary'))
  await until(() => client.ev("!!document.querySelector('[data-new-resume]')"), 'fresh chooser')
  await click(client, '[data-new-resume]')
  await until(() => client.ev(`!!document.querySelector('[data-pin-chat="${chatId}"]')`), 'saved chat indexed')
  await click(client, `[data-pin-chat="${chatId}"]`)
  await until(async () => (await client.ev('window.buddy.library.get()')).pinnedChats.length === 1, 'pin saved')
  await chooser(client)
  await click(client, '.launcher-extras summary')
  assert.equal(await client.ev(`document.querySelectorAll('[data-pinned-chat="${chatId}"]').length`), 1)
  await click(client, `[data-pinned-chat="${chatId}"]`)
  await until(() => client.ev("!!document.querySelector('.xterm-helper-textarea, .new-session-error, .launch-recovery')"), 'pin result')
  assert.equal(await client.ev("document.querySelector('.new-session-error, .launch-recovery')?.textContent ?? null"), null)
  await ready(client)
  await until(async () => (await client.ev('window.buddy.workspace.get()')).sessions.length === 1, 'pinned recovery saved')
  assert.equal((await client.ev('window.buddy.workspace.get()')).sessions[0].resume.id, chatId)
  pass('sidebar pins appear in the chooser and reopen the exact saved conversation')

  await client.ev("document.querySelector('.topbar .seg button:last-child').click()")
  await click(client, '[data-window-menu]'); await click(client, '[data-workspace-presets]')
  await until(() => client.ev("!!document.querySelector('[data-preset-name]')"), 'preset dialog')
  await client.ev("document.querySelector('[data-preset-name]').focus()")
  await client.send('Input.insertText', { text: 'Website project' })
  await click(client, '[data-preset-save]')
  await until(async () => (await client.ev('window.buddy.library.get()')).presets.length === 1, 'preset saved')
  const preset = (await client.ev('window.buddy.library.get()')).presets[0]
  assert.equal(preset.name, 'Website project'); assert.equal(preset.layout, 'grid')
  assert.equal(preset.sessions[0].cwd, project); assert.equal(preset.sessions[0].agent, 'claude')
  assert.equal('resume' in preset.sessions[0], false)
  assert.equal('initialCommand' in preset.sessions[0], false)
  const invalid = { name: 'Missing folder', layout: 'tabs', sessions: [{ cwd: join(root, 'not-created'), shellId: preset.sessions[0].shellId, title: 'Missing', initialCommand: 'echo UNEXPECTED' }] }
  const invalidLibrary = await client.ev(`window.buddy.library.savePreset(${JSON.stringify(invalid)})`)
  const invalidId = invalidLibrary.presets.at(-1).id
  assert.equal('initialCommand' in invalidLibrary.presets.at(-1).sessions[0], false)
  await until(() => client.ev(`!!document.querySelector('[data-preset-open="${invalidId}"]')`), 'invalid preset row')
  await click(client, `[data-preset-open="${invalidId}"]`)
  await until(() => client.ev("!!document.querySelector('.new-session-error')"), 'missing preset folder error')
  assert.equal(await client.ev("document.querySelectorAll('.tab[data-session-id]').length"), 1)
  await client.ev(`window.buddy.library.deletePreset(${JSON.stringify(invalidId)})`)
  pass('presets strip arbitrary commands and reject missing folders before launching anything')
  await client.ev("window.__output='';window.buddy.pty.onData((_id,data)=>window.__output+=data)")
  await click(client, `[data-preset-open="${preset.id}"]`)
  await until(() => client.ev("document.querySelectorAll('.tab[data-session-id]').length===2 && !document.querySelector('[data-preset-name]')"), 'preset opens')
  await until(() => client.ev("window.__output.includes('FRESH_claude_ARGS:')"), 'fresh assistant command')
  const reopened = (await client.ev('window.buddy.workspace.get()')).sessions[1]
  assert.equal(reopened.cwd, project)
  assert.notEqual(reopened.resume.id, chatId)
  assert.equal(await client.ev("window.__output.includes('--resume')"), false)
  pass('presets preserve folders, assistants and layout but start fresh conversations')

  // A recent folder can disappear between runs; expose a recoverable launch error.
  const vanished = join(root, 'vanished')
  mkdirSync(vanished)
  await client.ev(`window.buddy.library.rememberFolder(${JSON.stringify(vanished)})`)
  // The explicit target is a directory created by this test inside its verified temp root.
  assert.ok(realpathSync(vanished).startsWith(root + sep))
  rmdirSync(vanished)
  await chooser(client); await click(client, '.launcher-extras summary')
  // Dataset comparison avoids CSS escaping Windows path backslashes.
  await client.ev(`Array.from(document.querySelectorAll('[data-recent-folder]')).find(el=>el.dataset.recentFolder===${JSON.stringify(vanished)}).click()`)
  await click(client, '[data-new-kind="shell"]')
  await until(() => client.ev("!!document.querySelector('[data-launch-retry]')"), 'launch recovery actions')
  assert.equal(await client.ev("document.querySelectorAll('.tab[data-session-id]').length"), 2)
  await click(client, '[data-copy-launch-error]')
  assert.match(await client.ev('window.buddy.clipboard.read()'), /folder is unavailable/)
  mkdirSync(vanished)
  const retryShell = await client.ev("window.buddy.shells.list().then(shells=>shells.at(-1).id)")
  await client.ev(`(()=>{const select=document.querySelector('[data-recovery-shell]');select.value=${JSON.stringify(retryShell)};select.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await click(client, '[data-launch-retry]')
  await until(() => client.ev("document.querySelectorAll('.tab[data-session-id]').length===3 && !document.querySelector('.new-session-dialog')"), 'retry succeeds')
  await until(async () => (await client.ev('window.buddy.workspace.get()')).sessions.length===3, 'retried workspace saved')
  assert.equal((await client.ev('window.buddy.workspace.get()')).sessions[2].shellId, retryShell)
  pass('missing recent folders show Retry, shell choice and Copy error; retry opens exactly one terminal')

  // All windows see library mutations, and persistence survives a normal restart.
  const otherId = await client.ev('window.buddy.app.newWindow()')
  const other = await connect(workspacePage(otherId))
  await until(() => other.ev("!!document.querySelector('[data-new-resume]')"), 'second chooser')
  assert.equal((await other.ev('window.buddy.library.get()')).presets[0].id, preset.id)
  await client.ev(`window.buddy.library.deletePreset(${JSON.stringify(preset.id)})`)
  await until(async () => (await other.ev('window.buddy.library.get()')).presets.length === 0, 'shared preset removal')
  await client.ev(`window.buddy.library.savePreset(${JSON.stringify({ ...preset, id: undefined })})`)
  await quit(client)
  await boot(); client = await connect(workspacePage('primary'))
  await until(() => client.ev("!!document.querySelector('[data-restore-fresh]')"), 'restart recovery')
  const stored = await client.ev('window.buddy.library.get()')
  assert.equal(stored.pinnedChats[0].id, chatId)
  assert.equal(stored.presets[0].name, 'Website project')
  assert.ok(stored.recentFolders.includes(vanished))
  pass('favorites and presets stay shared across windows and survive restart')
  await click(client, '[data-restore-fresh]')
  await until(() => client.ev("!!document.querySelector('.launcher-extras')"), 'fresh chooser after restart')
  await click(client, '.launcher-extras summary')
  const screenshot = await client.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(tmpdir(), 'buddy-launcher.png'), Buffer.from(screenshot.data, 'base64'))
  await quit(client)
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
