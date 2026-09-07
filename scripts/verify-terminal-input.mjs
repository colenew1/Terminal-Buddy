/** Real native paste and wheel input; only the OS folder dialog is stubbed. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'
const require = createRequire(import.meta.url)
const root = mkdtempSync(join(tmpdir(), 'buddy-terminal-input-'))
const profile = join(root, 'profile'), home = join(root, 'home'), project = join(root, 'chosen folder'), bin = join(root, 'bin')
for (const dir of [profile, home, project, bin]) mkdirSync(dir)
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ walkthroughVersion: 1, trayIcon: false, closeToTray: false,
  desktopNotifications: false, defaultShellId: process.platform === 'win32' ? 'cmd' : 'default' }))
const mock = join(root, 'mock.cjs')
writeFileSync(mock, `process.stdin.setRawMode(true);process.stdin.resume();console.log('ARGS:'+process.argv.slice(2).join(' '));
for(let i=0;i<160;i++)console.log('SCROLL_HISTORY_'+i);
process.stdout.write('\\x1b[2J\\x1b[HCURRENT_SCREEN\\r\\n\\x1b[?1000h\\x1b[?1006h\\x1b[?2004h');
process.stdin.on('data',data=>console.log('INPUT:'+data.toString('hex')));`)
const launcher = join(bin, process.platform === 'win32' ? 'codex.cmd' : 'codex')
writeFileSync(launcher, process.platform === 'win32' ? `@"${process.execPath}" "${mock}" %*\r\n` : `#!/bin/sh\nexec "${process.execPath}" "${mock}" "$@"\n`)
if (process.platform !== 'win32') chmodSync(launcher, 0o755)
const bootstrap = join(root, 'bootstrap.cjs')
writeFileSync(bootstrap, `const {app,dialog}=require('electron');app.setPath('appData',${JSON.stringify(profile)});app.setPath('userData',${JSON.stringify(profile)});app.setPath('home',${JSON.stringify(home)});let picks=0;
dialog.showOpenDialog=async()=>++picks===1?{canceled:true,filePaths:[]}:{canceled:false,filePaths:[${JSON.stringify(project)}]};
require(${JSON.stringify(resolve('out/main/index.js'))});`)
const env = { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude') }
delete env.ELECTRON_RUN_AS_NODE
const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'PATH'
env[pathKey] = bin + (process.platform === 'win32' ? ';' : ':') + env[pathKey]
const port = 9265
const child = spawn(require('electron'), [bootstrap, '--user-data-dir=' + profile, '--remote-debugging-port=' + port], { env, windowsHide: true, stdio: ['ignore','pipe','pipe'] })
let logs=''
child.stdout.on('data',data=>{logs+=data});child.stderr.on('data',data=>{logs+=data})
const clients = []
async function until(fn, label) {
  for (let i=0;i<100;i++) { if (await fn()) return; await sleep(100) }
  throw Error('Timed out: '+label)
}
async function connect(match) {
  let page
  await until(async () => { try { page=(await(await fetch(`http://127.0.0.1:${port}/json`)).json()).find(match); return !!page } catch { return false } },'page')
  const ws=new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject})
  let serial=0;const pending=new Map()
  ws.onmessage=e=>{const r=JSON.parse(e.data),p=pending.get(r.id);if(p){clearTimeout(p.timer);pending.delete(r.id);r.error?p.reject(Error(r.error.message)):p.resolve(r.result)}}
  const client={ws,send:(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;const timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timeout'))},10000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))}),
    async ev(expression){const r=await client.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value}}
  clients.push(client);return client
}
const click=(c,s)=>c.ev(`document.querySelector(${JSON.stringify(s)}).click()`)
async function pasteKey(c, text) {
  await c.ev(`window.buddy.clipboard.write(${JSON.stringify(text)})`)
  const modifiers = process.platform === 'darwin' ? 4 : 2
  // No physical code, like synthetic accessibility input.
  await c.send('Input.dispatchKeyEvent',{type:'keyDown',key:'v',code:'',windowsVirtualKeyCode:86,modifiers})
  await c.send('Input.dispatchKeyEvent',{type:'keyUp',key:'v',code:'',windowsVirtualKeyCode:86,modifiers})
}
async function wheel(c, selector, deltaY) {
  const point=await c.ev(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  await c.send('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY})
}
const sliderTop=(c, selector)=>c.ev(`parseFloat(document.querySelector(${JSON.stringify(selector+' .scrollbar.vertical .slider')}).style.top)`)
try {
  const c=await connect(p=>p.type==='page')
  await until(()=>c.ev(`!!document.querySelector('[data-new-folder]:not(:disabled)')`),'chooser')
  await click(c,'[data-new-folder]')
  await sleep(200)
  assert.equal(await c.ev(`document.querySelectorAll('.cell').length`),0)
  assert.equal(await c.ev(`!!document.querySelector('.new-session-dialog[open]')`),true)
  await click(c,'[data-new-folder]')
  await until(()=>c.ev(`!!document.querySelector('.xterm-helper-textarea')&&!document.querySelector('.new-session-dialog')`),'folder opens terminal')
  await until(()=>c.ev(`window.buddy.workspace.get().then(w=>w.sessions[0]?.cwd===${JSON.stringify(project)})`),'saved chosen directory')
  console.log('PASS folder cancellation creates nothing; selecting Open immediately launches one terminal in the chosen directory')
  await c.ev(`window.__output={};window.buddy.pty.onData((id,data)=>window.__output[id]=(window.__output[id]??'')+data)`)
  await click(c,'.tab-new');await click(c,'[data-new-chat]');await click(c,'[data-new-kind="codex"]')
  await until(()=>c.ev(`Object.values(window.__output).some(s=>s.includes('CURRENT_SCREEN'))`),'mock ready')
  const id=await c.ev(`document.querySelector('.cell.is-active').dataset.sessionId`)
  assert.ok((await c.ev(`window.__output[${JSON.stringify(id)}]`)).includes('ARGS:--no-alt-screen'))
  const selector='.cell.is-active .xterm'
  await sleep(200)
  const before=await sliderTop(c,selector)
  assert.ok(before>0, 'history exists above the viewport after a clear')
  await wheel(c,selector,-480)
  await until(async()=>await sliderTop(c,selector)<before,'wheel scrolls earlier history despite mouse reporting')
  const scrolled=await sliderTop(c,selector)
  await c.ev(`window.buddy.pty.write(${JSON.stringify(id)},'background output')`)
  await sleep(200)
  assert.equal(await sliderTop(c,selector),scrolled,'new output does not pull the viewport down')
  console.log('PASS Codex uses inline mode; mouse wheel scrolls preserved history and incoming output leaves its position alone')
  await pasteKey(c,'dictation without a physical key code')
  const expected=Buffer.from('\x1b[200~dictation without a physical key code\x1b[201~').toString('hex')
  await until(()=>c.ev(`window.__output[${JSON.stringify(id)}].includes(${JSON.stringify('INPUT:'+expected)})`),'text paste')
  assert.equal(await c.ev(`window.__output[${JSON.stringify(id)}].includes('INPUT:16')`),false)
  assert.equal(await c.ev(`window.__output[${JSON.stringify(id)}].split(${JSON.stringify('INPUT:'+expected)}).length-1`),1)
  console.log('PASS synthetic Ctrl+V delivers bracketed text once without a raw image-paste shortcut or Enter')
  await click(c,'.tab-new')
  await c.ev(`document.querySelector('[data-new-cancel]').focus()`)
  await pasteKey(c,'must not leak through modal')
  await sleep(150)
  assert.equal(await c.ev(`window.__output[${JSON.stringify(id)}].includes(${JSON.stringify(Buffer.from('must not leak through modal').toString('hex'))})`),false)
  await click(c,'[data-new-cancel]')
  await c.ev(`window.buddy.popout.open(${JSON.stringify(id)})`)
  const pop=await connect(p=>p.type==='page'&&p.url.includes('popout='))
  await until(()=>pop.ev(`!!document.querySelector('.xterm-helper-textarea')`),'popout ready')
  await pasteKey(pop,'detached dictation')
  await until(()=>c.ev(`window.__output[${JSON.stringify(id)}].includes(${JSON.stringify(Buffer.from('detached dictation').toString('hex'))})`),'popout paste')
  const popTop=await sliderTop(pop,'.xterm')
  await wheel(pop,'.xterm',-480)
  await until(async()=>await sliderTop(pop,'.xterm')<popTop,'popout scrolling')
  console.log('PASS dialogs protect background terminals; popped-out terminals retain native dictation and scrollback')
  await c.send('Browser.close').catch(()=>{})
} catch(error) { console.error(logs); throw error } finally {
  for(const c of clients)c.ws.close()
  child.kill();await sleep(600)
  assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep))
  rmSync(root,{recursive:true,force:true,maxRetries:8,retryDelay:250})
}
