/** Deterministic notification timing checks. Never opens desktop notifications. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const source = readFileSync(new URL('../src/main/terminal-activity.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const { TerminalActivity } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))
let now = 0, enabled = true
const alerts = []
const activity = new TerminalActivity((alert) => alerts.push(alert), () => enabled, () => now)
function pass(label, fn) { fn(); console.log('PASS ' + label) }
activity.register('plain', 'Shell'); activity.output('plain'); now = 10000; activity.tick()
pass('booting an unused shell does not alert', () => assert.equal(alerts.length, 0))
activity.input('plain', 'hello'); now += 10000; activity.tick()
pass('unsubmitted typing does not alert', () => assert.equal(alerts.length, 0))
activity.input('plain', '\r'); activity.output('plain'); now += 7999; activity.tick()
pass('short pauses do not alert', () => assert.equal(alerts.length, 0))
activity.rename('plain', "Praveen's persona"); now += 1; activity.tick()
pass('quiet alert uses the custom name and cautious status', () => assert.deepEqual(alerts.at(-1), { id: 'plain', title: "Praveen's persona", kind: 'quiet' }))
now += 40000; activity.tick()
pass('one alert per quiet episode', () => assert.equal(alerts.length, 1))
activity.output('plain'); now += 8000; activity.tick()
pass('resumed work can alert again when it pauses', () => assert.equal(alerts.length, 2))
activity.output('plain'); now += 8000; activity.tick()
pass('repeated pauses are rate limited', () => assert.equal(alerts.length, 2))
enabled = false; now += 30000; activity.tick(); enabled = true; now += 30000; activity.tick()
pass('re-enabling does not replay disabled episodes', () => assert.equal(alerts.length, 2))
activity.register('launch', 'Claude', true); activity.output('launch'); now += 8000; activity.tick()
pass('agent launch prompts alert without needing a transcript', () => assert.equal(alerts.at(-1).id, 'launch'))
activity.exit('launch')
pass('process exit is distinguished from a pause', () => assert.equal(alerts.at(-1).kind, 'exit'))
const beforeClose = alerts.length
activity.register('close', 'Closing', true); activity.remove('close'); activity.exit('close'); now += 30000; activity.tick()
pass('intentional close cancels pending alerts', () => assert.equal(alerts.length, beforeClose))
activity.register('protocol', 'Protocol'); activity.input('protocol', '\x1b[1;1R'); activity.output('protocol'); now += 10000; activity.tick()
pass('terminal protocol replies do not arm notifications', () => assert.equal(alerts.length, beforeClose))
console.log('All notification timing checks passed')
