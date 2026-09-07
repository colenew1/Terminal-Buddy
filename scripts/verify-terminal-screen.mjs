/** Real xterm parser / serializer, fake PTY transport. No UI or paid agent. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
import headless from '@xterm/headless'
const { Terminal } = headless
const nodeRequire=createRequire(import.meta.url), output=[], replies=[]
let receive, exited
const transport={pid:42,write:data=>replies.push(data),resize(){},kill(){},onData(cb){receive=cb},onExit(cb){exited=cb}}
const module={exports:{}}
const js=ts.transpileModule(readFileSync(new URL('../src/main/pty.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
vm.runInNewContext(js,{module,exports:module.exports,process,setTimeout,clearTimeout,console,require(name){
  if(name==='./shells')return{resolveShell:shells=>shells[0]}
  if(name==='@lydell/node-pty')return{spawn:()=>transport}
  return nodeRequire(name)
}})
const manager=new module.exports.PtyManager([{id:'fake',path:'fake',label:'Fake',args:[]}])
manager.onEvent=(channel,...args)=>{if(channel==='pty:data')output.push(args)}
const session=manager.create({cwd:process.cwd()})
const render=async snapshot=>{
  const term=new Terminal({cols:snapshot.cols,rows:snapshot.rows,scrollback:5000,allowProposedApi:true})
  await new Promise(resolve=>term.write(snapshot.data,resolve));return term
}
const text=term=>Array.from({length:term.buffer.active.length},(_,i)=>term.buffer.active.getLine(i)?.translateToString(true)).join('\n')
receive('\x1b[31mRED_HISTORY\x1b[0m\r\nunsent text')
let snapshot=await manager.snapshot(session.id), view=await render(snapshot)
assert.ok(text(view).includes('RED_HISTORY'));assert.ok(text(view).includes('unsent text'))
assert.equal(view.buffer.active.getLine(0).getCell(0).getFgColor(),1)
assert.equal(output.at(-1)[2],snapshot.seq)
view.dispose()
console.log('PASS snapshot retains colored history, cursor text and ordered output sequence')
receive('\x1b[?1049h\x1b[2J\x1b[H\x1b[32mTRUST MENU\x1b[0m\r\n1 Yes  2 No\x1b[?2004h')
snapshot=await manager.snapshot(session.id);view=await render(snapshot)
assert.equal(view.buffer.active.type,'alternate')
assert.ok(text(view).includes('TRUST MENU'));assert.equal(view.modes.bracketedPasteMode,true)
view.dispose()
console.log('PASS alternate-screen approval menus and bracketed-paste mode survive detaching')
receive('\x1b[?1049l')
snapshot=await manager.snapshot(session.id);view=await render(snapshot)
assert.equal(view.buffer.active.type,'normal');assert.ok(text(view).includes('RED_HISTORY'))
view.dispose()
console.log('PASS leaving a full-screen program restores its original scrollback')
receive('\x1b[2J\x1b[HCURRENT_SCREEN')
snapshot=await manager.snapshot(session.id);view=await render(snapshot)
assert.ok(view.buffer.active.baseY > 0)
assert.ok(text(view).includes('RED_HISTORY'));assert.ok(text(view).includes('CURRENT_SCREEN'))
view.dispose()
console.log('PASS clearing the viewport preserves prior output in scrollback and detached snapshots')
receive('\x1b[6n');await manager.snapshot(session.id)
assert.equal(replies.filter(value=>/^\x1b\[\d+;\d+R$/.test(value)).length,1)
console.log('PASS the canonical parser answers terminal position queries exactly once')
manager.resize(session.id,120,35)
snapshot=await manager.snapshot(session.id);assert.equal(snapshot.cols,120);assert.equal(snapshot.rows,35)
exited({exitCode:7});snapshot=await manager.snapshot(session.id)
assert.equal(manager.describe(session.id).exitCode,7);assert.equal(manager.list().length,0)
manager.killAll()
console.log('PASS resizing updates snapshot geometry; exited screens remain available until explicitly closed')
