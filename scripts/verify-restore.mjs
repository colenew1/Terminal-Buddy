/** Isolated restart tests. Fake agents record exact resume IDs; no live chats are touched. */
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const root = mkdtempSync(join(tmpdir(), 'buddy-restore-'))
const profile = join(root, 'profile'), testHome = join(root, 'home'), project = join(root, 'project')
for (const dir of [profile, testHome, project]) mkdirSync(dir)
const callsFile = join(root, 'calls.jsonl'), mock = join(root, 'agent.mjs')
writeFileSync(mock, `import {appendFileSync} from 'node:fs'; appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()})+'\\n'); console.log('RESTORED '+process.argv.slice(2).join(' ')); process.stdin.resume();`)
const command = `"${process.execPath}" "${mock}" {id}`
const settings = { walkthroughVersion: 1, defaultShellId: 'cmd', trayIcon: false, closeToTray: false, desktopNotifications: false,
  claudeResumeCommand: command, codexResumeCommand: command, restoreOnLaunch: true }
writeFileSync(join(profile, 'settings.json'), JSON.stringify(settings))
const id1 = '11111111-1111-4111-8111-111111111111', id2 = '22222222-2222-4222-8222-222222222222'
const claude = join(project, id1+'.jsonl'), codex = join(project, 'rollout-'+id2+'.jsonl')
writeFileSync(claude, JSON.stringify({type:'user',sessionId:id1,cwd:project,message:{content:'Original chat'}})+'\n')
writeFileSync(codex, JSON.stringify({type:'session_meta',payload:{id:id2,cwd:project}})+'\n')
const sessions = [
  {cwd:project,shellId:'cmd',title:'Praveen persona',critter:'fox',pos:{x:220,y:180},resume:{agent:'claude',id:id1,path:claude}},
  {cwd:project,shellId:'cmd',title:'Another chat, same folder',resume:{agent:'codex',id:id2,path:codex}},
  {cwd:project,shellId:'cmd',title:'Plain terminal',initialCommand:'MUST_NOT_EXECUTE'},
  {cwd:join(root,'missing'),title:'Missing folder'},
  {cwd:project,title:'Unlinked agent',agent:'codex'},
  {cwd:project,title:'Wrong history',resume:{agent:'claude',id:id2,path:claude}},
  {cwd:project,title:'Missing history',resume:{agent:'claude',id:id1,path:join(root,'missing.jsonl')}}
]
const snapshot = {sessions,layout:'grid',activeIndex:0,gridSizes:{columns:[0.65,0.35],rows:[0.4,0.6]}}
const seed = (value=snapshot) => writeFileSync(join(profile,'workspace.json'),JSON.stringify(value))
const saved = () => JSON.parse(readFileSync(join(profile,'workspace.json'),'utf8'))
const calls = () => existsSync(callsFile) ? readFileSync(callsFile,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []
seed()
const pending = new Map(), errors = []
let child, ws, serial=0, failures=0
const check = (label, ok, detail='') => {if(!ok) failures++;console.log(`${ok?'PASS':'FAIL'} ${label}${detail?' — '+detail:''}`)}
function send(method,params={}) {
  const id=++serial
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(Error('Timeout '+method))},10000)
    pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))
  })
}
async function ev(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value}
async function until(expression){for(let i=0;i<100;i++){if(await ev(expression))return;await sleep(100)}throw Error('Not ready: '+expression)}
async function launch(){
  child=spawn(process.env.BUDDY_EXE??'node_modules/electron/dist/electron.exe',[
    ...(process.env.BUDDY_EXE?[]:['./out/main/index.js']),'--remote-debugging-port=9244','--user-data-dir='+profile
  ],{stdio:'ignore',windowsHide:true,env:{...process.env,HOME:testHome,USERPROFILE:testHome}})
  let page
  for(let i=0;i<100;i++){try{page=(await(await fetch('http://127.0.0.1:9244/json/list')).json()).find(p=>p.type==='page');if(page)break}catch{}await sleep(100)}
  if(!page)throw Error('App did not start')
  ws=new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject})
  ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}else if(m.method==='Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text)}
  ws.onclose=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Window closed'))}pending.clear()}
  await send('Runtime.enable')
  await until("!!document.querySelector('.restore-session-dialog[open]') || !!document.querySelector('.cell')")
}
async function shutdown(){
  if(child && child.exitCode===null){
    try{await ev('window.close()')}catch{}
    for(let i=0;i<70 && child.exitCode===null;i++)await sleep(100)
    if(child.exitCode===null) { child.kill(); throw Error('Normal app close did not exit') }
  }
  ws?.close();await sleep(350)
}
async function reopen(){await ev("document.querySelector('[data-restore-all]').click()");await until("!document.querySelector('.restore-session-dialog')")}

