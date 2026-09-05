import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { applyTheme, themeById } from '../lib/themes'
import { matchClipboard } from '../lib/shortcuts'
import { isTerminalReply } from '@shared/terminal-protocol'

export default function DetachedTerminal({ id }: { id: string }): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const terminal = useRef<Terminal | null>(null)
  const [title, setTitle] = useState('Opening terminal…')
  const [status, setStatus] = useState('Connecting to your live terminal…')
  const [error, setError] = useState('')
  const dragging = useRef(false)
  useEffect(() => {
    let term: Terminal | null = null, fit: FitAddon | null = null, ready = false, disposed = false
    const resize = (): void => {
      if (!ready || !term || !fit) return
      fit.fit()
      window.buddy.pty.resize(id, term.cols, term.rows)
    }
    const offInit = window.buddy.popout.onInit((value) => {
      if (disposed || term) return
      const { settings, snapshot, session } = value
      applyTheme(settings.theme)
      setTitle(session.title); setStatus(value.exited ? `Process exited (${value.exitCode ?? 0})` : 'Live terminal · same running session')
      term = new Terminal({ cols: snapshot.cols, rows: snapshot.rows, fontSize: settings.fontSize, fontFamily: settings.fontFamily,
        scrollback: settings.scrollback, cursorBlink: settings.cursorBlink, theme: themeById(settings.theme).terminal, allowProposedApi: true })
      terminal.current = term
      fit = new FitAddon(); term.loadAddon(fit)
      term.loadAddon(new WebLinksAddon((_event, uri) => window.buddy.app.openExternal(uri)))
      term.open(host.current!)
      term.onData((data) => { if (ready && !isTerminalReply(data)) window.buddy.pty.write(id, data) })
      term.attachCustomKeyEventHandler((event) => {
        if (event.type !== 'keydown') return true
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.code === 'KeyW') return false
        const action = matchClipboard(event)
        return action === 'copy' ? !term?.hasSelection() : action !== 'paste' && action !== 'cut'
      })
      term.write(snapshot.data, () => { if (disposed) return; ready = true; resize(); term?.focus() })
    })
    const offData = window.buddy.pty.onData((sessionId, data) => { if (sessionId === id) term?.write(data) })
    const offExit = window.buddy.pty.onExit((sessionId, code) => { if (sessionId === id) setStatus(`Process exited (${code})`) })
    const offTitle = window.buddy.popout.onTitle(setTitle)
    const offSettings = window.buddy.popout.onSettings((settings) => {
      applyTheme(settings.theme)
      if (!term) return
      term.options.fontSize = settings.fontSize; term.options.fontFamily = settings.fontFamily
      term.options.scrollback = settings.scrollback; term.options.cursorBlink = settings.cursorBlink
      term.options.theme = themeById(settings.theme).terminal
      resize()
    })
    const onKey = (event: KeyboardEvent): void => {
      if (!term || !ready) return
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.code === 'KeyW') {
        event.preventDefault(); window.buddy.popout.dock(id); return
      }
      if (event.key === 'Escape' && dragging.current) {
        dragging.current = false; window.buddy.popout.drag(id, 'cancel', { x: window.screenX, y: window.screenY }); return
      }
      const action = matchClipboard(event)
      if (action === 'paste') {
        event.preventDefault()
        void window.buddy.clipboard.read().then((text) => { if (text && !disposed) term?.paste(text) })
      } else if (action === 'copy' && term.hasSelection()) {
        event.preventDefault(); window.buddy.clipboard.write(term.getSelection()); term.clearSelection()
      } else if (action === 'cut') event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    const observer = new ResizeObserver(resize)
    observer.observe(host.current!)
    void window.buddy.popout.init(id).catch((reason) => setError(String(reason)))
    return () => { disposed = true; observer.disconnect(); offInit(); offData(); offExit(); offTitle(); offSettings(); window.removeEventListener('keydown', onKey); term?.dispose(); terminal.current = null }
  }, [id])
  const point = (event: React.PointerEvent): { x: number; y: number } => ({ x: event.screenX, y: event.screenY })
  return (
    <div className="detached-app">
      <header className="detached-toolbar">
        <div className="detached-grip" data-popout-grip title="Drag this handle to move; drop on Terminal Buddy’s docking strip to return"
          onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); dragging.current = true; window.buddy.popout.drag(id, 'start', point(event)) }}
          onPointerMove={(event) => { if (dragging.current) window.buddy.popout.drag(id, 'move', point(event)) }}
          onPointerUp={(event) => { if (dragging.current) { dragging.current = false; window.buddy.popout.drag(id, 'end', point(event)) } }}
          onPointerCancel={(event) => { dragging.current = false; window.buddy.popout.drag(id, 'cancel', point(event)) }}
          onLostPointerCapture={(event) => { if (dragging.current) { dragging.current = false; window.buddy.popout.drag(id, 'cancel', point(event)) } }}>
          <span aria-hidden="true">⠿</span><strong>{title}</strong><small>Drag to dock</small>
        </div>
        <button className="btn" data-dock-back onClick={() => window.buddy.popout.dock(id)}>Dock back ↙</button>
      </header>
      <div className="detached-host" ref={host} onContextMenu={(event) => {
        event.preventDefault()
        const term = terminal.current
        if (term?.hasSelection()) { window.buddy.clipboard.write(term.getSelection()); term.clearSelection() }
        else void window.buddy.clipboard.read().then((text) => { if (text) terminal.current?.paste(text) })
      }} />
      <footer className="detached-status">{error || status}<span>Closing this window docks it back.</span></footer>
    </div>
  )
}
