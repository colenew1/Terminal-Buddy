/** Native key capture must snapshot transient clipboard text before returning to Flow. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
let currentText = 'dictated words', listener, reads = 0
const sent = []
const module = { exports: {} }
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/main/clipboard.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, { module, exports: module.exports, process: { platform: 'win32' }, require: () => ({
  clipboard: { readText() { reads++; return Promise.resolve(currentText) } }
}) })
module.exports.installTextPaste({ on: (_event, cb) => { listener = cb }, isDestroyed: () => false, send: (...args) => sent.push(args) })
let prevented = false
listener({ preventDefault() { prevented = true } }, { type: 'keyDown', key: 'v', code: '', control: true })
assert.equal(prevented, true)
assert.equal(reads, 1)
currentText = '' // Flow restores the previous image immediately after the shortcut.
await Promise.resolve()
assert.deepEqual(Array.from(sent[0]), ['clipboard:paste', 'dictated words'])
listener({ preventDefault() { throw Error('ordinary typing was swallowed') } }, { type: 'keyDown', key: 'a', code: 'KeyA' })
listener({ preventDefault() { throw Error('key release was treated as a second paste') } }, { type: 'keyUp', key: 'v', code: 'KeyV', control: true })
assert.equal(reads, 1)
console.log('PASS dictation captures text before clipboard restoration, consumes missing-code Ctrl+V once and preserves ordinary input')