try {
  await launch()
  check('startup waits for your choice without creating terminals or starting agents',await ev("document.querySelectorAll('.cell').length===0") && calls().length===0)
  check('unavailable folders, unlinked agents and mismatched/missing history are flagged',await ev("document.querySelectorAll('.restore-row.is-unavailable').length===4"))
  const shot=await send('Page.captureScreenshot',{format:'png'})
  writeFileSync(join(tmpdir(),'terminal-buddy-restore.png'),Buffer.from(shot.data,'base64'))
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
  check('Escape does not discard your saved workspace',await ev("!!document.querySelector('.restore-session-dialog[open]')"))
  await shutdown()
  check('exiting before choosing preserves the entire recovery snapshot',JSON.stringify(saved().sessions)===JSON.stringify(sessions))
  await launch();await reopen()
  await until("document.querySelectorAll('.cell').length===3")
  for(let i=0;i<100 && calls().length<2;i++)await sleep(100)
  check('same-folder chats resume their two exact IDs, once each',calls().length===2 && calls().some(c=>c.args[0]===id1) && calls().some(c=>c.args[0]===id2) && calls().every(c=>c.args.length===1 && c.cwd.toLowerCase()===project.toLowerCase()),JSON.stringify(calls()))
  check('names, ordering, world position and grid proportions survive',saved().sessions[0].title===sessions[0].title && saved().sessions[1].title===sessions[1].title && saved().sessions[0].pos.x===220 && saved().gridSizes.columns[0]===0.65)
  check('active pane is restored',await ev("document.querySelector('.cell.is-active .session-name-button').textContent.includes('Praveen persona')"))
  check('failed recovery entries are retained',saved().unrestoredSessions.length===4)
  check('terminal-only recovery does not replay arbitrary saved commands',!await ev("document.body.textContent.includes('MUST_NOT_EXECUTE')") && !saved().sessions[2].initialCommand)
  // Rename and close within one JS turn, before the 400 ms persistence timer.
  await ev("document.querySelector('.cell .session-name-button').click()")
  await until("!!document.querySelector('.session-rename')")
  await ev(`(()=>{const input=document.querySelector('.session-rename');input.value='Saved at the very last moment';input.blur();window.close()})()`).catch(()=>{})
  await shutdown()
  check('normal exit flushes a last-moment rename before killing terminals',saved().sessions[0].title==='Saved at the very last moment',JSON.stringify(saved().sessions.map(s=>s.title)))
  check('resume IDs survive normal shutdown',saved().sessions[0].resume.id===id1 && saved().sessions[1].resume.id===id2)

  seed({ ...snapshot,sessions:sessions.slice(0,3) })
  const priorCount=calls().length
  await launch();await ev("document.querySelector('[data-restore-choose]').click()")
  await until("!!document.querySelector('[data-restore-index]')")
  await ev("document.querySelector('[data-restore-index=\"0\"]').click();document.querySelector('[data-restore-index=\"2\"]').click()")
  await reopen();await until("document.querySelectorAll('.cell').length===1")
  for(let i=0;i<100 && calls().length===priorCount;i++)await sleep(100)
  check('Choose chats only launches the selected conversation',calls().length===priorCount+1 && calls().at(-1).args[0]===id2 && saved().sessions.length===1)
  await shutdown()

  seed();const beforeFresh=calls().length
  await launch();await ev("document.querySelector('[data-restore-fresh]').click()")
  await until("!document.querySelector('.restore-session-dialog') && !!document.querySelector('[data-new-kind=\"shell\"]:not(:disabled)')")
  check('Start fresh shows choices without launching a terminal',await ev("!document.querySelector('.cell') && document.querySelectorAll('.new-session-choices > button').length===4") && saved().sessions.length===0 && calls().length===beforeFresh)
  await ev("document.querySelector('[data-new-kind=\"shell\"]').click()")
  await until("!document.querySelector('.new-session-dialog') && document.querySelectorAll('.cell').length===1")
  await until("window.buddy.workspace.get().then(w => w.sessions.length===1)")
  check('Explicit fresh terminal opens only a home terminal, with no agents',saved().sessions.length===1 && saved().sessions[0].cwd.toLowerCase()===testHome.toLowerCase() && !saved().sessions[0].resume && calls().length===beforeFresh)
  check('Start fresh clears reopen entries but preserves chat history files',saved().unrestoredSessions.length===0 && existsSync(claude) && existsSync(codex))
  await shutdown()

  seed();await launch();await ev("document.querySelector('[data-restore-saved]').click()")
  await until("!document.querySelector('.restore-session-dialog')")
  check('Saved chats opens the catalog without an unwanted terminal or losing recovery entries',await ev("!!document.querySelector('.sidebar') && !document.querySelector('.cell')") && saved().unrestoredSessions.length===7)
  await shutdown()
  seed({sessions:sessions.slice(0,2),layout:'tabs'})
  writeFileSync(join(profile,'settings.json'),JSON.stringify({...settings,claudeResumeCommand:'echo missing-placeholder'}))
  await launch();await reopen()
  check('one invalid resume template does not stop other chats reopening',saved().sessions.length===1 && saved().sessions[0].resume.id===id2 && saved().unrestoredSessions[0].resume.id===id1)
  check('no renderer exceptions',errors.length===0,errors.join(' | '))
} catch(error) {check('harness',false,error.stack)}
finally {
  try{await shutdown()}catch(error){check('shutdown',false,error.message);child?.kill()}
  // Only the exact mkdtemp-owned test tree, never a user profile.
  rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:250})
  console.log(failures?`${failures} restore checks failed`:'All restore checks passed')
  process.exit(failures?1:0)
}
