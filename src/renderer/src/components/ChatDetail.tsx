import { useEffect, useState } from 'react'
import type { ChatEntry, ChatTranscript } from '@shared/types'
import { useStore } from '../store/useStore'
import { bytes, timeAgo } from '../lib/format'
import { resumeChat, resumeCommandFor } from './Sidebar'

interface Props {
  entry: ChatEntry
  onClose: () => void
}

export default function ChatDetail({ entry, onClose }: Props): React.JSX.Element {
  const [data, setData] = useState<ChatTranscript | null>(null)
  const [error, setError] = useState<string | null>(null)
  const notify = useStore((s) => s.notify)

  useEffect(() => {
    let alive = true
    setData(null)
    setError(null)
    window.buddy.catalog
      .transcript(entry)
      .then((t) => {
        if (alive) setData(t)
      })
      .catch((e: Error) => {
        if (alive) setError(e.message)
      })
    return () => {
      alive = false
    }
  }, [entry])

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

        <div className="modal-body transcript">
          {error && <div className="hint error">Could not read the transcript: {error}</div>}
          {!data && !error && <div className="hint">Reading transcript…</div>}
          {data?.turns.length === 0 && <div className="hint">No readable messages in this file.</div>}
          {data?.turns.map((t, i) => (
            <div key={i} className={`turn ${t.role}`}>
              <div className="turn-role">{t.role === 'user' ? 'You' : entry.agent}</div>
              <div className="turn-text">{t.text}</div>
            </div>
          ))}
          {data?.truncated && <div className="hint">Transcript truncated for display.</div>}
        </div>

        <div className="modal-foot">
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
