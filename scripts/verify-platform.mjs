/** Platform contracts can be checked on any host without launching agents. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
const require = createRequire(import.meta.url)
function load(file, platform, overrides = {}) {
  const source = readFileSync(new URL('../' + file, import.meta.url), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  vm.runInNewContext(js, { module, exports: module.exports, console, setTimeout, clearTimeout,
    process: { ...process, platform, env: {} }, window: { buddy: { platform } },
    require: name => overrides[name] ?? require(name) })
  return module.exports
}
const key = (code, modifiers = {}) => ({ code, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...modifiers })
const mac = load('src/renderer/src/lib/shortcuts.ts', 'darwin')
const win = load('src/renderer/src/lib/shortcuts.ts', 'win32')
assert.equal(mac.matchClipboard(key('KeyV', { metaKey: true })), 'paste')
assert.equal(mac.matchClipboard(key('KeyC', { ctrlKey: true })), null)
assert.equal(mac.matchClipboard(key('KeyV', { ctrlKey: true })), null)
assert.equal(mac.matchClipboard(key('KeyX', { ctrlKey: true })), null)
assert.equal(mac.matchShortcut(key('KeyT', { metaKey: true, shiftKey: true })), 'new')
assert.equal(mac.matchShortcut(key('KeyN', { metaKey: true, shiftKey: true })), 'newWindow')
assert.equal(mac.matchShortcut(key('Tab', { metaKey: true })), null)
assert.equal(mac.matchShortcut(key('Tab', { ctrlKey: true })), 'next')
assert.equal(win.matchClipboard(key('KeyV', { ctrlKey: true })), 'paste')
assert.equal(win.matchClipboard(key('', { key: 'v', ctrlKey: true })), 'paste')
assert.equal(win.matchClipboard(key('Unidentified', { keyCode: 86, ctrlKey: true })), 'paste')
assert.equal(win.matchClipboard(key('', { key: 'Insert', shiftKey: true })), 'paste')
assert.equal(mac.matchClipboard(key('', { key: 'v', ctrlKey: true })), null)
assert.equal(win.matchShortcut(key('KeyT', { ctrlKey: true, shiftKey: true })), 'new')
assert.equal(win.matchShortcut(key('KeyN', { ctrlKey: true, shiftKey: true })), 'newWindow')
console.log('PASS Mac Command clipboard, Control line editing, app switching, and Windows shortcuts')

const shells = load('src/main/shells.ts', 'darwin', {
  'node:fs': { constants: { X_OK: 1 }, accessSync: p => { if (!['/bin/zsh', '/bin/bash', '/bin/sh'].includes(p)) throw Error('missing') } },
  'node:os': { homedir: () => '/Users/test', userInfo: () => ({ shell: '/bin/zsh' }) }
}).detectShells()
assert.equal(shells[0].path, '/bin/zsh')
assert.equal(shells.filter(s => s.path === '/bin/zsh').length, 1)
assert.deepEqual([...shells[0].args], ['-l', '-i'])
console.log('PASS Finder launch finds account shell and opens an interactive login shell')

const { agentsFromPs } = load('src/main/agents.ts', 'darwin')
const result = agentsFromPs(`
  100 1 /bin/zsh -l -i
  101 100 node /opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js
  102 101 /opt/homebrew/bin/codex --prompt hello
  200 1 /bin/bash
  201 200 /bin/sh wrapper
  202 201 node /usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js
  300 1 /bin/zsh
  301 300 echo codex /projects/claude
  400 1 /bin/zsh
  401 400 /Users/test/.local/bin/claude
  500 1 /bin/zsh
  501 500 node "/Users/test/Library/Application Support/tools/codex.js"
  600 601 /bin/sh
  601 600 /bin/sh
`, [100, 200, 300, 400, 500, 600, 999])
assert.deepEqual({ ...result }, { 100: 'codex', 200: 'claude', 300: null, 400: 'claude', 500: 'codex', 600: null, 999: null })
console.log('PASS POSIX native/Node agent detection, nested children, unrelated arguments, cycles and missing processes')

for (const platform of ['win32', 'darwin']) {
  let options
  const transport = { pid: 42, onData() {}, onExit() {}, write() {}, resize() {}, kill() {} }
  const { PtyManager } = load('src/main/pty.ts', platform, {
    './shells': { resolveShell: shells => shells[0] },
    '@lydell/node-pty': { spawn: (_path, _args, opts) => { options = opts; return transport } }
  })
  const manager = new PtyManager([{ id: 'shell', path: '/test/shell', label: 'Test shell', args: [] }])
  const session = manager.create({})
  assert.equal(options.useConpty, platform === 'win32' ? true : undefined)
  manager.kill(session.id)
}
const { PtyManager } = load('src/main/pty.ts', 'darwin', {
  './shells': { resolveShell: shells => shells[0] },
  '@lydell/node-pty': { spawn: () => { throw Error('native module missing') } }
})
const broken = new PtyManager([{ id: 'zsh', path: '/bin/zsh', label: 'zsh', args: [] }])
assert.throws(() => broken.create({}), /Could not open zsh.*native module missing.*\nChoose another default shell/)
assert.equal(broken.list().length, 0)
console.log('PASS platform-specific PTY options and actionable launch failure without orphan sessions')
