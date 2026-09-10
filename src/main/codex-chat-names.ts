import { spawn, execFile } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Codex keeps user-chosen names separately from its rollout transcripts. */
export async function readCodexChatNames(codexDir: string): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  const lines = createInterface({ input: createReadStream(join(codexDir, 'session_index.jsonl'), { encoding: 'utf8' }), crlfDelay: Infinity })
  try {
    for await (const line of lines) {
      try {
        const row = JSON.parse(line)
        if (typeof row.id === 'string' && typeof row.thread_name === 'string' && row.thread_name.trim()) {
          names.set(row.id, row.thread_name.trim())
        }
      } catch { /* Skip a partial last line while Codex is writing. */ }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  } finally { lines.close() }
  return names
}

/** Use Codex's metadata API; never rewrite a rollout or send input to a live chat. */
export function renameCodexChat(codexDir: string, threadId: string, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Only this fixed command goes through the Windows shell (for npm .cmd shims).
    // IDs and names travel as JSON over stdin, never as shell arguments.
    const proc = spawn('codex', ['app-server'], {
      cwd: homedir(), env: { ...process.env, CODEX_HOME: codexDir },
      windowsHide: true, shell: process.platform === 'win32', stdio: ['pipe', 'pipe', 'pipe']
    })
    const lines = createInterface({ input: proc.stdout })
    let settled = false
    let initialized = false
    let shutdown: NodeJS.Timeout | undefined
    const timer = setTimeout(() => finish(new Error('Codex did not confirm the rename in time. Rescan to check its saved name.')), 30000)
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      proc.stdin.end()
      // EOF normally shuts down this short-lived server. Clean up only our child
      // process tree if it gets stuck; existing Codex terminals are unaffected.
      if (proc.exitCode === null && proc.pid) {
        shutdown = setTimeout(() => {
          if (process.platform === 'win32') {
            execFile('taskkill.exe', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true }, () => {})
          } else proc.kill()
        }, 2000)
        shutdown.unref()
      }
      if (error) reject(error)
      else resolve()
    }
    const send = (message: object): void => { proc.stdin.write(JSON.stringify(message) + '\n') }
    proc.stderr.resume()
    proc.on('error', () => finish(new Error('Could not start Codex. Make sure codex is installed, or use /rename inside the chat.')))
    proc.stdin.on('error', () => finish(new Error('The Codex connection closed before confirming the rename.')))
    proc.on('close', () => {
      finish(new Error('Codex closed before confirming the rename. Use /rename inside the chat or update your Codex CLI.'))
      if (shutdown) clearTimeout(shutdown)
      lines.close()
    })
    lines.on('line', line => {
      if (settled) return
      let message
      try { message = JSON.parse(line) } catch { return }
      if (!message || typeof message !== 'object') return
      if (message.method) {
        if (message.id !== undefined) send({ id: message.id, error: { code: -32601, message: 'This client only renames saved chats.' } })
        return
      }
      if (message.id !== 1 && message.id !== 2) return
      if (message.error) {
        finish(new Error(`Codex could not rename this chat: ${message.error.message || 'Unknown error'}`))
      } else if (!('result' in message)) return
      else if (message.id === 1 && !initialized) {
        initialized = true
        send({ method: 'initialized', params: {} })
        send({ id: 2, method: 'thread/name/set', params: { threadId, name } })
      } else if (message.id === 2 && initialized) finish()
    })
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'terminal_buddy', title: 'Terminal Buddy', version: '0.1.15' } } })
  })
}
