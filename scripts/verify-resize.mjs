/** Real mouse regressions for short drags, edge panes, capture, fitting and saved proportions. */
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const profile = mkdtempSync(join(tmpdir(), 'buddy-resize-'))
writeFileSync(join(profile,'settings.json'),JSON.stringify({desktopNotifications:false,defaultShellId:'cmd',trayIcon:false}))
writeFileSync(join(profile,'workspace.json'),JSON.stringify({layout:'grid',sessions:[1,2].map(i=>({cwd:profile,shellId:'cmd',title:'Resize '+i}))}))
const exe=process.env.BUDDY_EXE ?? 'node_modules/electron/dist/electron.exe'
const pending=new Map(), errors=[]
let child,ws,serial=0,failures=0
const check=(label,ok,detail='')=>{if(!ok)failures++;console.log(`${ok?'PASS':'FAIL'} ${label}${detail?' — '+detail:''}`)}
async function send(method,params={}) {
  const id=++serial
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(Error('Timeout '+method))},10000)
    pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))
  })
}
async function ev(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value}
async function until(expr){for(let i=0;i<100;i++){if(await ev(expr))return;await sleep(100)}throw Error('Not ready: '+expr)}
async function launch(){
  child=spawn(exe,[...(process.env.BUDDY_EXE?[]:['./out/main/index.js']),'--remote-debugging-port=9242','--user-data-dir='+profile],{stdio:'ignore',windowsHide:true})
  let page
  for(let i=0;i<100;i++){try{page=(await(await fetch('http://127.0.0.1:9242/json/list')).json()).find(p=>p.type==='page');if(page)break}catch{}await sleep(100)}
  if(!page)throw Error('App failed to start')
  ws=new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject})
  ws.onmessage=e=>{
    const m=JSON.parse(e.data),p=pending.get(m.id)
    if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}
    else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text)
  }
  await send('Runtime.enable')
  await until("!!document.querySelector('[data-restore-all]') || document.querySelectorAll('.cell').length>=2")
  await ev("document.querySelector('[data-restore-all]')?.click()")
  await until("document.querySelectorAll('.cell').length>=2 && !document.querySelector('.boot')")
  await sleep(500)
}
async function shutdown(){ws?.close();child?.kill();await sleep(900)}
async function mode(name){await ev(`[...document.querySelectorAll('.seg button')].find(b=>b.textContent===${JSON.stringify(name)}).click()`);await sleep(350)}
async function lock(){await ev(`[...document.querySelectorAll('.topbar button')].find(b=>b.title.startsWith('Layout ')).click()`);await sleep(150)}
async function geometry(){return ev(`Array.from(document.querySelectorAll('.cell')).map(c=>{const r=c.getBoundingClientRect();return {id:c.dataset.sessionId,x:r.x,y:r.y,w:r.width,h:r.height}})`)}
async function point(axis,index=0){return ev(`(()=>{const h=document.querySelector('.grid-divider[data-axis="${axis}"][data-divider-index="${index}"] span');const r=h.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)}
async function mouse(type,p){await send('Input.dispatchMouseEvent',{type,...p,button:'left',buttons:type==='mouseMoved'?1:undefined,clickCount:1})}
async function drag(axis,delta,index=0){const p=await point(axis,index);await mouse('mousePressed',p);for(let i=1;i<=8;i++){await mouse('mouseMoved',{x:p.x+(axis==='columns'?delta*i/8:0),y:p.y+(axis==='rows'?delta*i/8:0)});await sleep(15)}await sleep(100);const during=await geometry();await mouse('mouseReleased',{x:p.x+(axis==='columns'?delta:0),y:p.y+(axis==='rows'?delta:0)});await sleep(150);return during}
async function newTerminal(){await ev("document.querySelector('.tab-new').click()");await until("!!document.querySelector('[data-new-kind=shell]:not(:disabled)')");await ev("document.querySelector('[data-new-kind=shell]').click()");await until("!document.querySelector('.new-session-dialog')");await sleep(200)}

try{
  await launch()
  check('locked grid has no draggable dividers',await ev("!document.querySelector('.grid-divider')"))
  await lock()
  check('two panes expose one visible vertical divider, not corner handles',await ev("document.querySelectorAll('.grid-divider.is-vertical').length===1 && !document.querySelector('.cell-resize')"))
  await ev("window.__termNodes=[...document.querySelectorAll('.xterm-helper-textarea')]")
  const before=await geometry()
  const after=await drag('columns',24)
  check('24px drag resizes immediately before release',Math.abs(after[0].w-before[0].w-24)<2)
  check('rightmost pane shrinks by the same amount',Math.abs(after[1].w-before[1].w+24)<2)
  const reversed=await drag('columns',-80)
  check('rightmost pane can grow by dragging the shared divider left',Math.abs(reversed[1].w-after[1].w-80)<2)
  const clamp=await drag('columns',-600)
  check('minimum width keeps both terminals visible',clamp.every(c=>c.w>=159))
  await send('Emulation.setDeviceMetricsOverride',{width:700,height:650,deviceScaleFactor:1,mobile:false})
  await sleep(200)
  check('minimum widths also hold when the viewport shrinks', (await geometry()).every(c=>c.w>=159))
  check('minimum-clamped tracks still fill the viewport',await ev(`(()=>{const cells=[...document.querySelectorAll('.cell')].map(c=>c.getBoundingClientRect());const area=document.querySelector('.area').getBoundingClientRect();return Math.abs(cells[1].right-area.right+4)<2})()`))
  const smallBefore=await geometry(),smallAfter=await drag('columns',24)
  check('dragging from a clamped size does not jump',Math.abs(smallAfter[0].w-smallBefore[0].w-24)<2,JSON.stringify({before:smallBefore,after:smallAfter}))
  await send('Emulation.clearDeviceMetricsOverride')
  await sleep(200)
  await ev("document.querySelector('.grid-divider').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))")
  await sleep(150)
  const balanced=await geometry()
  check('double click balances adjacent widths',Math.abs(balanced[0].w-balanced[1].w)<2)
  await ev("document.querySelector('.grid-divider').focus()")
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39})
  await sleep(100)
  const keyed=await geometry()
  check('keyboard arrow adjusts divider by 8px',Math.abs(keyed[0].w-balanced[0].w-8)<2)
  check('resizing never remounts the terminal input nodes',await ev("window.__termNodes.every((node,i)=>node===document.querySelectorAll('.xterm-helper-textarea')[i])"))
  await mode('Tabs');await mode('Grid')
  const returned=await geometry()
  check('sizes survive Tabs to Grid',Math.abs(returned[0].w-keyed[0].w)<2)
  const p=await point('columns');await mouse('mousePressed',p)
  await mouse('mouseMoved',{x:p.x+30,y:p.y});await sleep(80)
  await ev("document.querySelector('.grid-divider').dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:1}))")
  const cancelled=await geometry()
  await mouse('mouseMoved',{x:p.x+90,y:p.y});await mouse('mouseReleased',{x:p.x+90,y:p.y})
  const stopped=await geometry()
  check('pointer cancellation stops resizing',Math.abs(stopped[0].w-cancelled[0].w)<2)
  await lock()
  await ev("window.__output='';window.buddy.pty.onData((id,data)=>window.__output+=data)")
  await send('Input.insertText',{text:'echo RESIZE_KEY_OK'})
  await sleep(150)
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
  await until("window.__output.includes('RESIZE_KEY_OK')")
  check('relocking restores native keyboard input',await ev("document.activeElement.classList.contains('xterm-helper-textarea') && !document.querySelector('.grid-divider')"))
  await newTerminal();await newTerminal()
  await until("document.querySelectorAll('.cell').length===4")
  await lock()
  const rowsBefore=await geometry()
  const rowsAfter=await drag('rows',-24)
  check('bottom row grows with a short upward divider drag',Math.abs(rowsAfter[2].h-rowsBefore[2].h-24)<2)
  check('top row shrinks without changing total height',Math.abs(rowsAfter[0].h-rowsBefore[0].h+24)<2)
  await sleep(500)
  check('xterm rendering fits the resized panes',await ev(`[...document.querySelectorAll('.cell')].every(c=>{const p=c.querySelector('.pane-host').getBoundingClientRect(),t=c.querySelector('.xterm-screen').getBoundingClientRect();return t.width>50 && t.width<=p.width+1 && t.height<=p.height+1})`))
  const saved=await ev('window.buddy.workspace.get().then(w=>w.gridSizes)')
  check('both axes are saved as proportions',saved.columns.length===2 && saved.rows.length===2 && saved.rows[0]!==saved.rows[1])
  const ratio=rowsAfter[0].w/rowsAfter[1].w
  await send('Emulation.setDeviceMetricsOverride',{width:1100,height:760,deviceScaleFactor:1,mobile:false})
  await sleep(350)
  const smaller=await geometry()
  check('viewport resizing keeps proportions when not minimum-clamped',Math.abs(smaller[0].w/smaller[1].w-ratio)<0.015)
  const shot=await send('Page.captureScreenshot',{format:'png'})
  writeFileSync(join(tmpdir(),'terminal-buddy-dividers.png'),Buffer.from(shot.data,'base64'))
  await shutdown();await launch();await until("document.querySelectorAll('.cell').length===4")
  const restored=await geometry()
  check('proportions survive an app restart',Math.abs(restored[0].w/restored[1].w-saved.columns[0]/saved.columns[1])<0.015 && Math.abs(restored[0].h/restored[2].h-saved.rows[0]/saved.rows[1])<0.015)
  check('no renderer exceptions',errors.length===0,errors.join(' | '))
}catch(error){check('harness',false,error.message)}
finally{await shutdown();rmSync(profile,{recursive:true,force:true,maxRetries:8,retryDelay:250});console.log(failures?`${failures} checks failed`:'All resize checks passed');process.exit(failures?1:0)}
