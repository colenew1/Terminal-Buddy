/** Real import/drop/keyboard regressions. Isolated history; echo replaces paid agent launches. */
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, utimesSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const root = mkdtempSync(join(tmpdir(), 'buddy-import-'))
const testHome = join(root, 'home'), profile = join(root, 'profile'), project = join(root, 'actual-project')
for (const dir of [testHome, profile, project]) mkdirSync(dir, { recursive: true })
const bin = join(root, 'bin')
mkdirSync(bin)
const mockAgent = join(bin, 'mock-agent.mjs')
writeFileSync(mockAgent, `
process.stdin.setRawMode(true)
process.stdin.resume()
let line = ''
let lastPaste = 0
process.stdout.write('Would you like to trust this folder? [yes/no]\\r\\n')
process.stdout.write('\\x1b[36mCYAN_PROMPT\\x1b[0m \\x1b[32mGREEN_REPLY\\x1b[0m \\x1b[33mYELLOW_ACTIVITY\\x1b[0m\\r\\n')
process.stdout.write('COLOR_ENV:' + process.env.NO_COLOR + ':' + process.env.FORCE_COLOR + ':' + process.env.COLORTERM + '\\r\\n')
process.stdin.on('data', data => {
  const text = data.toString()
  if (text.length > 1 && !text.startsWith('\\x1b')) lastPaste = Date.now()
  if (text.startsWith('\\x1b') || text === '\\x03') {
    process.stdout.write('\\r\\nKEY:' + data.toString('hex') + '\\r\\n')
    return
  }
  for (const ch of text) {
    if (ch === '\\r') {
      if (Date.now() - lastPaste < 120) { process.stdout.write('\\r\\nEARLY_ENTER_IGNORED\\r\\n'); continue }
      process.stdout.write('\\r\\nREPLY:' + line + '\\r\\nNext command or answer: '); line = ''
    }
    else line += ch
  }
})
`)
const mockCommand = '"' + process.execPath + '" "' + mockAgent + '"'
for (const agent of ['claude','codex']) {
  writeFileSync(join(bin, agent+'.cmd'), `@echo FRESH_${agent}_ARGS:%*\r\n@${mockCommand}\r\n`)
}
writeFileSync(join(profile, 'settings.json'), JSON.stringify({
  claudeResumeCommand: mockCommand, codexResumeCommand: mockCommand, trayIcon: false,
  walkthroughVersion: 1, defaultShellId: 'cmd', desktopNotifications: false
}))
const claudeDir = join(testHome, '.claude', 'projects', project.replace(/[^A-Za-z0-9]/g, '-'))
const codexDir = join(testHome, '.codex', 'sessions', '2025', '01', '01')
mkdirSync(claudeDir, { recursive: true }); mkdirSync(codexDir, { recursive: true })
const claudeFile = join(claudeDir, '11111111-1111-4111-8111-111111111111.jsonl')
const old = '2025-01-01T12:00:00Z'
const rows = [{ type:'ai-title', aiTitle:'Imported Claude history' }]
for (let i = 0; i < 100; i++) rows.push({ type:i % 2 ? 'assistant' : 'user', timestamp:old, cwd:project,
  message:{content:`History line ${i}: ` + 'This is a long conversation to test reopening at the bottom. '.repeat(6)} })
writeFileSync(claudeFile, rows.map(JSON.stringify).join('\n')+'\n')
const codexFile = join(codexDir, 'rollout-2025-01-01T12-00-00-22222222-2222-4222-8222-222222222222.jsonl')
writeFileSync(codexFile, [
  { type:'session_meta', timestamp:old, payload:{id:'22222222-2222-4222-8222-222222222222',cwd:project} },
  { type:'event_msg', timestamp:old, payload:{type:'user_message',message:'Imported Codex history'} },
  { type:'event_msg', timestamp:old, payload:{type:'agent_message',message:'Codex saved reply'} }
].map(JSON.stringify).join('\n')+'\n')
utimesSync(claudeFile, new Date(old), new Date(old)); utimesSync(codexFile, new Date(old), new Date(old))

