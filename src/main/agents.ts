import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Agent } from '@shared/types'

const run = promisify(execFile)

/**
 * Works out which panes are currently running an agent, by walking the process
 * tree beneath each shell.
 *
 * Guessing from terminal output would be cheaper but wrong often enough to
 * matter — and a drop target that lies about what it accepts is worse than one
 * that offers nothing. This is only called when a drag starts or the catalog
 * opens, so the cost of enumerating processes is paid when it buys something.
 */

const PROBE = `
$ErrorActionPreference = 'Stop'
$roots = $env:BUDDY_PIDS -split ',' | Where-Object { $_ } | ForEach-Object { [int]$_ }
$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine

$byParent = @{}
foreach ($p in $all) {
  $key = [string]$p.ParentProcessId
  if (-not $byParent.ContainsKey($key)) { $byParent[$key] = New-Object System.Collections.ArrayList }
  [void]$byParent[$key].Add($p)
}

function Find-Agent($pid_, $depth) {
  if ($depth -gt 6) { return $null }
  $kids = $byParent[[string]$pid_]
  if ($null -eq $kids) { return $null }
  foreach ($k in $kids) {
    # -like rather than -match: wildcards need no escaping on the way through
    # JavaScript, and the patterns below are all literal path fragments.
    $name = $k.Name.ToLower()
    $cmd = if ($k.CommandLine) { $k.CommandLine.ToLower() } else { '' }
    if ($name -like 'codex*' -or $cmd -like '*\\codex*' -or $cmd -like '*/codex*' -or $cmd -like '*codex.js*') { return 'codex' }
    if ($name -like 'claude*' -or $cmd -like '*\\claude*' -or $cmd -like '*/claude*' -or $cmd -like '*claude.js*') { return 'claude' }
    $deeper = Find-Agent $k.ProcessId ($depth + 1)
    if ($deeper) { return $deeper }
  }
  return $null
}

$out = @{}
foreach ($r in $roots) { $out[[string]$r] = Find-Agent $r 0 }
$out | ConvertTo-Json -Compress
`

export async function probeAgents(pids: number[]): Promise<Record<number, Agent | null>> {
  const result: Record<number, Agent | null> = {}
  const live = pids.filter((p) => Number.isInteger(p) && p > 0)
  for (const p of live) result[p] = null
  if (live.length === 0) return result
  if (process.platform !== 'win32') {
    try {
      const { stdout } = await run('/bin/ps', ['-axww', '-o', 'pid=,ppid=,args='], {
        timeout: 12000, maxBuffer: 8 * 1024 * 1024
      })
      return agentsFromPs(stdout, live)
    } catch { return result }
  }

  const file = join(tmpdir(), `buddy-agents-${Date.now()}.ps1`)
  try {
    await writeFile(file, PROBE, 'utf8')
    const { stdout } = await run(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file],
      { windowsHide: true, timeout: 12000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, BUDDY_PIDS: live.join(',') } }
    )
    const parsed = JSON.parse(stdout.trim() || '{}') as Record<string, string | null>
    for (const [pid, agent] of Object.entries(parsed)) {
      const n = Number(pid)
      if (agent === 'claude' || agent === 'codex') result[n] = agent
    }
  } catch {
    // A failed probe means "we don't know", which the UI already handles.
  } finally {
    await rm(file, { force: true }).catch(() => undefined)
  }
  return result
}

/** macOS and Linux provide the same PID/parent/command fields through ps. */
export function agentsFromPs(output: string, roots: number[]): Record<number, Agent | null> {
  const children = new Map<number, { pid: number; command: string }[]>()
  for (const line of output.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line)
    if (!match) continue
    const parent = Number(match[2])
    const list = children.get(parent) ?? []
    list.push({ pid: Number(match[1]), command: match[3] })
    children.set(parent, list)
  }
  function find(pid: number, visited: Set<number>): Agent | null {
    if (visited.has(pid)) return null
    visited.add(pid)
    for (const child of children.get(pid) ?? []) {
      // Match the executable or the Node entry script, never arbitrary prompt
      // arguments (e.g. `echo codex` or a project named claude).
      const tokens = (child.command.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((token) => token.replace(/^(['"])(.*)\1$/, '$2'))
      const executable = tokens[0]?.split('/').pop()?.toLowerCase()
      if (executable === 'codex' || executable === 'claude') return executable
      if (executable === 'node') {
        const script = tokens.slice(1).find((token) => !token.startsWith('-')) ?? ''
        const match = /(?:^|\/)(codex|claude)\.(?:js|mjs)$/i.exec(script)
        if (match) return match[1].toLowerCase() as Agent
        if (script.endsWith('/@anthropic-ai/claude-code/cli.js')) return 'claude'
      }
      const nested = find(child.pid, visited)
      if (nested) return nested
    }
    return null
  }
  return Object.fromEntries(roots.map((pid) => [pid, find(pid, new Set())]))
}
