import { open, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { PersistedSession, RestoreItem, SessionSpec, Settings } from '@shared/types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Validate the recorded file itself; never substitute the newest chat in a folder. */
export async function validate(session: PersistedSession): Promise<void> {
  if (!session || typeof session.cwd !== 'string' || !(await stat(session.cwd)).isDirectory()) throw Error('The project folder is unavailable.')
  const ref = session.resume
  if (!ref) {
    if (session.agent) throw Error('This chat was not linked to an exact session ID. Select it from Saved chats.')
    return
  }
  if (!UUID.test(ref.id) || !['claude','codex'].includes(ref.agent) || typeof ref.path !== 'string' || !ref.path.endsWith('.jsonl')) throw Error('The saved chat identity is invalid.')
  const file = await open(ref.path, 'r')
  let head: string
  try {
    const buffer = Buffer.alloc(65536)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    head = buffer.subarray(0, bytesRead).toString('utf8')
  } finally { await file.close() }
  const ids = new Set<string>()
  let hasClaudeHistory = false
  for (const line of head.split('\n')) {
    try {
      const row = JSON.parse(line)
      if (ref.agent === 'claude' && ['user', 'assistant'].includes(row.type)) hasClaudeHistory = true
      if (ref.agent === 'codex' && row.type === 'session_meta') {
        if (typeof row.payload?.session_id === 'string') ids.add(row.payload.session_id)
        if (typeof row.payload?.id === 'string') ids.add(row.payload.id)
      } else if (ref.agent === 'claude' && typeof row.sessionId === 'string') ids.add(row.sessionId)
    } catch { /* Partial rows are not identity evidence. */ }
  }
  if (ref.agent === 'claude' && ids.size === 0 && hasClaudeHistory) ids.add(basename(ref.path, '.jsonl'))
  if (!ids.has(ref.id)) throw Error('The saved file does not match this chat ID, or has no saved history yet.')
}

export async function prepareRestore(sessions: PersistedSession[]): Promise<RestoreItem[]> {
  return Promise.all(sessions.map(async (session,index) => {
    try {
      await validate(session)
      return { index, session, available: true, description: session.resume ? `Resume ${session.resume.agent} conversation` : 'Reopen terminal folder only' }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      const description = code === 'ENOENT' ? 'The saved folder or chat file is missing.' : code === 'EACCES' || code === 'EPERM' ? 'The saved folder or chat file cannot be read.' : (error as Error).message
      return { index, session, available: false, description }
    }
  }))
}

export async function restoreSpec(session: PersistedSession, settings: Settings): Promise<SessionSpec> {
  await validate(session) // Files may have changed since the chooser opened.
  const { resume, cwd, shellId, title, critter, span, pos } = session
  const spec: SessionSpec = { cwd, shellId, title, critter, span, pos, requireCwd: true }
  if (resume) {
    const template = resume.agent === 'claude' ? settings.claudeResumeCommand : settings.codexResumeCommand
    if (!template.includes('{id}')) throw Error('The resume command in Settings must include {id}.')
    Object.assign(spec, { resume, agent: resume.agent, transcript: { agent: resume.agent, path: resume.path }, initialCommand: template.replaceAll('{id}', resume.id) })
  }
  return spec
}
