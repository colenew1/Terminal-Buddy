import { useEffect, useRef, useState } from 'react'
import FileDropTarget from './FileDropTarget'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { applyTheme, themeById } from '../lib/themes'
import { matchClipboard } from '../lib/shortcuts'
import { isTerminalReply } from '@shared/terminal-protocol'
import { installTerminalScrolling } from '../lib/terminal-scrolling'

export default function DetachedTerminal({ id }: { id: string }): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const terminal = useRef<Terminal | null>(null)
  const [title, setTitle] = useState('Opening terminal…')
  const [status, setStatus] = useState('Connecting to your live terminal…')
  const [error, setError] = useState('')
  const [attention, setAttention] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(false)
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
      setReduceMotion(settings.reduceMotion)
      setTitle(session.title); setStatus(value.exited ? `Process exited (${value.exitCode ?? 0})` : 'Live terminal · same running session')
      term = new Terminal({ cols: snapshot.cols, rows: snapshot.rows, fontSize: settings.fontSize, fontFamily: settings.fontFamily,
        scrollback: settings.scrollback, scrollOnEraseInDisplay: true, cursorBlink: settings.cursorBlink, theme: themeById(settings.theme).terminal, allowProposedApi: true })
      terminal.current = term
      fit = new FitAddon(); term.loadAddon(fit)
      term.loadAddon(new WebLinksAddon((_event, uri) => window.buddy.app.openExternal(uri)))
      term.open(host.current!)
      installTerminalScrolling(term)
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
    const offAttention = window.buddy.popout.onAttention(setAttention)
    const offSettings = window.buddy.popout.onSettings((settings) => {
      setReduceMotion(settings.reduceMotion)
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
      const action = matchClipboard(event)
      if (action === 'paste') {
        event.preventDefault()
        void window.buddy.clipboard.read().then((text) => { if (text && !disposed) term?.paste(text) })
      } else if (action === 'copy' && term.hasSelection()) {
        event.preventDefault(); window.buddy.clipboard.write(term.getSelection()); term.clearSelection()
      } else if (action === 'cut') event.preventDefault()
    }
    const offPaste = window.buddy.clipboard.onPaste(text => {
      if (!ready || disposed) return
      if (text) term?.paste(text)
      else setError('No text is on the clipboard. Copy the last transcript in Wispr Flow, then paste again.')
    })
    window.addEventListener('keydown', onKey)
    const observer = new ResizeObserver(resize)
    observer.observe(host.current!)
    void window.buddy.popout.init(id).catch((reason) => setError(String(reason)))
    return () => { disposed = true; observer.disconnect(); offPaste(); offInit(); offData(); offExit(); offTitle(); offAttention(); offSettings(); window.removeEventListener('keydown', onKey); term?.dispose(); terminal.current = null }
  }, [id])
  return (
    <div className={`detached-app ${attention ? 'needs-look' : ''} ${reduceMotion ? 'no-motion' : ''}`} onPointerDownCapture={() => window.buddy.popout.seen(id)} onKeyDownCapture={() => window.buddy.popout.seen(id)}>
      <header className="detached-toolbar">
        <div className="detached-heading">
          <strong>{title}</strong><small>Ctrl+Shift+W docks it back</small>
        </div>
        <button className="btn primary" data-dock-back title="Return this terminal to its Terminal Buddy workspace"
          onClick={() => window.buddy.popout.dock(id)}>Dock back ↙</button>
      </header>
      <FileDropTarget enabled={true} canPaste={status.startsWith('Live terminal')}
        focus={() => terminal.current?.focus()} paste={text => terminal.current?.paste(text)}>
      <div className="detached-host" ref={host} onContextMenu={(event) => {
        event.preventDefault()
        const term = terminal.current
        if (term?.hasSelection()) { window.buddy.clipboard.write(term.getSelection()); term.clearSelection() }
        else void window.buddy.clipboard.read().then((text) => { if (text) terminal.current?.paste(text) })
      }} />
      </FileDropTarget>
      <footer className="detached-status">{error || status}<span>Closing this window docks it back.</span></footer>
    </div>
  )
}
