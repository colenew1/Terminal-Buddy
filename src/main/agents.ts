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
  if (process.platform !== 'win32' || live.length === 0) return result

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
