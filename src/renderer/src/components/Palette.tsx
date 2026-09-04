import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { fuzzy, shortPath, timeAgo } from '../lib/format'
import { resumeChat } from './Sidebar'

interface Item {
  key: string
  group: string
  label: string
  hint?: string
  run: () => void | Promise<void>
}

export default function Palette(): React.JSX.Element {
  const close = (): void => useStore.getState().setPalette(false)
  const catalog = useStore((s) => s.catalog)
  const sessions = useStore((s) => s.sessions)
  const activeId = useStore((s) => s.activeId)
  const [q, setQ] = useState('')
  const [cursor, setCursor] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const items = useMemo<Item[]>(() => {
    const s = useStore.getState()
    const active = sessions.find((x) => x.id === activeId)
    const out: Item[] = [
      {
        key: 'cmd:new',
        group: 'Command',
        label: 'New terminal',
        hint: 'Ctrl+Shift+T',
        run: async () => {
          const paths = await window.buddy.app.paths()
          void s.openSession({ cwd: active?.cwd ?? paths.home })
        }
      },
      {
        key: 'cmd:open',
        group: 'Command',
        label: 'Open folder…',
        run: async () => {
          const dir = await window.buddy.app.pickFolder()
          if (dir) void s.openSession({ cwd: dir })
        }
      },
      {
        key: 'cmd:layout',
        group: 'Command',
        label: s.layout === 'tabs' ? 'Switch to grid view' : 'Switch to tabs view',
        hint: 'Ctrl+Shift+G',
        run: () => s.setLayout(s.layout === 'tabs' ? 'grid' : 'tabs')
      },
      {
        key: 'cmd:broadcast',
        group: 'Command',
        label: s.broadcast ? 'Turn broadcast off' : 'Turn broadcast on',
        hint: 'Ctrl+Shift+B',
        run: () => s.toggleBroadcast()
      },
      {
        key: 'cmd:rescan',
        group: 'Command',
        label: 'Rescan skills and chats',
        run: () => void s.loadCatalog(true)
      },
      {
        key: 'cmd:settings',
        group: 'Command',
        label: 'Settings',
        hint: 'Ctrl+,',
        run: () => s.setSettingsOpen(true)
      }
    ]

    for (const sess of sessions) {
      out.push({
        key: `sess:${sess.id}`,
        group: 'Terminal',
        label: sess.title,
        hint: shortPath(sess.cwd, 2),
        run: () => s.setActive(sess.id)
      })
    }

    for (const p of (catalog?.projects ?? []).slice(0, 60)) {
      out.push({
        key: `proj:${p.path}`,
        group: 'Project',
        label: p.name,
        hint: shortPath(p.path, 3),
        run: () => void s.openSession({ cwd: p.path })
      })
    }

    for (const c of (catalog?.chats ?? []).filter((x) => !x.internal).slice(0, 200)) {
      out.push({
        key: `chat:${c.path}`,
        group: 'Resume',
        label: c.title,
        hint: `${c.agent} · ${timeAgo(c.updatedAt)}`,
        run: () => void resumeChat(c)
      })
    }

    for (const sk of (catalog?.skills ?? []).slice(0, 200)) {
      out.push({
        key: `skill:${sk.id}`,
        group: 'Skill',
        label: `/${sk.name}`,
        hint: sk.origin,
        run: () => {
          const id = useStore.getState().activeId
          if (id) window.buddy.pty.write(id, `/${sk.name}`)
        }
      })
    }
    return out
  }, [catalog, sessions, activeId])

  const filtered = useMemo(() => {
    const r = items.filter((i) => fuzzy(q, `${i.label} ${i.hint ?? ''} ${i.group}`))
    return r.slice(0, 200)
  }, [items, q])

  useEffect(() => setCursor(0), [q])

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('.pal-item.is-cursor')
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') return close()
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => Math.min(filtered.length - 1, c + 1))
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(0, c - 1))
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const item = filtered[cursor]
      if (item) {
        close()
        void item.run()
      }
    }
  }

  return (
    <div className="modal-backdrop top" onClick={close}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="pal-input"
          placeholder="Jump to a terminal, project, chat or skill…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="pal-list" ref={listRef}>
          {filtered.length === 0 && <div className="hint">No matches.</div>}
          {filtered.map((i, idx) => (
            <div
              key={i.key}
              className={`pal-item ${idx === cursor ? 'is-cursor' : ''}`}
              onMouseEnter={() => setCursor(idx)}
              onClick={() => {
                close()
                void i.run()
              }}
            >
              <span className="pal-group">{i.group}</span>
              <span className="pal-label">{i.label}</span>
              {i.hint && <span className="pal-hint">{i.hint}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
