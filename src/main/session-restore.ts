import { open, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { PersistedSession, RestoreItem, SessionSpec, Settings } from '@shared/types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The folder is the only hard requirement: without it there is nothing to reopen. */
async function validateFolder(session: PersistedSession): Promise<void> {
  if (!session || typeof session.cwd !== 'string' || !(await stat(session.cwd)).isDirectory()) throw Error('The project folder is unavailable.')
}

/** Validate the recorded file itself; never substitute the newest chat in a folder. */
async function validateChat(session: PersistedSession, settings?: Settings): Promise<void> {
  if (session.assistantId) {
    if (session.agent || session.resume) throw Error('Custom assistants manage their own saved history.')
    if (!settings?.customAssistants?.some(p => p.id === session.assistantId)) throw Error('This custom assistant is no longer configured. Choose a new chat from +.')
    return
  }
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

export async function validate(session: PersistedSession, settings?: Settings): Promise<void> {
  await validateFolder(session)
  await validateChat(session, settings)
}

function reason(error: unknown): string {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ENOENT' ? 'The saved folder or chat file is missing.'
    : code === 'EACCES' || code === 'EPERM' ? 'The saved folder or chat file cannot be read.'
    : (error as Error).message
}

export async function prepareRestore(sessions: PersistedSession[], settings?: Settings): Promise<RestoreItem[]> {
  return Promise.all(sessions.map(async (session,index) => {
    try { await validateFolder(session) }
    catch (error) { return { index, session, available: false, description: reason(error) } }
    try {
      await validateChat(session, settings)
      return { index, session, available: true, description: session.assistantId ? `Start a fresh ${settings?.customAssistants.find(p => p.id === session.assistantId)?.name ?? 'custom assistant'} session (history stays in the CLI)` : session.resume ? `Resume ${session.resume.agent} conversation` : 'Reopen terminal folder only' }
    } catch (error) {
      // A crash can stop an agent mid-write. The chat link is broken, but the
      // folder still opens, so this stays reopenable instead of dead-ending.
      return { index, session, available: true, folderOnly: true, description: `${reason(error)} Reopens the folder without resuming; link the chat afterwards.` }
    }
  }))
}

export async function restoreSpec(session: PersistedSession, settings: Settings, allowFolderOnly = false): Promise<SessionSpec> {
  await validateFolder(session) // Files may have changed since the chooser opened.
  let linked = true
  try { await validateChat(session, settings) }
  catch (error) { if (!allowFolderOnly) throw error; linked = false }
  const { resume, cwd, shellId, title, critter, span, pos } = session
  const spec: SessionSpec = { cwd, shellId, title, critter, span, pos, requireCwd: true,
    assistantId: linked ? session.assistantId : undefined, assistantName: linked ? session.assistantName : undefined }
  if (resume && linked) {
    const template = resume.agent === 'claude' ? settings.claudeResumeCommand : settings.codexResumeCommand
    if (!template.includes('{id}')) throw Error('The resume command in Settings must include {id}.')
    Object.assign(spec, { resume, agent: resume.agent, transcript: { agent: resume.agent, path: resume.path }, initialCommand: template.replaceAll('{id}', resume.id) })
  }
  return spec
}
