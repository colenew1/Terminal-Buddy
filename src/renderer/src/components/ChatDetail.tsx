import { useEffect } from 'react'
import type { ChatEntry } from '@shared/types'
import { useStore } from '../store/useStore'
import { bytes, timeAgo } from '../lib/format'
import { resumeChat, resumeCommandFor } from '../lib/commands'
import RenameChatButton from './RenameChatButton'

interface Props {
  entry: ChatEntry
  onClose: () => void
}

export default function ChatDetail({ entry: savedEntry, onClose }: Props): React.JSX.Element {
  const entry = useStore(s => s.catalog?.chats.find(chat => chat.agent === savedEntry.agent && chat.id === savedEntry.id)) ?? savedEntry
  const notify = useStore((s) => s.notify)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const command = resumeCommandFor(entry)

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="grow">
            <h3>{entry.title}</h3>
            <div className="row-meta">
              <span className={`badge ${entry.agent}`}>{entry.agent}</span>
              <span title={entry.cwd}>{entry.cwd || entry.project}</span>
              <span>·</span>
              <span>{entry.turns} turns</span>
              <span>·</span>
              <span>{bytes(entry.bytes)}</span>
              <span>·</span>
              <span>{timeAgo(entry.updatedAt)}</span>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          <p>{entry.preview || 'Resume this saved chat in a live terminal.'}</p>
          <p className="hint">Messages, questions, and approvals stay in the agent's terminal. Export Markdown if you need a readable history file.</p>
        </div>

        <div className="modal-foot">
          <RenameChatButton entry={entry} />
          <button
            className="btn primary"
            onClick={() => {
              void resumeChat(entry)
              onClose()
            }}
          >
            Resume in new terminal
          </button>
          <button
            className="btn"
            onClick={() => void window.buddy.catalog.exportMarkdown(entry).then((r) => notify(r.message))}
          >
            Export Markdown
          </button>
          <button className="btn" onClick={() => window.buddy.app.revealPath(entry.path)}>
            Show file
          </button>
          <div className="grow" />
          <code
            className="cmd"
            title="Click to copy"
            onClick={() => {
              void navigator.clipboard.writeText(command)
              notify('Command copied.')
            }}
          >
            {command}
          </code>
          {entry.altId && (
            <button
              className="btn tiny"
              title="Codex records a thread id and a rollout id. If resume fails, try the other one."
              onClick={() => {
                void navigator.clipboard.writeText(entry.altId!)
                notify(`Alternate id copied: ${entry.altId}`)
              }}
            >
              alt id
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
