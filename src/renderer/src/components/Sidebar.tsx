import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatEntry, SkillEntry } from '@shared/types'
import { useStore, type SidebarTab } from '../store/useStore'
import { bytes, fuzzy, shortPath, timeAgo } from '../lib/format'
import { scanLine } from '../lib/copy'
import ChatDetail from './ChatDetail'

const TABS: { id: SidebarTab; label: string }[] = [
  { id: 'chats', label: 'Chats' },
  { id: 'skills', label: 'Skills' },
  { id: 'projects', label: 'Projects' }
]

export function resumeCommandFor(entry: ChatEntry): string {
  const { settings } = useStore.getState()
  const template = entry.agent === 'claude' ? settings.claudeResumeCommand : settings.codexResumeCommand
  return template.replace('{id}', entry.id)
}

export async function resumeChat(entry: ChatEntry): Promise<void> {
  const { openSession, notify } = useStore.getState()
  if (!entry.cwd) notify('That chat has no recorded folder — opening in your home directory.')
  await openSession({
    cwd: entry.cwd,
    title: entry.title.slice(0, 28),
    initialCommand: resumeCommandFor(entry)
  })
}

export default function Sidebar(): React.JSX.Element {
  const tab = useStore((s) => s.sidebarTab)
  const setSidebar = useStore((s) => s.setSidebar)
  const width = useStore((s) => s.sidebarWidth)
  const setWidth = useStore((s) => s.setSidebarWidth)
  const catalog = useStore((s) => s.catalog)
  const loading = useStore((s) => s.catalogLoading)
  const progress = useStore((s) => s.scanProgress)
  const loadCatalog = useStore((s) => s.loadCatalog)
  const openSession = useStore((s) => s.openSession)
  const notify = useStore((s) => s.notify)

  const [q, setQ] = useState('')
  const [agentFilter, setAgentFilter] = useState<'all' | 'claude' | 'codex'>('all')
  const [showInternal, setShowInternal] = useState(false)
  const [detail, setDetail] = useState<ChatEntry | null>(null)
  const [skillDetail, setSkillDetail] = useState<SkillEntry | null>(null)

  const dragging = useRef(false)
  useEffect(() => {
    const move = (e: MouseEvent): void => {
      if (dragging.current) setWidth(e.clientX)
    }
    const up = (): void => {
      dragging.current = false
      document.body.classList.remove('resizing')
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [setWidth])

  const chats = useMemo(() => {
    const all = catalog?.chats ?? []
    return all.filter((c) => {
      if (agentFilter !== 'all' && c.agent !== agentFilter) return false
      if (!showInternal && c.internal) return false
      if (!q) return true
      return fuzzy(q, `${c.title} ${c.preview} ${c.project} ${c.cwd}`)
    })
  }, [catalog, q, agentFilter, showInternal])

  const skills = useMemo(() => {
    const all = catalog?.skills ?? []
    return all.filter((s) => {
      if (agentFilter !== 'all' && s.agent !== agentFilter) return false
      if (!q) return true
      return fuzzy(q, `${s.name} ${s.description} ${s.origin}`)
    })
  }, [catalog, q, agentFilter])

  const projects = useMemo(() => {
    const all = catalog?.projects ?? []
    return all.filter((p) => (!q ? true : fuzzy(q, `${p.name} ${p.path}`)))
  }, [catalog, q])

  const hiddenCount = (catalog?.chats ?? []).filter((c) => c.internal).length

  return (
    <aside className="sidebar" style={{ width }}>
      <div className="sidebar-head">
        <div className="seg full">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'is-on' : ''} onClick={() => setSidebar(true, t.id)}>
              {t.label}
              <span className="seg-count">
                {t.id === 'chats' ? chats.length : t.id === 'skills' ? skills.length : projects.length}
              </span>
            </button>
          ))}
        </div>

        <input
          className="search"
          placeholder={`Filter ${tab}…`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        <div className="filter-row">
          {tab !== 'projects' && (
            <div className="seg small">
              {(['all', 'claude', 'codex'] as const).map((a) => (
                <button key={a} className={agentFilter === a ? 'is-on' : ''} onClick={() => setAgentFilter(a)}>
                  {a}
                </button>
              ))}
            </div>
          )}
          {tab === 'chats' && hiddenCount > 0 && (
            <label className="check" title="Sub-agent runs and injected prompts">
              <input
                type="checkbox"
                checked={showInternal}
                onChange={(e) => setShowInternal(e.target.checked)}
              />
              internal ({hiddenCount})
            </label>
          )}
          <button className="link" disabled={loading} onClick={() => void loadCatalog(true)}>
            {loading ? 'Scanning…' : 'Rescan'}
          </button>
        </div>

        {loading && progress && progress.total > 0 && (
          <div className="progress">
            <div className="progress-bar" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            <span>
              {progress.phase === 'skills'
                ? 'Leafing through your skills…'
                : `${scanLine(Math.floor(progress.done / 25))} ${progress.done}/${progress.total}`}
            </span>
          </div>
        )}
      </div>

      <div className="sidebar-body">
        {!catalog && !loading && <div className="hint">Nothing indexed yet — hit Rescan and I&rsquo;ll go looking.</div>}

        {tab === 'chats' &&
          chats.map((c) => (
            <div key={`${c.agent}:${c.path}`} className="row" onClick={() => setDetail(c)}>
              <div className="row-main">
                <span className={`badge ${c.agent}`}>{c.agent}</span>
                <span className="row-title">{c.title}</span>
              </div>
              {c.preview && c.preview !== c.title && <div className="row-sub">{c.preview}</div>}
              <div className="row-meta">
                <span title={c.cwd}>{c.cwd ? shortPath(c.cwd, 2) : c.project}</span>
                <span>·</span>
                <span>{c.turns} turns</span>
                <span>·</span>
                <span>{timeAgo(c.updatedAt)}</span>
              </div>
              <div className="row-actions">
                <button
                  className="btn tiny primary"
                  onClick={(e) => {
                    e.stopPropagation()
                    void resumeChat(c)
                  }}
                >
                  Resume
                </button>
                <button
                  className="btn tiny"
                  onClick={(e) => {
                    e.stopPropagation()
                    void window.buddy.catalog.exportMarkdown(c).then((r) => notify(r.message))
                  }}
                >
                  Export .md
                </button>
              </div>
            </div>
          ))}

        {tab === 'skills' &&
          skills.map((s) => (
            <div key={s.id} className="row" onClick={() => setSkillDetail(s)}>
              <div className="row-main">
                <span className={`badge ${s.agent}`}>{s.agent}</span>
                <span className="row-title">{s.name}</span>
                <span className="row-origin">{s.origin}</span>
              </div>
              {s.description && <div className="row-sub clamp-3">{s.description}</div>}
            </div>
          ))}

        {tab === 'projects' &&
          projects.map((p) => (
            <div key={p.path} className="row" onClick={() => void openSession({ cwd: p.path })}>
              <div className="row-main">
                <span className="row-title">{p.name}</span>
                {!p.exists && <span className="badge gone">missing</span>}
              </div>
              <div className="row-sub mono">{p.path}</div>
              <div className="row-meta">
                <span>{p.chats} chats</span>
                <span>·</span>
                <span>{timeAgo(p.lastActive)}</span>
              </div>
            </div>
          ))}

        {catalog && catalog.errors.length > 0 && (
          <details className="errors">
            <summary>{catalog.errors.length} files could not be read</summary>
            {catalog.errors.slice(0, 40).map((e, i) => (
              <div key={i} className="mono tiny">
                {e}
              </div>
            ))}
          </details>
        )}
      </div>

      <div
        className="sidebar-grip"
        onMouseDown={() => {
          dragging.current = true
          document.body.classList.add('resizing')
        }}
      />

      {detail && <ChatDetail entry={detail} onClose={() => setDetail(null)} />}

      {skillDetail && (
        <div className="modal-backdrop" onClick={() => setSkillDetail(null)}>
          <div className="modal narrow" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h3>{skillDetail.name}</h3>
                <div className="row-meta">
                  <span className={`badge ${skillDetail.agent}`}>{skillDetail.agent}</span>
                  <span>{skillDetail.origin}</span>
                  <span>·</span>
                  <span>{skillDetail.source}</span>
                </div>
              </div>
              <button className="icon-btn" onClick={() => setSkillDetail(null)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p>{skillDetail.description || 'No description in the frontmatter.'}</p>
              <div className="mono tiny path">{skillDetail.path}</div>
            </div>
            <div className="modal-foot">
              <button
                className="btn primary"
                onClick={() => {
                  const { activeId } = useStore.getState()
                  if (!activeId) return notify('Open a terminal first.')
                  window.buddy.pty.write(activeId, `/${skillDetail.name}`)
                  setSkillDetail(null)
                }}
              >
                Type /{skillDetail.name}
              </button>
              <button className="btn" onClick={() => window.buddy.app.revealPath(skillDetail.path)}>
                Show file
              </button>
              <button
                className="btn"
                onClick={() => {
                  void navigator.clipboard.writeText(skillDetail.path)
                  notify('Path copied.')
                }}
              >
                Copy path
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}

export { bytes }
