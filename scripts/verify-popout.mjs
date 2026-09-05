/** Real multi-window regression: isolated profile, one persistent fake agent, native keyboard/pointer events. */
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const root = mkdtempSync(join(tmpdir(), 'buddy-popout-')), profile=join(root,'profile'), project=join(root,'project')
mkdirSync(profile);mkdirSync(project)
const launches=join(root,'launches.txt'), mock=join(root,'agent.mjs'), chatId='11111111-1111-4111-8111-111111111111'
writeFileSync(mock, `import {appendFileSync} from 'node:fs';appendFileSync(${JSON.stringify(launches)},process.pid+'\\n');process.stdin.setRawMode(true);process.stdin.resume();let line='';console.log('\\x1b[36mSAME_PROCESS:'+process.pid+'\\x1b[0m');console.log('Would you like to trust this folder? yes/no');let n=0;setInterval(()=>console.log('TICK:'+ ++n),350);process.stdin.on('data',data=>{const s=data.toString();if(s.startsWith('\\x1b[')&&!s.startsWith('\\x1b[200~'))return;for(const c of s.replace(/\\x1b\\[(200|201)~/g,'')){if(c==='\\r'){console.log('ANSWER:'+line);line=''}else{line+=c;process.stdout.write(c)}}});`)
const history=join(project,chatId+'.jsonl')
writeFileSync(history,JSON.stringify({type:'user',sessionId:chatId,cwd:project,message:{content:'Saved test'}})+'\n')
writeFileSync(join(profile,'settings.json'),JSON.stringify({reduceMotion:true,defaultShellId:'cmd',trayIcon:false,closeToTray:false,desktopNotifications:false,claudeResumeCommand:`"${process.execPath}" "${mock}" {id}`}))
writeFileSync(join(profile,'workspace.json'),JSON.stringify({layout:'grid',sessions:[{cwd:project,shellId:'cmd',title:'Persistent buddy',resume:{agent:'claude',id:chatId,path:history}},{cwd:project,shellId:'cmd',title:'Other pane'}]}))
const child=spawn(process.env.BUDDY_EXE??'node_modules/electron/dist/electron.exe',[
  ...(process.env.BUDDY_EXE?[]:['./out/main/index.js']),'--remote-debugging-port=9246','--user-data-dir='+profile
],{stdio:'ignore',windowsHide:true,env:{...process.env,HOME:root,USERPROFILE:root}})
let failures=0, main, pop
const sockets=[], errors=[]
const check=(name,ok,detail='')=>{if(!ok)failures++;console.log(`${ok?'PASS':'FAIL'} ${name}${detail?' — '+detail:''}`)}
async function pages(){return (await(await fetch('http://127.0.0.1:9246/json/list')).json()).filter(p=>p.type==='page')}
async function connect(detached=false){
  let page
  for(let i=0;i<100;i++){try{page=(await pages()).find(p=>p.url.includes('popout=')===detached);if(page)break}catch{}await sleep(100)}
  if(!page)throw Error('Window did not appear: '+detached)
  const ws=new WebSocket(page.webSocketDebuggerUrl), pending=new Map();let serial=0
  sockets.push(ws)
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject})
  ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);else if(m.method==='Runtime.consoleAPICalled')console.log('RENDERER',m.params.args.map(a=>a.value).join(' '))}
  ws.onclose=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Window closed'))}pending.clear()}
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;const timer=setTimeout(()=>{pending.delete(id);reject(Error('Timeout '+method))},10000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))})
  const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value}
  await send('Runtime.enable')
  return {send,ev}
}
async function until(client,expr){for(let i=0;i<100;i++){if(await client.ev(expr))return;await sleep(100)}throw Error('Not ready: '+expr)}
async function enter(client){await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})}
async function detach(){await main.ev("document.querySelector('.cell [data-popout]').click()");pop=await connect(true);await until(pop,"!!document.querySelector('.xterm-helper-textarea')");await sleep(250)}
async function dock(){await pop.ev("document.querySelector('[data-dock-back]').click()").catch(()=>{});await until(main,"!document.querySelector('.detached-placeholder')");await sleep(200)}
async function mouse(client,type,x,y){await client.send('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1})}
try{
  main=await connect();await until(main,"!!document.querySelector('[data-restore-all]')")
  await main.ev("window.__output='';window.buddy.pty.onData((id,data)=>window.__output+=data);document.querySelector('[data-restore-all]').click()")
  await until(main,"window.__output.includes('SAME_PROCESS:')")
  const original=readFileSync(launches,'utf8').trim()
  await main.ev("document.querySelector('.cell .xterm-helper-textarea').focus()")
  await main.send('Input.insertText',{text:'part-one-'})
  await sleep(150)
  await detach()
  check('pop out creates one extra window and preserves the workspace slot',(await pages()).length===2 && await main.ev("document.querySelectorAll('.cell').length===2 && document.querySelectorAll('.detached-placeholder').length===1"))
  check('same running process was not restarted',readFileSync(launches,'utf8').trim()===original)
  check('pop out restores prior prompt and unsent text',await pop.ev("document.body.innerText.includes('part-one-') && document.body.innerText.includes('trust this folder')"))
  check('pop out opens keyboard focused',await pop.ev("document.activeElement.classList.contains('xterm-helper-textarea')"))
  const detachedId=await main.ev("document.querySelector('.cell').dataset.sessionId")
  await main.ev(`window.buddy.pty.write(${JSON.stringify(detachedId)},'HIDDEN_VIEW_UNEXPECTED')`)
  await sleep(100)
  check('hidden workspace view cannot type into a detached terminal',await main.ev("!window.__output.includes('HIDDEN_VIEW_UNEXPECTED')"))
  await pop.send('Input.insertText',{text:'part-two'});await sleep(150);await enter(pop)
  await until(main,"window.__output.includes('ANSWER:part-one-part-two')")
  check('partially typed command continues in the pop out and submits once',await main.ev("window.__output.split('ANSWER:part-one-part-two').length===2"))
  const clipboardBefore=await pop.ev('window.buddy.clipboard.read()')
  try {
    await pop.ev("window.buddy.clipboard.write('popout-paste-once')")
    await pop.send('Input.dispatchKeyEvent',{type:'keyDown',key:'v',code:'KeyV',windowsVirtualKeyCode:86,modifiers:2})
    await pop.send('Input.dispatchKeyEvent',{type:'keyUp',key:'v',code:'KeyV',windowsVirtualKeyCode:86,modifiers:0})
    await sleep(200);await enter(pop)
    await until(main,"window.__output.includes('ANSWER:popout-paste-once')")
    check('Ctrl+V pastes once and waits for a separate Enter in the pop out',await main.ev("!window.__output.includes('ANSWER:popout-paste-oncepopout-paste-once')"))
  } finally { await pop.ev(`window.buddy.clipboard.write(${JSON.stringify(clipboardBefore)})`) }
  const startTicks=await main.ev("window.__output.match(/TICK:/g).length")
  await sleep(800)
  check('output keeps streaming while detached',await main.ev(`window.__output.match(/TICK:/g).length>${startTicks}`))
  await pop.send('Emulation.setDeviceMetricsOverride',{width:1350,height:900,deviceScaleFactor:1,mobile:false});await sleep(250)
  check('large pop out fits its native terminal',await pop.ev("(()=>{const h=document.querySelector('.detached-host').getBoundingClientRect(),t=document.querySelector('.xterm-screen').getBoundingClientRect();return t.width>1100 && t.width<h.width && t.height<h.height})()"))
  const shot=await pop.send('Page.captureScreenshot',{format:'png'});writeFileSync(join(tmpdir(),'terminal-buddy-popout.png'),Buffer.from(shot.data,'base64'))
  await pop.send('Emulation.clearDeviceMetricsOverride')
  await dock()
  check('Dock back removes only the extra window',(await pages()).length===1 && readFileSync(launches,'utf8').trim()===original)
  check('docking returns keyboard focus to the original terminal',await main.ev("document.activeElement.classList.contains('xterm-helper-textarea')"))
  await main.send('Input.insertText',{text:'after-docking'});await sleep(150);await enter(main)
  await until(main,"window.__output.includes('ANSWER:after-docking')")
  check('original terminal still takes native input after docking',true)
  await detach();await pop.ev('window.close()').catch(()=>{});await until(main,"!document.querySelector('.detached-placeholder')")
  check('closing the pop out docks instead of killing its process',readFileSync(launches,'utf8').trim()===original && (await pages()).length===1)

  const firstId=await main.ev("document.querySelector('.cell').dataset.sessionId")
  const tabs=await main.ev("[...document.querySelectorAll('.tab-title')].map(t=>{const r=t.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})")
  await mouse(main,'mousePressed',tabs[0].x,tabs[0].y);await mouse(main,'mouseMoved',tabs[1].x,tabs[1].y);await mouse(main,'mouseReleased',tabs[1].x,tabs[1].y)
  check('dragging within the tab bar still reorders terminals',await main.ev(`document.querySelectorAll('.tab')[1].dataset.sessionId===${JSON.stringify(firstId)}`))
  await mouse(main,'mousePressed',tabs[1].x,tabs[1].y);await mouse(main,'mouseMoved',tabs[0].x,tabs[0].y);await mouse(main,'mouseReleased',tabs[0].x,tabs[0].y)
  await sleep(150)

  // Actual captured pointer drag beyond the primary renderer boundary.
  const from=await main.ev("(()=>{const r=document.querySelector('.cell-head .cell-path').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,w:innerWidth}})()")
  await mouse(main,'mousePressed',from.x,from.y)
  await mouse(main,'mouseMoved',from.x+30,from.y)
  await mouse(main,'mouseMoved',from.w+70,from.y+10)
  await mouse(main,'mouseReleased',from.w+70,from.y+10)
  pop=await connect(true);await until(pop,"!!document.querySelector('.xterm-helper-textarea')")
  check('dragging a pane header outside really detaches it',await main.ev("!!document.querySelector('.detached-placeholder')"))

  // The custom grip offers deterministic cross-window dragging and a real pointer-up docking boundary.
  const target=await main.ev('({x:screenX+innerWidth/2,y:screenY+80})')
  const grip=await pop.ev("(()=>{const r=document.querySelector('[data-popout-grip]').getBoundingClientRect();return{x:r.x+20,y:r.y+15,screenX,screenY}})()")
  await mouse(pop,'mousePressed',grip.x,grip.y)
  await until(main,"!!document.querySelector('.dock-target')")
  // Browser-generated screen coordinates are tested through the public drag bridge
  // after pointer capture; the move is native setPosition, not a CSS mock.
  await pop.ev(`window.buddy.popout.drag(new URLSearchParams(location.search).get('popout'),'move',${JSON.stringify(target)})`)
  await until(main,"!!document.querySelector('.dock-target.is-over')")
  await pop.ev(`window.buddy.popout.drag(new URLSearchParams(location.search).get('popout'),'end',${JSON.stringify(target)})`).catch(()=>{})
  await until(main,"!document.querySelector('.detached-placeholder')")
  check('dropping onto the highlighted docking strip returns the same session',readFileSync(launches,'utf8').trim()===original)
  check('docking clears the drop target',await main.ev("!document.querySelector('.dock-target')"))

  await detach()
  await main.ev("document.querySelector('.cell [data-popout]').click()")
  check('repeated pop-out clicks focus the existing window without duplicating it',(await pages()).length===2)
  const secondId=await main.ev("document.querySelectorAll('.cell')[1].dataset.sessionId")
  await pop.ev(`window.buddy.pty.write(${JSON.stringify(secondId)},'echo CROSS_WINDOW_INPUT\\r');window.buddy.pty.kill(${JSON.stringify(secondId)})`)
  await sleep(150)
  check('pop-out input and close actions cannot target another terminal',await main.ev("!window.__output.includes('CROSS_WINDOW_INPUT') && document.querySelectorAll('.cell')[1].querySelector('.pane').classList.contains('is-exited')===false"))
  await main.ev("document.querySelectorAll('.cell [data-popout]')[1].click()")
  for(let i=0;i<50 && (await pages()).length!==3;i++)await sleep(100)
  check('two independent terminals can be popped out at once',(await pages()).length===3)
  await main.ev(`window.buddy.popout.dock(${JSON.stringify(secondId)})`)
  await until(main,"document.querySelectorAll('.detached-placeholder').length===1")
  check('docking one pop-out leaves the other running',(await pages()).length===2 && readFileSync(launches,'utf8').trim()===original)
  await pop.send('Page.reload');await until(pop,"!!document.querySelector('.xterm-helper-textarea')")
  await sleep(300)
  check('reloading a pop out reconnects to the same live process',readFileSync(launches,'utf8').trim()===original)
  check('workspace persistence still includes detached chats once',await main.ev(`window.buddy.workspace.get().then(w=>w.sessions.length===2 && w.sessions[0].resume.id===${JSON.stringify(chatId)})`))
  await main.ev('window.close()').catch(()=>{})
  for(let i=0;i<100 && child.exitCode===null;i++)await sleep(100)
  check('exiting the main app closes its detached windows too',child.exitCode!==null)
  check('app exit retains both sessions for recovery',JSON.parse(readFileSync(join(profile,'workspace.json'),'utf8')).sessions.length===2)
  check('no renderer exceptions',errors.length===0,errors.join(' | '))
}catch(error){check('harness',false,error.stack);try{console.log('PRIMARY OUTPUT',await main.ev('window.__output'));console.log('POPOUT',await pop.ev('document.body.innerText'))}catch{}}
finally{
  for(const socket of sockets)socket.close()
  if(child.exitCode===null)child.kill()
  await sleep(800)
  rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:250})
  console.log(failures?`${failures} pop-out checks failed`:'All pop-out checks passed')
  process.exit(failures?1:0)
}
