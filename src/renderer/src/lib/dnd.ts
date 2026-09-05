import type { Agent, ChatEntry, SkillEntry } from '@shared/types'
import type { Session } from '../store/useStore'

/**
 * Dragging catalog items onto terminals.
 *
 * The payload lives in a module variable rather than in `dataTransfer`, because
 * the browser deliberately hides `getData()` during `dragover` — and dragover is
 * exactly when a pane needs to know whether it can accept the thing to light up
 * correctly. Everything here is one window, so a shared variable is honest.
 */

export type DragItem =
  | { kind: 'chat'; entry: ChatEntry }
  | { kind: 'skill'; entry: SkillEntry }

export const DRAG_MIME = 'application/x-terminal-buddy'

let current: DragItem | null = null

export function setDragItem(item: DragItem | null): void {
  current = item
}

export function getDragItem(): DragItem | null {
  return current
}

export interface DropVerdict {
  ok: boolean
  /** Shown on the pane while hovering, and as a toast on an invalid drop. */
  reason: string
}

/**
 * Whether `item` can be dropped on `session`, given what is running there.
 *
 * `running` is null when the pane sits at a shell prompt, and undefined when
 * the probe has not answered yet — in which case we allow the drop rather than
 * block on a guess.
 */
export function canDrop(item: DragItem, session: Session, running: Agent | null | undefined): DropVerdict {
  if (session.detached) return { ok: false, reason: 'Dock this terminal back before dropping a chat or skill here.' }
  if (session.status === 'exited') {
    return { ok: false, reason: 'That terminal has exited' }
  }

  const agent = item.kind === 'chat' ? item.entry.agent : item.entry.agent

  if (item.kind === 'chat') {
    if (session.replacing) return { ok: false, reason: 'Opening a chat here already' }
    if (session.hasConversation || session.hasInput) {
      return { ok: false, reason: 'This pane has a conversation or unsent input. Use a new terminal.' }
    }
    return { ok: true, reason: `Replace this empty pane with ${agent} chat “${item.entry.title}”` }
  }

  if (running && running !== agent) {
    return { ok: false, reason: `That terminal is running ${running}, not ${agent}` }
  }
  if (running === agent) return { ok: true, reason: `Type /${item.entry.name} into ${running}` }
  return { ok: true, reason: `Start ${agent} here with /${item.entry.name}` }
}

export function dragLabel(item: DragItem): string {
  return item.kind === 'chat' ? item.entry.title : `/${item.entry.name}`
}
