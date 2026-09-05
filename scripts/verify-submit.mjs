/** Tests the real PTY manager's write ordering with a fake transport. No agents. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
const nodeRequire = createRequire(import.meta.url)
const source = readFileSync(new URL('../src/main/pty.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const writes = []
let spawnedEnv
const transport = {pid:123,write:data=>writes.push({data,at:Date.now()}),resize(){},kill(){},onData(){},onExit(){}}
const module = {exports:{}}
vm.runInNewContext(js, {module,exports:module.exports,process,setTimeout,clearTimeout,console,require(name){
  if(name==='./shells') return {resolveShell:shells=>shells[0]}
  if(name==='@lydell/node-pty') return {spawn:(_path,_args,options)=>{spawnedEnv=options.env;return transport}}
  return nodeRequire(name)
}})
const manager = new module.exports.PtyManager([{id:'fake',path:'fake',label:'Fake',args:[]}])
const first = manager.create({})
assert.equal(spawnedEnv.NO_COLOR,undefined)
assert.equal(spawnedEnv.FORCE_COLOR,'3')
assert.equal(spawnedEnv.COLORTERM,'truecolor')
assert.equal(spawnedEnv.TERM,'xterm-256color')
console.log('PASS child terminal enables truecolor instead of inheriting color suppression')
await manager.submit(first.id,'hello')
assert.deepEqual(writes.map(w=>w.data),['hello','\r'])
assert.ok(writes[1].at-writes[0].at>=250)
console.log('PASS text and Enter are distinct, separated writes')
writes.length=0
await manager.submit(first.id,'\x1b[200~line one\rline two\x1b[201~')
assert.deepEqual(writes.map(w=>w.data),['\x1b[200~line one\rline two\x1b[201~','\r'])
console.log('PASS multiline bracketed paste is intact; submit is outside the paste')
writes.length=0
const pending=manager.submit(first.id,'once')
await assert.rejects(manager.submit(first.id,'twice'),/already/)
await pending
assert.deepEqual(writes.map(w=>w.data),['once','\r'])
console.log('PASS rapid duplicate submission cannot send twice')
writes.length=0
const interrupted=manager.submit(first.id,'manual')
manager.write(first.id,'\r')
await assert.rejects(interrupted,/cancelled/)
assert.deepEqual(writes.map(w=>w.data),['manual','\r'])
console.log('PASS manual terminal input cancels the queued Enter')
writes.length=0
const closing=manager.submit(first.id,'closing')
manager.kill(first.id)
await assert.rejects(closing,/closed/)
assert.deepEqual(writes.map(w=>w.data),['closing'])
console.log('PASS closing a pane cancels its pending Enter')
writes.length=0
const freshClaude = manager.create({cwd:process.cwd(),agent:'claude',initialCommand:'claude'})
assert.match(freshClaude.resume.id,/^[0-9a-f-]{36}$/)
assert.ok(freshClaude.resume.path.endsWith(freshClaude.resume.id+'.jsonl'))
await new Promise(resolve=>setTimeout(resolve,1600))
assert.deepEqual(writes.map(w=>w.data),[`claude --session-id ${freshClaude.resume.id}\r`])
manager.kill(freshClaude.id)
console.log('PASS new Claude launch records and uses the same explicit conversation ID')
const resumedClaude = manager.create({cwd:process.cwd(),agent:'claude',initialCommand:'claude --resume '+freshClaude.resume.id,resume:freshClaude.resume})
assert.equal(resumedClaude.resume.id,freshClaude.resume.id)
manager.kill(resumedClaude.id)
assert.throws(()=>manager.create({cwd:'Z:\\missing-buddy-test-folder',requireCwd:true}),/unavailable/)
console.log('PASS restore preserves exact identity and never substitutes a missing project folder')
console.log('All submission checks passed')
