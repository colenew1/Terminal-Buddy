import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { app } from 'electron'
import type { IntegrationStatus, OpResult } from '@shared/types'

const run = promisify(execFile)

const KEY_NAME = 'TerminalBuddy'
const MENU_LABEL = 'Open in Buddy'
const ROOTS = [
  `Software\\Classes\\Directory\\shell\\${KEY_NAME}`,
  // Right-clicking the empty space *inside* a folder is a different key.
  `Software\\Classes\\Directory\\Background\\shell\\${KEY_NAME}`
]

function cliDir(): string {
  const base = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
  return join(base, 'Programs', 'terminal-buddy')
}

/**
 * The command Explorer should run. In dev, Electron needs the app directory
 * passed before the folder argument, otherwise it just opens a blank shell.
 */
function launchParts(): { exe: string; leading: string[] } {
  return app.isPackaged
    ? { exe: process.execPath, leading: [] }
    : { exe: process.execPath, leading: [app.getAppPath()] }
}

/** Escape a value for the body of a .reg file. */
function regEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * Registry writes go through a generated .reg file rather than `reg add /d`.
 * Quoting a command string that itself contains quotes through argv is
 * unreliable on Windows; `reg import` of a UTF-16 file is not.
 */
async function importReg(body: string): Promise<void> {
  const file = join(tmpdir(), `terminal-buddy-${Date.now()}.reg`)
  // reg.exe wants UTF-16LE with a BOM for non-ASCII paths to survive.
  await writeFile(file, '\ufeff' + body, { encoding: 'utf16le' })
  try {
    await run('reg', ['import', file], { windowsHide: true })
  } finally {
    await rm(file, { force: true }).catch(() => undefined)
  }
}

export async function isContextMenuInstalled(): Promise<boolean> {
  if (process.platform !== 'win32') return false
  try {
    await run('reg', ['query', `HKCU\\${ROOTS[0]}`], { windowsHide: true })
    return true
  } catch {
    return false
  }
}

export async function installContextMenu(): Promise<OpResult> {
  if (process.platform !== 'win32') {
    return { ok: false, message: 'The Explorer context menu is Windows-only.' }
  }
  const { exe, leading } = launchParts()
  const argv = [exe, ...leading].map((a) => `\\"${regEscape(a)}\\"`).join(' ')
  const command = `${argv} \\"%V\\"`

  const lines = ['Windows Registry Editor Version 5.00', '']
  for (const root of ROOTS) {
    lines.push(
      `[HKEY_CURRENT_USER\\${root}]`,
      `@="${MENU_LABEL}"`,
      `"Icon"="${regEscape(exe)},0"`,
      '',
      `[HKEY_CURRENT_USER\\${root}\\command]`,
      `@="${command}"`,
      ''
    )
  }

  try {
    await importReg(lines.join('\r\n'))
    return {
      ok: true,
      message: app.isPackaged
        ? 'Added "Open in Buddy". On Windows 11 it lives under "Show more options" (Shift+F10).'
        : 'Added "Open in Buddy" pointing at your dev build. Re-run this after packaging.'
    }
  } catch (e) {
    return { ok: false, message: `Registry write failed: ${(e as Error).message}` }
  }
}

export async function uninstallContextMenu(): Promise<OpResult> {
  if (process.platform !== 'win32') return { ok: false, message: 'Windows-only.' }
  let removed = 0
  for (const root of ROOTS) {
    try {
      await run('reg', ['delete', `HKCU\\${root}`, '/f'], { windowsHide: true })
      removed++
    } catch {
      /* key was not there */
    }
  }
  return { ok: true, message: removed ? 'Removed "Open in Buddy".' : 'Nothing to remove.' }
}

export function isCliInstalled(): boolean {
  return existsSync(join(cliDir(), 'buddy.cmd'))
}

export async function installCli(): Promise<OpResult> {
  if (process.platform !== 'win32') return { ok: false, message: 'Windows-only.' }
  const dir = cliDir()
  const { exe, leading } = launchParts()
  const leadingArgs = leading.map((a) => `"${a}" `).join('')

  const cmd = [
    '@echo off',
    'setlocal',
    'set "TARGET=%~1"',
    'if "%TARGET%"=="" set "TARGET=%CD%"',
    `start "" "${exe}" ${leadingArgs}"%TARGET%"`,
    'endlocal'
  ].join('\r\n')

  try {
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'buddy.cmd'), cmd, 'utf8')
  } catch (e) {
    return { ok: false, message: `Could not write buddy.cmd: ${(e as Error).message}` }
  }

  // Read-modify-write the user PATH through .NET. `setx` truncates at 1024
  // characters and would silently eat part of the user's PATH.
  const ps = [
    '$ErrorActionPreference = "Stop"',
    `$dir = ${JSON.stringify(dir)}`,
    '$p = [Environment]::GetEnvironmentVariable("Path", "User")',
    'if ($null -eq $p) { $p = "" }',
    '$parts = $p -split ";" | Where-Object { $_ -ne "" }',
    'if ($parts -notcontains $dir) {',
    '  $new = (($parts + $dir) -join ";")',
    '  [Environment]::SetEnvironmentVariable("Path", $new, "User")',
    '  Write-Output "added"',
    '} else { Write-Output "present" }'
  ].join('\r\n')

  const psFile = join(tmpdir(), `terminal-buddy-path-${Date.now()}.ps1`)
  try {
    await writeFile(psFile, ps, 'utf8')
    const { stdout } = await run(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile],
      { windowsHide: true }
    )
    const added = stdout.trim() === 'added'
    return {
      ok: true,
      message: added
        ? 'Installed `buddy`. Open a new terminal, then run `buddy` or `buddy <folder>`.'
        : 'Installed `buddy` (PATH already had the folder).'
    }
  } catch (e) {
    return {
      ok: false,
      message: `buddy.cmd written to ${dir}, but updating PATH failed: ${(e as Error).message}`
    }
  } finally {
    await rm(psFile, { force: true }).catch(() => undefined)
  }
}

export async function uninstallCli(): Promise<OpResult> {
  try {
    await rm(cliDir(), { recursive: true, force: true })
    return { ok: true, message: 'Removed buddy.cmd. The PATH entry is harmless but you can clear it manually.' }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function integrationStatus(): Promise<IntegrationStatus> {
  return {
    contextMenuInstalled: await isContextMenuInstalled(),
    cliInstalled: isCliInstalled(),
    cliDir: cliDir(),
    packaged: app.isPackaged
  }
}
