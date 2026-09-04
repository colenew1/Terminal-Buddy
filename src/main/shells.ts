import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { ShellDef } from '@shared/types'

function firstExisting(...paths: string[]): string | null {
  for (const p of paths) if (p && existsSync(p)) return p
  return null
}

/**
 * Probe for the shells actually installed on this machine. Order matters —
 * the first hit becomes the default when the user has no saved preference.
 */
export function detectShells(): ShellDef[] {
  const out: ShellDef[] = []

  if (process.platform === 'win32') {
    const sysRoot = process.env.SystemRoot || 'C:\\Windows'
    const pf = process.env.ProgramFiles || 'C:\\Program Files'
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    const localApp = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')

    const pwsh = firstExisting(
      join(pf, 'PowerShell', '7', 'pwsh.exe'),
      join(pf, 'PowerShell', '8', 'pwsh.exe'),
      join(localApp, 'Microsoft', 'WindowsApps', 'pwsh.exe')
    )
    if (pwsh) out.push({ id: 'pwsh', label: 'PowerShell 7', path: pwsh, args: ['-NoLogo'] })

    const winps = firstExisting(join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'))
    if (winps) out.push({ id: 'powershell', label: 'Windows PowerShell', path: winps, args: ['-NoLogo'] })

    const cmd = firstExisting(process.env.ComSpec || '', join(sysRoot, 'System32', 'cmd.exe'))
    if (cmd) out.push({ id: 'cmd', label: 'Command Prompt', path: cmd, args: [] })

    const gitBash = firstExisting(
      join(pf, 'Git', 'bin', 'bash.exe'),
      join(pf86, 'Git', 'bin', 'bash.exe'),
      join(localApp, 'Programs', 'Git', 'bin', 'bash.exe')
    )
    if (gitBash) out.push({ id: 'git-bash', label: 'Git Bash', path: gitBash, args: ['--login', '-i'] })

    const wsl = firstExisting(join(sysRoot, 'System32', 'wsl.exe'))
    if (wsl) out.push({ id: 'wsl', label: 'WSL', path: wsl, args: [] })
  } else {
    const userShell = process.env.SHELL
    if (userShell && existsSync(userShell)) {
      out.push({ id: 'default', label: userShell.split('/').pop() || 'shell', path: userShell, args: ['-l'] })
    }
    for (const [id, p] of [['zsh', '/bin/zsh'], ['bash', '/bin/bash'], ['sh', '/bin/sh']] as const) {
      if (existsSync(p) && !out.some((s) => s.path === p)) {
        out.push({ id, label: id, path: p, args: ['-l'] })
      }
    }
  }

  if (out.length === 0) {
    // Nothing recognised — fall back to something that will at least start.
    const fallback = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh'
    out.push({ id: 'fallback', label: 'Shell', path: fallback, args: [] })
  }
  return out
}

export function resolveShell(shells: ShellDef[], id: string | undefined): ShellDef {
  return shells.find((s) => s.id === id) ?? shells[0]
}
