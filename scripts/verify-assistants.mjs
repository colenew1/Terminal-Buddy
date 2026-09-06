/** Custom CLI profiles through Settings, chooser, presets, moves and recovery. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmdirSync, rmSync, realpathSync, chmodSync } from 'node:fs'
import { join, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'
const require = createRequire(import.meta.url)
const root = realpathSync(mkdtempSync(join(tmpdir(), 'buddy-assistants-')))
const profile = join(root, 'profile'), testHome = join(root, 'home')
mkdirSync(profile); mkdirSync(testHome)
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ walkthroughVersion: 1, desktopNotifications: false,
  trayIcon: false, closeToTray: false, defaultShellId: process.platform === 'win32' ? 'cmd' : 'default' }))
const mock = join(root, 'codex.js')
writeFileSync(mock, `process.stdin.setRawMode(true); process.stdin.resume(); console.log('MOCK_READY:' + process.pid); process.stdin.on('data', b => console.log('INPUT:' + b.toString('hex')));`)
let child, logs = '', connections = []
const PORT = 9264
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
const bin = join(root, 'bin')
mkdirSync(bin)
const launchesFile = join(root, 'launches.jsonl')
writeFileSync(mock, `import('node:fs').then(fs => {
fs.appendFileSync(${JSON.stringify(launchesFile)}, JSON.stringify({pid:process.pid,args:process.argv.slice(2),cwd:process.cwd()})+'\\n');
process.stdin.setRawMode(true);process.stdin.resume();
console.log('CUSTOM_READY:'+process.pid+':'+JSON.stringify(process.argv.slice(2)));
process.stdin.on('data', b=>console.log('INPUT:'+b.toString('hex')));
});`)
const launches = () => { try { return readFileSync(launchesFile,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) } catch { return [] } }
const command = `"${process.execPath}" "${mock}" --model "fixture model"`
const click = (client, selector) => client.ev(`document.querySelector(${JSON.stringify(selector)}).click()`)
async function fill(client, selector, text) {
  await client.ev(`document.querySelector(${JSON.stringify(selector)}).select()`)
  await client.send('Input.insertText', { text })
}
async function openSettings(client) {
  await client.ev("document.querySelector('[data-new-cancel]')?.click()")
  await click(client, '.topbar button[title^="Settings"]')
  await until(() => client.ev("!!document.querySelector('[data-assistant-settings]')"), 'assistant settings')
}
async function presets(client) {
  await click(client, '[data-window-menu]'); await click(client, '[data-workspace-presets]')
  await until(() => client.ev("!!document.querySelector('[data-preset-name]')"), 'presets dialog')
}
try {
  await boot()
  let first = await connect(workspacePage('primary'))
  await until(() => first.ev("!!document.querySelector('[data-new-chat]')"), 'chooser')
  await click(first, '[data-new-chat]')
  await click(first, '[data-manage-assistants]')
  await until(() => first.ev("!!document.querySelector('[data-assistant-kimi]')"), 'manage assistants')
  await click(first, '[data-assistant-kimi]')
  assert.equal(await first.ev("document.querySelector('[data-assistant-name]').value"), 'Kimi')
  assert.equal(await first.ev("document.querySelector('[data-assistant-command]').value"), 'kimi')
  await fill(first, '[data-assistant-name]', 'Kimi fixture')
  await fill(first, '[data-assistant-command]', command)
  await click(first, '[data-assistant-save]')
  await until(async () => (await first.ev('window.buddy.settings.get()')).customAssistants.length === 1, 'profile saved')
  const profile = (await first.ev('window.buddy.settings.get()')).customAssistants[0]
  await sleep(300)
  const shot = await first.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(tmpdir(), 'buddy-assistant-settings.png'), Buffer.from(shot.data, 'base64'))
  await click(first, '.modal-head .icon-btn')
  await click(first, '.tab-new'); await click(first, '[data-new-chat]')
  await first.ev("window.__output='';window.buddy.pty.onData((_id,data)=>window.__output+=data)")
  await click(first, `[data-new-kind="${profile.id}"]`)
  await until(() => launches().length === 1, 'custom process starts')
  await ready(first)
  await until(() => first.ev("window.__output.includes('CUSTOM_READY:')"), 'custom output')
  assert.deepEqual(launches()[0].args, ['--model','fixture model'])
  assert.equal(launches()[0].cwd.toLowerCase(), testHome.toLowerCase())
  const id = await first.ev("document.querySelector('.tab[data-session-id]').dataset.sessionId")
  await until(async () => (await first.ev('window.buddy.workspace.get()')).sessions[0]?.assistantId === profile.id, 'custom identity saved')
  assert.equal((await first.ev('window.buddy.pty.probeAgents()'))[id], null)
  assert.equal(await first.ev("document.querySelectorAll('[data-link-session]').length"), 0)
  pass('Settings adds Kimi or any named CLI, preserving quoted model arguments and custom identity')

  const secondId = await first.ev('window.buddy.app.newWindow()')
  let second = await connect(workspacePage(secondId))
  await until(() => second.ev("!!document.querySelector('[data-new-chat]')"), 'new workspace ready')
  await second.ev("window.__arrivals=[];window.buddy.workspace.onTransferArrive(items=>window.__arrivals.push(...items))")
  await first.ev(`window.buddy.workspace.move(${JSON.stringify(id)},${JSON.stringify(secondId)})`)
  await ready(second)
  const arrival = await second.ev('window.__arrivals[0]')
  assert.equal(arrival.session.assistantId, profile.id)
  assert.equal(arrival.hasInput, true); assert.equal(arrival.agent, null)
  assert.ok(arrival.snapshot.data.includes('CUSTOM_READY:'))
  process.kill(launches()[0].pid, 0)
  assert.equal(launches().length, 1)
  pass('custom assistants move without restarting and stay protected as occupied terminals')

  await presets(second)
  await fill(second, '[data-preset-name]', 'Custom workspace')
  await click(second, '[data-preset-save]')
  await until(async () => (await second.ev('window.buddy.library.get()')).presets.length === 1, 'custom preset saved')
  const preset = (await second.ev('window.buddy.library.get()')).presets[0]
  assert.equal(preset.sessions[0].assistantId, profile.id)
  assert.equal('initialCommand' in preset.sessions[0], false)
  await click(second, `[data-preset-open="${preset.id}"]`)
  await until(() => launches().length === 2, 'preset launches custom CLI')
  assert.deepEqual(launches()[1].args, launches()[0].args)
  await openSettings(first)
  await click(first, `[data-assistant-edit="${profile.id}"]`)
  await fill(first, '[data-assistant-command]', command + ' --updated')
  await click(first, '[data-assistant-save]')
  await until(async () => (await second.ev('window.buddy.settings.get()')).customAssistants[0].command.endsWith('--updated'), 'shared edit')
  assert.equal(launches().length, 2)
  await click(first, '.modal-head .icon-btn')
  await presets(second); await click(second, `[data-preset-open="${preset.id}"]`)
  await until(() => launches().length === 3, 'edited command used by preset')
  assert.deepEqual(launches()[2].args, ['--model','fixture model','--updated'])
  assert.match(await first.ev(`window.buddy.assistants.save(${JSON.stringify({...profile,command:'bad\ncommand'})}).then(()=>'UNEXPECTED',e=>e.message)`), /single-line/)
  pass('preset launches resolve the current profile; edits are shared and invalid commands are rejected')

  await quit(first); await boot()
  first = await connect(workspacePage('primary')); second = await connect(workspacePage(secondId))
  await until(() => second.ev("!!document.querySelector('[data-restore-all]')"), 'custom recovery chooser')
  assert.equal(launches().length, 3)
  assert.equal((await second.ev('window.buddy.settings.get()')).customAssistants[0].id, profile.id)
  assert.match(await second.ev("document.querySelector('.restore-session-dialog').textContent"), /fresh Kimi fixture session/)
  await click(second, '[data-restore-all]')
  await until(() => launches().length === 6, 'explicit fresh custom recovery')
  assert.ok(launches().slice(3).every(x => x.args.includes('--updated')))
  pass('profiles survive restart and recovery explicitly starts fresh custom sessions')

  await openSettings(first)
  await click(first, `[data-assistant-remove="${profile.id}"]`)
  await until(async () => (await second.ev('window.buddy.settings.get()')).customAssistants.length === 0, 'profile removed')
  for (const launch of launches().slice(3)) process.kill(launch.pid, 0)
  await presets(second); await click(second, `[data-preset-open="${preset.id}"]`)
  await until(() => second.ev("!!document.querySelector('.new-session-error')"), 'removed profile blocked')
  assert.equal(launches().length, 6)
  assert.match(await second.ev("document.querySelector('.new-session-error').textContent"), /no longer configured/)
  assert.match(await second.ev(`window.buddy.pty.create({cwd:${JSON.stringify(testHome)},assistantId:${JSON.stringify(profile.id)}}).then(()=>'UNEXPECTED',e=>e.message)`), /no longer configured/)
  const saved = await second.ev('window.buddy.workspace.get()')
  const restore = await second.ev(`window.buddy.workspace.prepareRestore(${JSON.stringify(saved.sessions)})`)
  assert.ok(restore.every(item=>!item.available))
  pass('removing a profile leaves live sessions running and blocks stale presets or recovery instead of opening a shell')
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
