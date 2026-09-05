import type { ChatEntry, SkillEntry } from '@shared/types'
import { useStore } from '../store/useStore'

/**
 * The command strings that get typed into a shell. They live here rather than
 * in a component so the sidebar, the palette and the drop targets all build
 * them the same way — and so the templates stay in one place.
 */

export function resumeCommandFor(entry: ChatEntry): string {
  const { settings } = useStore.getState()
  const template = entry.agent === 'claude' ? settings.claudeResumeCommand : settings.codexResumeCommand
  return template.replace('{id}', entry.id)
}

/** Launch the agent with the skill already invoked, for an idle pane. */
export function skillLaunchCommand(entry: SkillEntry): string {
  const { settings } = useStore.getState()
  const template = entry.agent === 'claude' ? settings.claudeSkillCommand : settings.codexSkillCommand
  return template.replace('{skill}', `/${entry.name}`)
}

/** Opens a fresh terminal in the chat's folder and resumes it there. */
export async function resumeChat(entry: ChatEntry, replaceId?: string): Promise<string | null> {
  const { openSession, replaceEmptySession, notify } = useStore.getState()
  if (!entry.cwd) notify('That chat has no recorded folder — opening in your home directory.')
  const spec = {
    cwd: entry.cwd,
    title: entry.title.slice(0, 28),
    initialCommand: resumeCommandFor(entry),
    agent: entry.agent,
    transcript: { agent: entry.agent, path: entry.path },
    resume: { agent: entry.agent, id: entry.id, path: entry.path }
  }
  return replaceId ? replaceEmptySession(replaceId, spec) : openSession(spec)
}