const port = 9238
const child = spawn(process.env.BUDDY_EXE ?? 'node_modules/electron/dist/electron.exe', [
  ...(process.env.BUDDY_EXE ? [] : ['./out/main/index.js']), `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`
], { windowsHide: true, stdio:'ignore', env:{...process.env, PATH:bin+';'+process.env.PATH, HOME:testHome, USERPROFILE:testHome,
  CODEX_HOME: join(testHome, '.codex'), CLAUDE_CONFIG_DIR: join(testHome, '.claude')} })
let ws, failures = 0, serial = 0
const pending = new Map(), errors = []
const check = (label, ok, detail='') => { if (!ok) failures++; console.log(`${ok?'PASS':'FAIL'} ${label}${detail ? ' — '+detail : ''}`) }
function send(method, params={}) {
  return new Promise((resolve,reject) => {
    const id = ++serial
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(method+' timeout')) },10000)
    pending.set(id,{resolve,reject,timeout}); ws.send(JSON.stringify({id,method,params}))
  })
}
async function newTerminal(selector = '.tab-new') {
  await ev(`document.querySelector(${JSON.stringify(selector)}).click()`)
  for (let i=0;i<60;i++) {
    if (await ev(`!!document.querySelector('[data-new-kind="shell"]:not(:disabled)')`)) break
    await sleep(50)
  }
  await ev(`document.querySelector('[data-new-kind="shell"]').click()`)
}

async function ev(expression) {
  const r = await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'evaluation error')
  return r.result.value
}
async function until(expression) {
  for (let i=0;i<60;i++) { if (await ev(expression)) return; await sleep(100) }
  throw new Error('Timed out: '+expression)
}
async function type(text) {
  for (const key of text) {
    const code = `Key${key.toUpperCase()}`, windowsVirtualKeyCode=key.toUpperCase().charCodeAt(0)
    await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,text:key,windowsVirtualKeyCode})
    await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode})
  }
}
async function key(name, code, modifiers=0) {
  const physicalCode = /^[a-z]$/i.test(name) ? `Key${name.toUpperCase()}` : name
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:name,code:physicalCode,windowsVirtualKeyCode:code,modifiers})
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:name,code:physicalCode,windowsVirtualKeyCode:code,modifiers})
}
async function button(label) {
  await ev(`[...document.querySelectorAll('.topbar button')].find(b=>b.textContent===${JSON.stringify(label)})?.click()`)
  await sleep(100)
}
async function drop(title, target='.cell.is-active') {
  await ev(`(() => {
    const row=[...document.querySelectorAll('.sidebar .row')].find(r=>r.querySelector('.row-title')?.textContent===${JSON.stringify(title)})
    if (!row) throw new Error('Missing chat row')
    const dt=new DataTransfer(); row.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}))
    const cell=document.querySelector(${JSON.stringify(target)})
    for (const type of ['dragenter','dragover','drop']) cell.dispatchEvent(new DragEvent(type,{bubbles:true,dataTransfer:dt}))
    row.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}))
  })()`)
}

