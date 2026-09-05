/** Real Electron UI tests. Isolated profile, synthetic history, and a local mock agent only. */
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
const root = mkdtempSync(join(tmpdir(), 'buddy-features-'))
const profile = join(root, 'profile'), testHome = join(root, 'home'), project = join(root, 'project')
for (const dir of [profile, testHome, project]) mkdirSync(dir)
const chatId = '11111111-1111-4111-8111-111111111111'
const historyDir = join(testHome, '.claude', 'projects', project.replace(/[^A-Za-z0-9]/g, '-'))
mkdirSync(historyDir, { recursive: true })
const history = join(historyDir, chatId + '.jsonl'), inputs = join(root, 'inputs.txt'), launches = join(root, 'launches.txt'), mock = join(root, 'mock.mjs')
writeFileSync(history, JSON.stringify({ type: 'user', sessionId: chatId, cwd: project, timestamp: new Date().toISOString(), message: { content: 'Recovery fixture chat' } }) + '\n')
writeFileSync(mock, `import {appendFileSync} from 'node:fs'; appendFileSync(${JSON.stringify(launches)}, process.pid+'\\n'); console.log('MOCK_READY'); process.stdin.setRawMode?.(true); process.stdin.on('data', b=>{appendFileSync(${JSON.stringify(inputs)},b); console.log('OUTPUT '+b.toString()); if(b.toString()==='Q')process.exit(0)}); process.stdin.resume();`)
const settings = { defaultShellId: 'cmd', trayIcon: false, desktopNotifications: true, chime: true, claudeResumeCommand: `"${process.execPath}" "${mock}" {id}` }
writeFileSync(join(profile, 'settings.json'), JSON.stringify(settings))
const saved = () => JSON.parse(readFileSync(join(profile, 'workspace.json'), 'utf8'))
const inputText = () => existsSync(inputs) ? readFileSync(inputs, 'utf8') : ''
const pending = new Map(), errors = []
let child, ws, serial = 0, failures = 0
function check(name, ok, detail = '') { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`) }
function send(method, params = {}) {
  const id = ++serial
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error('Timeout ' + method)) }, 10000)
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }))
  })
}
async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result.value
}
async function until(expression) { for (let i = 0; i < 100; i++) { if (await ev(expression)) return; await sleep(100) } throw Error('Not ready: ' + expression) }
async function click(selector) {
  const rect = await ev(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...rect, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...rect, button: 'left', clickCount: 1 })
}
async function key(key, code, vk, modifiers = 0) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, modifiers })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers })
}
async function shot(name) { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(tmpdir(), name), Buffer.from(r.data, 'base64')) }
async function launch() {
  child = spawn(process.env.BUDDY_EXE ?? 'node_modules/electron/dist/electron.exe', [ ...(process.env.BUDDY_EXE ? [] : ['./out/main/index.js']), '--remote-debugging-port=9247', '--user-data-dir=' + profile ], { stdio: 'ignore', windowsHide: true, env: { ...process.env, HOME: testHome, USERPROFILE: testHome } })
  let page
  for (let i = 0; i < 100; i++) { try { page = (await (await fetch('http://127.0.0.1:9247/json/list')).json()).find(p => p.type === 'page'); if (page) break } catch {} await sleep(100) }
  if (!page) throw Error('App did not start')
  ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
  ws.onmessage = e => { const m = JSON.parse(e.data), p = pending.get(m.id); if (p) { clearTimeout(p.timer); pending.delete(m.id); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result) } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text) }
  ws.onclose = () => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error('Window closed')) } pending.clear() }
  await send('Runtime.enable')
  await until("!!document.querySelector('.walkthrough[open], .restore-session-dialog[open], .cell')")
}
async function shutdown() {
  if (child?.exitCode === null) {
    await ev('window.close()').catch(() => {})
    for (let i = 0; i < 80 && child.exitCode === null; i++) await sleep(100)
    if (child.exitCode === null) throw Error('Normal close did not exit')
  }
  ws?.close(); await sleep(300)
}
try {
  await launch()
  await until("!!document.querySelector('.walkthrough[open]')")
  check('first launch opens a modal walkthrough', await ev("document.querySelector('.walkthrough').matches(':modal')"))
  check('legacy desktop alerts and chimes are now off', await ev('window.buddy.settings.get().then(s=>!s.desktopNotifications&&!s.chime)'))
  const initialCount = await ev("document.querySelectorAll('.cell').length")
  await key('T', 'KeyT', 84, 10)
  check('walkthrough blocks app shortcuts and does not create extra terminals', await ev(`document.querySelectorAll('.cell').length===${initialCount} && !document.querySelector('.new-session-dialog')`))
  await shot('terminal-buddy-walkthrough.png')
  await click('[data-tour-next]'); check('Next advances the walkthrough', await ev("document.querySelector('#walkthrough-title').textContent==='Start with the plus'"))
  await click('[data-tour-back]'); check('Back returns to the preceding step', await ev("document.querySelector('#walkthrough-title').textContent==='Meet your Terminal Buddy'"))
  await click('[data-tour-skip]'); await until("!document.querySelector('.walkthrough')")
  check('Skip saves completion', await ev('window.buddy.settings.get().then(s=>s.walkthroughVersion===1)'))
  await shutdown(); await launch()
  check('restart does not repeat a skipped tour', await ev("!document.querySelector('.walkthrough')"))
  await shutdown()

  // Old World layouts migrate without losing their sessions. Restore choice precedes the tour.
  const priorSettings = JSON.parse(readFileSync(join(profile, 'settings.json'), 'utf8'))
  writeFileSync(join(profile, 'settings.json'), JSON.stringify({ ...priorSettings, walkthroughVersion: 0 }))
  writeFileSync(join(profile, 'workspace.json'), JSON.stringify({ layout: 'world', gridSizes: { columns: [.35, .65], rows: [1] }, activeIndex: 1, sessions: [
    { cwd: project, shellId: 'cmd', title: 'Agent needing a look', resume: { agent: 'claude', id: chatId, path: history } },
    { cwd: project, shellId: 'cmd', title: 'Manual terminal' }
  ] }))
  await launch()
  check('restore chooser takes priority over onboarding', await ev("!!document.querySelector('.restore-session-dialog') && !document.querySelector('.walkthrough')"))
  await click('[data-restore-all]'); await until("!!document.querySelector('.walkthrough[open]')")
  for (let i = 0; i < 7; i++) { await click('[data-tour-next]'); await sleep(80) }
  await until("!document.querySelector('.walkthrough')")
  check('finishing all seven steps persists completion', await ev('window.buddy.settings.get().then(s=>s.walkthroughVersion===1)'))
  check('World is removed and old workspaces retain both terminals in Grid', await ev("!!document.querySelector('.area-grid') && document.querySelectorAll('.cell').length===2 && ![...document.querySelectorAll('.seg button')].some(b=>b.textContent==='World')"))
  await key('G', 'KeyG', 71, 10); await key('G', 'KeyG', 71, 10)
  check('layout shortcut only cycles Tabs and Grid', await ev("!!document.querySelector('.area-grid')"))
  const ids = await ev("[...document.querySelectorAll('.cell')].map(c=>c.dataset.sessionId)")
  const first = `.cell[data-session-id="${ids[0]}"]`, second = `.cell[data-session-id="${ids[1]}"]`
  await until(`${JSON.stringify(first)} && document.querySelector(${JSON.stringify(first)}).classList.contains('needs-look')`)
  check('paused agent gets a faint border and tab cue', await ev(`getComputedStyle(document.querySelector(${JSON.stringify(first)}),'::after').animationName==='attention-border' && document.querySelector('.tab.wants-you')!==null`))
  check('unused shell does not request attention', await ev(`!document.querySelector(${JSON.stringify(second)}).classList.contains('needs-look')`))
  await shot('terminal-buddy-attention.png')
  await click(first + ' .cell-index'); await sleep(1600)
  check('click acknowledges without typing and does not rearm from old output', await ev(`!document.querySelector(${JSON.stringify(first)}).classList.contains('needs-look')`) && inputText() === '')
  await ev(`window.buddy.pty.write(${JSON.stringify(ids[0])}, 'new')`)
  await until(`document.querySelector(${JSON.stringify(first)}).classList.contains('needs-look')`)
  await ev(`window.buddy.pty.write(${JSON.stringify(ids[0])}, 'more')`); await sleep(200)
  check('light remains latched through more output until acknowledged', await ev(`document.querySelector(${JSON.stringify(first)}).classList.contains('needs-look')`))
  await click(first + ' .cell-index')
  await click('[data-focus-session="' + ids[0] + '"]'); await sleep(200)
  check('focus fills the area without replacing either terminal', await ev(`!!document.querySelector('.area-tabs') && document.querySelectorAll('.cell').length===2 && document.querySelectorAll('.cell:not(.is-stacked)').length===1`))
  const beforeEscape = inputText()
  await key('Escape', 'Escape', 27); await sleep(200)
  check('Escape restores exact grid proportions and never reaches the agent', await ev("!!document.querySelector('.area-grid')") && inputText() === beforeEscape && saved().gridSizes.columns[0] === .35)
  const headerPoint = await ev(`(()=>{const r=document.querySelector(${JSON.stringify(first + ' .cell-index')}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  for (const count of [1, 2]) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...headerPoint, button: 'left', clickCount: count })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...headerPoint, button: 'left', clickCount: count })
  }
  check('double-clicking the header also enters focus mode', await ev("!!document.querySelector('.area-tabs')"))
  await key('Escape', 'Escape', 27)

  await click('[data-link-session="' + ids[1] + '"]')
  await until("!!document.querySelector('.recovery-choice input')")
  await click('.recovery-choice input')
  const launchesBefore = readFileSync(launches, 'utf8')
  await click('.recovery-dialog .primary'); await until("!document.querySelector('.recovery-dialog')")
  check('manual terminal links an exact saved chat without starting/replacing a process', saved().sessions[1].resume?.id === chatId && readFileSync(launches, 'utf8') === launchesBefore && await ev(`document.querySelector(${JSON.stringify(second)})!==null`))
  const ref = { agent: 'claude', id: '22222222-2222-4222-8222-222222222222', path: history, cwd: project }
  check('mismatched recovery IDs are rejected', await ev(`window.buddy.pty.link(${JSON.stringify(ids[1])}, ${JSON.stringify(ref)}).then(()=>false,()=>true)`))

  await ev(`window.buddy.pty.write(${JSON.stringify(ids[0])}, 'Q')`)
  await sleep(500)
  await ev(`window.buddy.pty.write(${JSON.stringify(ids[0])}, ${JSON.stringify('exit\r')})`)
  await until(`document.querySelector(${JSON.stringify(first)}).classList.contains('needs-look') && document.querySelector(${JSON.stringify(first)}).textContent.includes('Exited')`)
  check('a used process exiting also latches its attention border', true)
  await click(first + ' .cell-index')
  check('acknowledging an exited process needs no input', await ev(`!document.querySelector(${JSON.stringify(first)}).classList.contains('needs-look')`))

  await click('.topbar button[title^="Settings"]'); await click('[data-replay-tour]')
  await until("!!document.querySelector('.walkthrough[open]')")
  check('Settings replays the tour without launching sessions', await ev("document.querySelectorAll('.cell').length===2"))
  await key('Escape', 'Escape', 27); await until("!document.querySelector('.walkthrough')")
  check('Escape skips the replay safely', true)
  await shutdown(); await launch()
  check('completed tour stays dismissed on restart', await ev("!document.querySelector('.walkthrough')"))
  check('manually linked identity survives restart', saved().sessions[1].resume.id === chatId)
  check('no renderer exceptions', errors.length === 0, errors.join(' | '))
} catch (error) { check('harness', false, error.stack); try { console.log(await ev('document.body.innerText')) } catch {} }
finally {
  try { await shutdown() } catch { if (child?.exitCode === null) child.kill() }
  ws?.close(); await sleep(600)
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
  process.exitCode = failures ? 1 : 0
}
