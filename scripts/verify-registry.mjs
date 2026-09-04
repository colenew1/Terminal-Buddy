/**
 * Validates the .reg generation and escaping used by shell-integration.ts by
 * round-tripping it through the real reg.exe, under a scratch key that is
 * deleted afterwards. Never touches the key the app actually installs.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const run = promisify(execFile)
const TEST_KEY = 'Software\\Classes\\Directory\\shell\\TerminalBuddyRegSelfTest'

// Mirrors launchParts() in dev mode: an exe path plus an app dir, both with spaces.
const exe = 'C:\\Users\\Owner\\Desktop\\code-projects\\Personal\\Terminal Buddy\\node_modules\\electron\\dist\\electron.exe'
const appDir = 'C:\\Users\\Owner\\Desktop\\code-projects\\Personal\\Terminal Buddy'

const regEscape = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

const argv = [exe, appDir].map((a) => `\\"${regEscape(a)}\\"`).join(' ')
const command = `${argv} \\"%V\\"`

const body = [
  'Windows Registry Editor Version 5.00',
  '',
  `[HKEY_CURRENT_USER\\${TEST_KEY}]`,
  '@="Open in Buddy"',
  `"Icon"="${regEscape(exe)},0"`,
  '',
  `[HKEY_CURRENT_USER\\${TEST_KEY}\\command]`,
  `@="${command}"`,
  ''
].join('\r\n')

const file = join(tmpdir(), `buddy-regtest-${Date.now()}.reg`)
let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

try {
  await writeFile(file, '\ufeff' + body, { encoding: 'utf16le' })
  await run('reg', ['import', file], { windowsHide: true })
  check('reg import accepts generated file', true)

  const { stdout } = await run('reg', ['query', `HKCU\\${TEST_KEY}\\command`, '/ve'], { windowsHide: true })
  const value = stdout.split(/\r?\n/).find((l) => l.includes('REG_SZ'))?.split('REG_SZ')[1]?.trim() ?? ''

  const expected = `"${exe}" "${appDir}" "%V"`
  check('command value round-trips exactly', value === expected, value)
  check('exe path survived with spaces', value.includes('Terminal Buddy\\node_modules'), '')
  check('%V placeholder intact', value.endsWith('"%V"'), '')

  const { stdout: label } = await run('reg', ['query', `HKCU\\${TEST_KEY}`, '/ve'], { windowsHide: true })
  check('menu label round-trips', label.includes('Open in Buddy'))
} catch (e) {
  check('registry round-trip', false, e.message)
} finally {
  await run('reg', ['delete', `HKCU\\${TEST_KEY}`, '/f'], { windowsHide: true }).catch(() => undefined)
  await rm(file, { force: true }).catch(() => undefined)
  // Prove the cleanup worked, so this test leaves nothing behind.
  const gone = await run('reg', ['query', `HKCU\\${TEST_KEY}`], { windowsHide: true }).then(
    () => false,
    () => true
  )
  check('scratch key removed', gone)
  console.log(failures ? `\n${failures} failed` : '\nall registry checks passed')
  process.exit(failures ? 1 : 0)
}
