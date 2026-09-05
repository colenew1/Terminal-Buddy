/** Real persistence code with an isolated profile; no Windows alerts or agents. */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
const profile = mkdtempSync(join(tmpdir(), 'buddy-store-'))
const require = createRequire(import.meta.url)
const compile = (file, mocks = {}) => {
  const module = { exports: {} }
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, require: (name) => mocks[name] ?? require(name) })
  return module.exports
}
const types = compile('../src/shared/types.ts')
const store = compile('../src/main/store.ts', { electron: { app: { getPath: () => profile } }, '@shared/types': types })
const pass = (name, fn) => { fn(); console.log('PASS ' + name) }
try {
  pass('fresh installs disable notifications/chimes and request the tour', () => {
    const s = store.loadSettings(); assert.equal(s.desktopNotifications, false); assert.equal(s.chime, false); assert.equal(s.walkthroughVersion, 0)
  })
  writeFileSync(join(profile, 'settings.json'), JSON.stringify({ desktopNotifications: true, chime: true, fontSize: 17 }))
  pass('legacy default-on alerts migrate off without losing other preferences', () => {
    const s = store.loadSettings(); assert.equal(s.desktopNotifications, false); assert.equal(s.chime, false); assert.equal(s.fontSize, 17); assert.equal(s.alertsOptInVersion, 1)
  })
  store.saveSettings({ ...store.loadSettings(), desktopNotifications: true, chime: true, walkthroughVersion: 1 })
  pass('explicit opt-in and tour completion survive subsequent launches', () => {
    const s = store.loadSettings(); assert.equal(s.desktopNotifications, true); assert.equal(s.chime, true); assert.equal(s.walkthroughVersion, 1)
  })
  const a = { sessions: [{ cwd: profile, shellId: 'cmd', title: 'Previous' }], layout: 'grid', gridSizes: { columns: [.3, .7], rows: [1] } }
  store.saveWorkspace(a); store.saveWorkspace({ ...a, sessions: [{ ...a.sessions[0], title: 'Current' }] })
  pass('latest valid workspace is used normally', () => assert.equal(store.loadWorkspace().sessions[0].title, 'Current'))
  pass('separate windows keep independent snapshots and backups', () => {
    const id = '22222222-2222-4222-8222-222222222222'
    store.saveWorkspace({ ...a, sessions: [{ ...a.sessions[0], title: 'Other window' }] }, id)
    assert.equal(store.loadWorkspace(id).sessions[0].title, 'Other window')
    assert.equal(store.loadWorkspace().sessions[0].title, 'Current')
    store.saveWindowIds(['primary', id])
    assert.deepEqual([...store.loadWindowIds()], ['primary', id])
    store.saveWindowIds([id])
    writeFileSync(join(profile, 'windows.json'), '{partial')
    assert.deepEqual([...store.loadWindowIds()], ['primary', id])
    assert.throws(() => store.saveWorkspace(a, '../outside'), /Invalid/)
    assert.throws(() => store.saveWindowIds(['../outside']), /Invalid/)
  })
  writeFileSync(join(profile, 'workspace.json'), '{partial')
  pass('corrupt primary falls back to last-known-good backup', () => assert.equal(store.loadWorkspace().sessions[0].title, 'Previous'))
  store.saveWorkspace(a)
  pass('saving after corruption does not overwrite backup with broken JSON', () => assert.equal(JSON.parse(readFileSync(join(profile, 'workspace.json.bak'), 'utf8')).sessions[0].title, 'Previous'))
  writeFileSync(join(profile, 'workspace.json'), JSON.stringify({ sessions: 'invalid', layout: 'grid' }))
  pass('invalid workspace shape also recovers safely', () => assert.ok(Array.isArray(store.loadWorkspace().sessions)))
} finally { rmSync(profile, { recursive: true, force: true }) }