try {
  let page
  for(let i=0;i<60;i++) {
    try { page=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p=>p.type==='page'); if(page) break } catch {}
    await sleep(200)
  }
  if(!page) throw new Error('App failed to start')
  ws=new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject})
  ws.onmessage=event=>{
    const m=JSON.parse(event.data), p=pending.get(m.id)
    if(p) {clearTimeout(p.timeout);pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result)}
    else if(m.method==='Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text)
  }
  await send('Runtime.enable')
  await until(`!!document.querySelector('[data-new-kind="shell"]:not(:disabled)')`)
  check('fresh launch shows four choices without starting a terminal',await ev(`document.querySelectorAll('.new-session-choices > button').length===4 && !document.querySelector('.cell')`))
  check('startup explicitly offers a base terminal',await ev(`document.querySelector('[data-new-kind="shell"]').textContent.includes('Start a base terminal')`))
  await ev(`document.querySelector('[data-new-kind="shell"]').click()`)
  await until(`!!document.querySelector('.xterm-helper-textarea')`)
  const droppedFile = join(project, 'file with spaces.png')
  writeFileSync(droppedFile, readFileSync('resources/icon.png'))
  await send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] })
  await ev(`navigator.clipboard.write([new ClipboardItem({'image/png':new Blob([Uint8Array.from(atob(${JSON.stringify(readFileSync(droppedFile).toString('base64'))}),c=>c.charCodeAt(0))],{type:'image/png'})})])`)
  check('clipboard fixture starts as an image', await ev(`navigator.clipboard.read().then(items=>items.some(item=>item.types.includes('image/png')))`))
  const dropFiles = async () => {
    const point = await ev(`(() => { const r=document.querySelector('.cell.is-active .pane-host').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2} })()`)
    for (const type of ['dragEnter','dragOver','drop']) await send('Input.dispatchDragEvent', {type,...point,data:{items:[],files:[droppedFile],dragOperationsMask:1}})
    await until(`!!document.querySelector('[data-copy-path]')`)
  }
  await dropFiles()
  check('native file drop resolves an absolute disk path through the preload bridge',await ev(`document.querySelector('.file-drop-actions code').textContent===${JSON.stringify(droppedFile)}`))
  await ev(`document.querySelector('[data-copy-path]').click()`)
  await until(`!document.querySelector('[data-copy-path]')`)
  check('Copy as Path writes quoted plain text, including image filenames and spaces',await ev(`window.buddy.clipboard.read().then(text=>text===${JSON.stringify('"'+droppedFile+'"')})`))
  check('Copy as Path removes the previous clipboard image',await ev(`navigator.clipboard.read().then(items=>items.some(item=>item.types.includes('text/plain'))&&!items.some(item=>item.types.includes('image/png')))`))
  const width = await ev(`document.querySelector('.tab').getBoundingClientRect().width`)
  await ev(`document.querySelector('.tab').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`)
  await until(`!!document.querySelector('.tab-rename')`)
  await ev(`const input=document.querySelector('.tab-rename'); input.value='A much longer terminal title while output is active'; input.dispatchEvent(new FocusEvent('focusout',{bubbles:true}))`)
  await sleep(100)
  check('tab width stays fixed when its content changes',await ev(`document.querySelector('.tab').getBoundingClientRect().width===${width}`))
  await ev(`document.querySelector('.cell.is-active .xterm-helper-textarea').focus()`)
  await ev(`window.__output={}; window.buddy.pty.onData((id,data)=>{window.__output[id]=(window.__output[id]??'')+data})`)
  await ev(`window.__feed={}; window.buddy.feed.onEvents((id,events)=>{window.__feed[id]=[...(window.__feed[id]??[]),...events]})`)
  const legacy = await ev(`window.buddy.pty.create({cwd:${JSON.stringify(project)},shellId:'cmd',initialCommand:${JSON.stringify(mockCommand)}})`)
  await until(`window.__output[${JSON.stringify(legacy.id)}]?.includes('Would you like to trust this folder?')`)
  await ev(`window.buddy.pty.write(${JSON.stringify(legacy.id)},'legacy\\r')`)
  await until(`window.__output[${JSON.stringify(legacy.id)}]?.includes('EARLY_ENTER_IGNORED')`)
  check('old text-plus-Enter burst reproduces text inserted but not submitted',await ev(`!window.__output[${JSON.stringify(legacy.id)}].includes('REPLY:legacy')`))
  await sleep(150)
  await ev(`window.buddy.pty.write(${JSON.stringify(legacy.id)},'\\r')`)
  await until(`window.__output[${JSON.stringify(legacy.id)}]?.includes('REPLY:legacy')`)
  check('a later standalone Enter submits the old burst, matching the report',true)
  await ev(`window.buddy.pty.kill(${JSON.stringify(legacy.id)})`)
  check('new panes show a live, keyboard-focused terminal',await ev(`!document.querySelector('.agent') && document.activeElement.classList.contains('xterm-helper-textarea')`),await ev(`document.activeElement.outerHTML.slice(0,250)`))
  await button('Grid')
  await ev(`document.querySelector('.topbar button[title^="Catalog"]')?.click()`)
  await until(`document.querySelectorAll('.sidebar .row').length===2`)
  writeFileSync(join(claudeDir, '33333333-3333-4333-8333-333333333333.jsonl'), JSON.stringify({type:'user',timestamp:'2026-09-06T00:00:00Z',cwd:project,message:{content:'Automatically discovered chat'}})+'\n')
  await ev(`window.dispatchEvent(new Event('focus'))`)
  await until(`document.querySelector('.sidebar .row-title')?.textContent==='Automatically discovered chat'`)
  check('returning to the app rescans and puts the most recently used chat first',true)
  const before=await ev(`document.querySelector('.cell.is-active').dataset.sessionId`)
  const originalHistory = readFileSync(claudeFile,'utf8')
  await drop('Imported Claude history')
  await until(`document.querySelector('.cell.is-active')?.dataset.sessionId!==${JSON.stringify(before)}`)
  const importedId=await ev(`document.querySelector('.cell.is-active').dataset.sessionId`)
  await until(`window.__output[${JSON.stringify(importedId)}]?.includes('Would you like to trust this folder?')`)
  check('drop replaces only the empty terminal',await ev(`document.querySelectorAll('.cell').length===1`))
  check('live approval prompt is not covered by a transcript',await ev(`!document.querySelector('.cell.is-active .agent') && !document.querySelector('.cell.is-active .pane').inert`))
  check('color suppression is removed from the real child process',await ev(`window.__output[${JSON.stringify(importedId)}].includes('COLOR_ENV:undefined:3:truecolor')`))
  const colorOutput = await ev(`window.__output[${JSON.stringify(importedId)}]`)
  check('ConPTY delivers native color escapes with the output',/\x1b\[36m\s*CYAN_PROMPT/.test(colorOutput))
  check('no transcript switch or overlay remains',await ev(`!document.querySelector('.transcript-view') && ![...document.querySelectorAll('.cell-head button')].some(b=>b.textContent==='Transcript')`))
  await sleep(500)
  check('import restores the saved project folder',await ev(`window.buddy.workspace.get().then(w=>w.sessions[0].cwd===${JSON.stringify(project)})`))
  await ev(`document.querySelector('.cell.is-active .session-name-button').click()`)
  await until(`!!document.querySelector('.session-rename')`)
  await send('Input.insertText',{text:"Praveen's persona"})
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
  await sleep(500)
  check('terminal header and tab show the custom name',await ev(`document.querySelector('.cell.is-active .session-name-button').textContent.includes("Praveen's persona") && document.querySelector('.tab-title').textContent==="Praveen's persona"`))
  check('custom name is persisted for reopening',await ev(`window.buddy.workspace.get().then(w=>w.sessions[0].title==="Praveen's persona")`))
  check('renaming never changes the underlying saved chat',readFileSync(claudeFile,'utf8')===originalHistory)
  const promptScreenshot=await send('Page.captureScreenshot',{format:'png'})
  writeFileSync(join(tmpdir(),'terminal-buddy-live-prompt.png'),Buffer.from(promptScreenshot.data,'base64'))
  await ev(`document.querySelector('.cell.is-active .xterm-helper-textarea').focus()`)
  await type('yes')
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
  await until(`window.__output[${JSON.stringify(importedId)}]?.includes('REPLY:yes')`)
  check('yes/no answers submit directly in the native terminal',true)
  check('terminal retains keyboard focus after submission',await ev(`document.activeElement.classList.contains('xterm-helper-textarea')`))
  await type('/help')
  await key('Enter',13)
  await until(`window.__output[${JSON.stringify(importedId)}]?.includes('REPLY:/help')`)
  check('slash commands use the same native terminal input',true)
  for (const [name,code,hex,modifiers] of [['ArrowDown',40,'1b5b42',0],['ArrowUp',38,'1b5b41',0],['Escape',27,'1b',0],['c',67,'03',2]]) {
    await key(name,code,modifiers)
    await until(`window.__output[${JSON.stringify(importedId)}]?.includes(${JSON.stringify('KEY:'+hex)})`)
  }
  check('menu arrows, Escape, and interrupt reach the terminal',true)
  await until(`!!document.querySelector('.cell.is-active .terminal-status.is-attention')`)
  check('paused output requests a look without claiming task completion',await ev(`document.querySelector('.cell.is-active .terminal-status').textContent==='Take a look' && document.querySelector('.cell.is-active').classList.contains('needs-look')`))
  await ev(`document.querySelector('.cell.is-active .xterm-helper-textarea').focus()`)
  await until(`document.activeElement.classList.contains('xterm-helper-textarea')`)
  await type('nativekeys')
  await key('Enter',13)
  await until(`window.__output[${JSON.stringify(importedId)}]?.includes('REPLY:nativekeys')`)
  check('native keyboard input still submits directly',true)
  check('fresh output is visibly distinguished from a quiet terminal',await ev(`document.querySelector('.cell.is-active .terminal-status').textContent==='Output active'`))
  for (const answer of ['no','1','2','3']) {
    await type(answer); await key('Enter',13)
    await until(`window.__output[${JSON.stringify(importedId)}]?.includes(${JSON.stringify('REPLY:'+answer)})`)
  }
  check('no and numbered menu answers use the same input without changing views',true)
  await send('Input.insertText',{text:'dictated words'})
  await sleep(200)
  check('dictation-style text insertion does not submit automatically',await ev(`!window.__output[${JSON.stringify(importedId)}].includes('REPLY:dictated words')`))
  await key('Enter',13)
  await until(`window.__output[${JSON.stringify(importedId)}]?.includes('REPLY:dictated words')`)
  check('dictation-style insertion can be submitted in the native terminal',true)
  await ev(`(() => {
    const data=new DataTransfer(); data.setData('text/plain','pasted words')
    document.querySelector('.cell.is-active .xterm-helper-textarea').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:data}))
  })()`)
  await sleep(200)
  check('paste does not append Enter',await ev(`!window.__output[${JSON.stringify(importedId)}].includes('REPLY:pasted words')`))
  await key('Enter',13)
  await until(`window.__output[${JSON.stringify(importedId)}]?.includes('REPLY:pasted words')`)
  await dropFiles()
  await ev(`document.querySelector('[data-paste-path]').click()`)
  await sleep(200)
  const pathReply = 'REPLY:"' + droppedFile + '"'
  check('Paste path does not submit automatically', await ev(`!window.__output[${JSON.stringify(importedId)}].includes(${JSON.stringify(pathReply)})`))
  await key('Enter',13)
  await until(`window.__output[${JSON.stringify(importedId)}]?.includes(${JSON.stringify(pathReply)})`)
  check('Paste path reaches the native agent intact and submits only on Enter', true)
  check('pasted text submits once with native Enter',true)
  await drop('Imported Codex history'); await sleep(300)
  check('occupied terminal cannot be overwritten',await ev(`document.querySelector('.cell.is-active').dataset.sessionId===${JSON.stringify(importedId)}`))
  await button('Tabs')
  await newTerminal()
  await until(`document.querySelectorAll('.cell').length===2`)
  await ev(`document.querySelector('.cell.is-active .xterm-helper-textarea').focus()`); await type('draft')
  const draftId=await ev(`document.querySelector('.cell.is-active').dataset.sessionId`)
  await drop('Imported Codex history'); await sleep(300)
  check('unsent native input protects a terminal from being overwritten',await ev(`document.querySelector('.cell.is-active').dataset.sessionId===${JSON.stringify(draftId)}`))
  await ev(`document.querySelector('.tab').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`)
  await ev(`[...document.querySelectorAll('.sidebar .row')].find(r=>r.querySelector('.row-title')?.textContent==='Imported Codex history').querySelector('.primary').click()`)
  await until(`document.querySelectorAll('.cell').length===3`)
  const codexId=await ev(`document.querySelector('.cell.is-active').dataset.sessionId`)
  await until(`window.__feed[${JSON.stringify(codexId)}]?.some(e=>e.text==='Codex saved reply')`)
  appendFileSync(codexFile,JSON.stringify({type:'event_msg',timestamp:new Date().toISOString(),payload:{type:'agent_message',message:'New live reply'}})+'\n')
  await until(`window.__feed[${JSON.stringify(codexId)}]?.some(e=>e.text==='New live reply')`)
  check('background telemetry follows its exact file without duplicates',await ev(`window.__feed[${JSON.stringify(codexId)}].length===3`))
  await newTerminal()
  await until(`document.querySelectorAll('.cell').length===4`)
  await button('Grid'); await drop('Imported Claude history')
  await until(`!!document.querySelector('.cell.is-active .xterm-helper-textarea')`)
  check('grid import opens a live terminal',await ev(`!document.querySelector('.cell.is-active .agent')`))
  await ev(`document.querySelector('.cell.is-active .session-name-button').click()`)
  await until(`!!document.querySelector('.session-rename')`)
  await send('Input.insertText',{text:'Grid persona'})
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
  check('names are editable directly on grid panes',await ev(`document.querySelector('.cell.is-active .session-name-button').textContent.includes('Grid persona')`))
  await newTerminal()
  await until(`document.querySelectorAll('.cell').length===5`)
  check('grid plus opens a keyboard-ready terminal',await ev(`document.activeElement.classList.contains('xterm-helper-textarea')`))
  check('only native terminal inputs exist in every pane',await ev(`document.querySelectorAll('.cell textarea').length===5 && !document.querySelector('.terminal-entry, .composer-input, .composer-send')`))
  // A plus is a decision, not a half-open terminal in the current project.
  await ev(`document.querySelector('.tab').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`)
  await ev(`document.querySelector('.tab-new').click()`)
  await until(`document.querySelector('[data-new-cwd]')?.textContent===${JSON.stringify(testHome)}`)
  check('plus opens a chooser without creating a terminal',await ev(`document.querySelectorAll('.cell').length===5 && !!document.querySelector('.new-session-dialog[open]')`))
  check('plus defaults to home, not the active imported project',await ev(`document.querySelector('.cell.is-active').dataset.sessionId===${JSON.stringify(importedId)} && document.querySelector('[data-new-cwd]').textContent===${JSON.stringify(testHome)}`))
  check('chooser offers new chat, shell, folder selection, and saved chats',await ev(`document.querySelectorAll('.new-session-choices > button').length===4 && !!document.querySelector('[data-new-chat]') && !!document.querySelector('[data-new-folder]') && !!document.querySelector('[data-new-resume]')`))
  const chooserShot=await send('Page.captureScreenshot',{format:'png'})
  writeFileSync(join(tmpdir(),'terminal-buddy-new-session.png'),Buffer.from(chooserShot.data,'base64'))
  await key('Escape',27)
  await until(`!document.querySelector('.new-session-dialog')`)
  check('cancelling creates nothing and returns terminal focus',await ev(`document.querySelectorAll('.cell').length===5 && document.activeElement.classList.contains('xterm-helper-textarea')`))
  await ev(`document.querySelector('.tab-new').click()`)
  await until(`!!document.querySelector('[data-new-resume]')`)
  await ev(`document.querySelector('[data-new-resume]').click()`)
  await until(`!document.querySelector('.new-session-dialog') && !!document.activeElement.closest('.sidebar')`)
  check('resume opens saved chats directly without a spare terminal',await ev(`document.querySelectorAll('.cell').length===5 && document.querySelectorAll('.sidebar .row').length===3`))
  await key('t',84,10)
  await until(`!!document.querySelector('.new-session-dialog[open]')`)
  check('new-terminal keyboard shortcut uses the same chooser',await ev(`document.querySelectorAll('.cell').length===5`))
  await ev(`document.querySelector('[data-new-cancel]').click()`)
  for (const [index,agent] of ['claude','codex'].entries()) {
    await ev(`document.querySelector('.tab-new').click()`)
    await until(`!!document.querySelector('[data-new-chat]')`)
    await ev(`document.querySelector('[data-new-chat]').click()`)
    await until(`!!document.querySelector('[data-new-kind="${agent}"]:not(:disabled)')`)
    await ev(`(() => { const b=document.querySelector('[data-new-kind="${agent}"]'); b.click(); b.click() })()`)
    await until(`!document.querySelector('.new-session-dialog') && document.querySelectorAll('.cell').length===${6+index}`)
    const newId=await ev(`document.querySelector('.cell.is-active').dataset.sessionId`)
    await until(`window.__output[${JSON.stringify(newId)}]?.includes('FRESH_${agent}_ARGS:')`)
    await until(`window.__output[${JSON.stringify(newId)}]?.includes('Would you like to trust this folder?')`)
    await sleep(500)
    check(`fresh ${agent} starts once in home without a resume command`,await ev(`window.buddy.workspace.get().then(w=>w.sessions.find(s=>s.title===${JSON.stringify(agent==='claude'?'New Claude chat':'New Codex chat')})?.cwd===${JSON.stringify(testHome)})`) && await ev(`!window.__output[${JSON.stringify(newId)}].includes('--resume') && document.querySelectorAll('.cell').length===${6+index}`))
    check(`fresh ${agent} is keyboard ready`,await ev(`document.activeElement.classList.contains('xterm-helper-textarea')`))
  }
  await ev(`document.querySelector('[data-rename-chat="11111111-1111-4111-8111-111111111111"]').click()`)
  await until(`!!document.querySelector('dialog[open] [data-chat-name]')`)
  check('rename dialog focuses and selects its current name',await ev(`document.activeElement===document.querySelector('[data-chat-name]') && document.activeElement.selectionStart===0 && document.activeElement.selectionEnd===document.activeElement.value.length`))
  await send('Input.insertText',{text:'Admin Panel Main Chat'})
  check('rename field accepts the chosen name',await ev(`document.querySelector('[data-chat-name]').value==='Admin Panel Main Chat'`))
  await ev(`document.querySelector('[data-save-chat-name]').click()`)
  await until(`!document.querySelector('[data-chat-name]') && [...document.querySelectorAll('.sidebar .row-title')].some(e=>e.textContent==='Admin Panel Main Chat')`)
  check('saved chat can be renamed from the catalog',true)
  await ev(`window.buddy.catalog.refresh()`)
  check('saved name survives a rescan',await ev(`window.buddy.catalog.get().then(c=>c.chats.some(e=>e.id==='11111111-1111-4111-8111-111111111111' && e.title==='Admin Panel Main Chat'))`))
  await ev(`[...document.querySelectorAll('.sidebar .row')].find(r=>r.querySelector('.row-title')?.textContent==='Admin Panel Main Chat').querySelector('.primary').click()`)
  await until(`document.querySelector('.cell.is-active .session-name-button')?.textContent.includes('Admin Panel Main Chat')`)
  check('reopening the saved conversation uses its chosen name',true)
  const screenshot=await send('Page.captureScreenshot',{format:'png'})
  writeFileSync(join(tmpdir(),'terminal-buddy-terminal-first.png'),Buffer.from(screenshot.data,'base64'))
  if (process.env.BUDDY_TEST_NOTIFICATION === '1') {
    const notification = await ev(`window.buddy.app.testNotification()`)
    check('Windows accepts a real native desktop notification',notification.ok,notification.message)
  }
  check('no renderer exceptions',errors.length===0,errors.join(' | '))
} catch(error) {check('harness',false,error.message);try{console.log('UI:',await ev('document.body.innerText'));console.log('OUTPUT:',await ev('JSON.stringify(window.__output)'))}catch{}}
finally {
  ws?.close();child.kill();await sleep(800)
  rmSync(root,{recursive:true,force:true,maxRetries:8,retryDelay:250})
  console.log(failures?`${failures} checks failed`:'All import checks passed')
  process.exit(failures?1:0)
}
