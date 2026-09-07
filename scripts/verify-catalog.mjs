/** Index real JSONL fixtures in a disposable home, including format/cache regressions. */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, utimesSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
const require = createRequire(import.meta.url)
const root = mkdtempSync(join(tmpdir(), 'buddy-catalog-'))
const config = join(root, 'custom-codex'), claude = join(root, 'custom-claude')
const write = (dir, name, rows) => {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, name + '.jsonl')
  writeFileSync(file, rows.map(JSON.stringify).join('\n') + '\n')
  return file
}
const row = (timestamp, text) => ({ type: 'response_item', timestamp, payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } })
const meta = id => ({ type: 'session_meta', timestamp: '2026-01-01T00:00:00Z', payload: { id, cwd: root } })
const module = { exports: {} }
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/main/catalog.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, { module, exports: module.exports, process: { env: { CODEX_HOME: config, CLAUDE_CONFIG_DIR: claude } },
  require: name => name === 'node:os' ? { homedir: () => root } : require(name) })
try {
  const modern = write(join(config, 'sessions', '2026', '01', '01'), 'modern', [meta('modern'), row('2026-02-03T12:00:00Z', 'Modern message')])
  const older = write(join(claude, 'projects', 'project'), 'older', [
    { type: 'custom-title', customTitle: 'Named Claude chat' },
    { type: 'user', timestamp: '2026-02-01T12:00:00Z', cwd: root, message: { content: 'Older message' } }
  ])
  utimesSync(older, new Date('2026-08-01'), new Date('2026-08-01'))
  write(join(config, 'archived_sessions'), 'archive', [meta('archived'), row('2026-02-02T12:00:00Z', 'Archived message')])
  write(join(config, 'archived_sessions'), 'duplicate', [meta('modern'), row('2026-02-01T12:00:00Z', 'Old copy')])
  write(join(config, 'sessions'), 'mixed', [meta('mixed'), row('2026-01-02T12:00:00Z', 'Same message'),
    { type: 'event_msg', timestamp: '2026-01-02T12:00:00Z', payload: { type: 'user_message', message: 'Same message' } }])
  const service = new module.exports.CatalogService(join(root, 'cache.json'), () => {})
  let catalog = await service.scan()
  assert.deepEqual(Array.from(catalog.chats, c => c.id), ['modern', 'archived', 'older', 'mixed'])
  assert.equal(catalog.chats.find(c => c.id === 'modern').internal, false)
  assert.equal(catalog.chats.find(c => c.id === 'older').title, 'Named Claude chat')
  assert.equal(catalog.chats.find(c => c.id === 'mixed').turns, 1)
  assert.equal((await service.transcript(modern, 'codex')).turns[0].text, 'Modern message')
  assert.equal((await service.transcript(join(config, 'sessions', 'mixed.jsonl'), 'codex')).turns.length, 1)
  console.log('PASS modern/legacy messages, archives, deduplication, custom roots and activity ordering (ignores copied-file mtime)')
  appendFileSync(older, JSON.stringify({ type: 'assistant', timestamp: '2026-02-04T12:00:00Z', message: { content: 'Newest reply' } }) + '\n')
  catalog = await service.scan()
  assert.equal(catalog.chats[0].id, 'older')
  rmSync(modern)
  catalog = await service.scan()
  assert.equal(catalog.chats.find(c => c.id === 'modern').preview, 'Old copy')
  const reloaded = new module.exports.CatalogService(join(root, 'cache.json'), () => {})
  assert.equal((await reloaded.scan()).chats[0].id, 'older')
  console.log('PASS rescans update ordering, remove stale files and persist refreshed cache across launches')
  const historyBefore = readFileSync(older, 'utf8')
  const previousTime = catalog.chats.find(c => c.id === 'older').updatedAt
  await service.renameChat('claude', 'older', 'Admin Panel Main Chat')
  assert.equal((await service.scan()).chats.find(c => c.id === 'older').title, 'Admin Panel Main Chat')
  const reopened = new module.exports.CatalogService(join(root, 'cache.json'), () => {})
  const renamed = (await reopened.scan()).chats.find(c => c.id === 'older')
  assert.equal(renamed.title, 'Admin Panel Main Chat')
  assert.equal(renamed.updatedAt, previousTime)
  assert.equal(readFileSync(older, 'utf8'), historyBefore)
  await assert.rejects(service.renameChat('claude', 'older', '   '))
  await Promise.all([service.renameChat('claude', 'older', 'Final admin name'), service.renameChat('codex', 'archived', 'Archived project')])
  const concurrent = new module.exports.CatalogService(join(root, 'cache.json'), () => {})
  const final = await concurrent.scan()
  assert.equal(final.chats.find(c => c.id === 'older').title, 'Final admin name')
  assert.equal(final.chats.find(c => c.id === 'archived').title, 'Archived project')
  console.log('PASS saved-chat names survive rescans, restarts and concurrent renames without changing conversation files or recency')
} finally {
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))
  rmSync(root, { recursive: true, force: true })
}
