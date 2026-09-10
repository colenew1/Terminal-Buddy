import { useEffect, useRef } from 'react'
import FileDropTarget from './FileDropTarget'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { useStore, type Session } from '../store/useStore'
import { fitOne, register, unregister, get as getTerm } from '../lib/terminals'
import { matchShortcut, matchClipboard } from '../lib/shortcuts'
import { themeById } from '../lib/themes'
import { arrowsFor, computeClickDelta } from '../lib/cursor'
import { isTerminalReply } from '@shared/terminal-protocol'
import { installTerminalScrolling } from '../lib/terminal-scrolling'



interface Props {
  session: Session
  visible: boolean
  interactive: boolean
}

export default function TerminalPane({ session, visible, interactive }: Props): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const id = session.id
  // Read live values from the store inside callbacks rather than closing over
  // them, so the terminal never has to be rebuilt when settings change.
  const settings = useStore((s) => s.settings)
  const setActive = useStore((s) => s.setActive)
  const agent = useStore((s) => s.agents[id])
  const isCodex = agent === 'codex' || session.resume?.agent === 'codex'

  useEffect(() => {
    const host = hostRef.current
    if (!host || getTerm(id)) return

    const { settings: st, broadcast: initialBroadcast } = useStore.getState()
    void initialBroadcast

    const term = new Terminal({
      fontSize: st.fontSize,
      fontFamily: st.fontFamily,
      scrollback: st.scrollback,
      scrollOnEraseInDisplay: true,
      cursorBlink: st.cursorBlink,
      allowProposedApi: true,
      macOptionIsMeta: true,
      theme: themeById(st.theme).terminal
    })

    const fit = new FitAddon()
    const search = new SearchAddon()
    term.loadAddon(fit)
    term.loadAddon(search)
    term.loadAddon(new WebLinksAddon((_e, uri) => window.buddy.app.openExternal(uri)))

    term.open(host)
    installTerminalScrolling(term)

    register(id, { term, fit, search, container: host })

    term.onData((data) => {
      if (useStore.getState().transferBusy || getTerm(id)?.detached || isTerminalReply(data)) return
      // xterm also emits terminal-protocol replies. Those are not user input.
      const userInput = /^[^\x00-\x1f\x7f]/.test(data) || data === '\r' || data.startsWith('\x1b[200~')
      if (useStore.getState().broadcast) {
        for (const s of useStore.getState().sessions) {
          if (userInput) useStore.getState().markInput(s.id)
          window.buddy.pty.write(s.id, data, true)
        }
      } else {
        if (userInput) useStore.getState().markInput(id)
        window.buddy.pty.write(id, data)
      }
    })

    // Let app shortcuts and clipboard keys through to the window handler
    // instead of the pty. Returning false here also stops xterm calling
    // preventDefault, which is what used to swallow Ctrl+V as a raw 0x16.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      const s = useStore.getState()
      if (e.key === 'Escape' && s.focusedSessionId && !s.settingsOpen && !s.paletteOpen && !s.newSessionOpen && !s.pendingCloseId && !s.walkthroughOpen && !s.linkSessionId) return false
      if (matchShortcut(e) !== null) return false
      const clip = matchClipboard(e)
      if (clip === 'paste' || clip === 'cut') return false
      // Ctrl+C is only a copy when something is selected; otherwise the shell
      // needs it as an interrupt.
      if (clip === 'copy') return !term.hasSelection()
      return true
    })

    term.element?.addEventListener('focusin', () => setActive(id))

    // Click anywhere in the line you are typing and the cursor goes there.
    // See lib/cursor.ts for why this is arrow keys under the hood.
    const onMouseUp = (e: MouseEvent): void => {
      if (e.button !== 0 || e.shiftKey) return
      const st = useStore.getState()
      if (!st.locked) return
      if (!st.settings.clickToPosition && !e.altKey) return
      // A click on an unfocused pane just focuses it; the next one positions.
      if (st.activeId !== id) return

      const screenEl = host.querySelector<HTMLElement>('.xterm-screen')
      if (!screenEl) return
      const point = { clientX: e.clientX, clientY: e.clientY }

      // Let xterm settle its selection first — a drag is a selection, not a
      // reposition, and hasSelection() is only accurate after this tick.
      setTimeout(() => {
        if (term.hasSelection()) return
        const delta = computeClickDelta(term, screenEl, point)
        if (delta === null) return
        const seq = arrowsFor(term, delta)
        if (seq) window.buddy.pty.write(id, seq)
      }, 0)
    }
    term.element?.addEventListener('mouseup', onMouseUp)

    const initialFit = (): void => {
      fitOne(id)
    }
    requestAnimationFrame(initialFit)
    // Web fonts settle a frame or two late; refit once they have.
    const settle = setTimeout(initialFit, 120)

    return () => {
      clearTimeout(settle)
      term.element?.removeEventListener('mouseup', onMouseUp)
      unregister(id)
    }
  }, [id, setActive])

  useEffect(() => {
    const h = getTerm(id)
    if (!h || isCodex) return
    // Codex frequently repaints rows away from its input cursor. The WebGL
    // addon's partial-row model clears that cursor on unrelated row updates.
    // Use xterm's DOM renderer for Codex, including when started in a plain shell.
    const webgl = new WebglAddon()
    let disposed = false
    const dispose = (): void => { if (!disposed) { disposed = true; webgl.dispose() } }
    try {
      webgl.onContextLoss(dispose)
      h.term.loadAddon(webgl)
    } catch { dispose() }
    return dispose
  }, [id, isCodex])

  // Push setting changes onto the existing instance rather than recreating it.
  useEffect(() => {
    const h = getTerm(id)
    if (!h) return
    h.term.options.fontSize = settings.fontSize
    h.term.options.fontFamily = settings.fontFamily
    h.term.options.scrollback = settings.scrollback
    h.term.options.cursorBlink = settings.cursorBlink
    h.term.options.theme = themeById(settings.theme).terminal
    fitOne(id)
  }, [id, settings.fontSize, settings.fontFamily, settings.scrollback, settings.cursorBlink, settings.theme])

  // One observer per pane. Coalesced through rAF so a sidebar drag does not
  // fire a pty resize per frame.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let frame = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => fitOne(id))
    })
    ro.observe(host)
    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
    }
  }, [id])

  // Becoming visible after being hidden needs a repaint: the WebGL renderer
  // skips frames while the pane is not rendered.
  useEffect(() => {
    if (!visible) return
    const h = getTerm(id)
    if (!h) return
    const t = requestAnimationFrame(() => {
      fitOne(id)
      h.term.refresh(0, h.term.rows - 1)
    })
    return () => cancelAnimationFrame(t)
  }, [visible, id])

  const onContextMenu = async (e: React.MouseEvent): Promise<void> => {
    e.preventDefault()
    const h = getTerm(id)
    if (!h) return
    const sel = h.term.getSelection()
    if (sel) {
      window.buddy.clipboard.write(sel)
      h.term.clearSelection()
    } else {
      const text = await window.buddy.clipboard.read()
      if (text) {
        useStore.getState().markInput(id)
        h.term.paste(text)
      }
    }
  }

  return (
    <div
      inert={!interactive}
      className={`pane ${visible ? 'is-visible' : 'is-hidden'} ${session.status === 'exited' ? 'is-exited' : ''}`}
      onMouseDown={() => useStore.getState().locked && setActive(id)}
      onContextMenu={onContextMenu}
    >
      <FileDropTarget enabled={interactive} canPaste={session.status !== 'exited'}
        focus={() => getTerm(id)?.term.focus()}
        paste={text => { setActive(id); getTerm(id)?.term.paste(text) }}>
        <div className="pane-host" ref={hostRef} />
      </FileDropTarget>
      {session.status === 'exited' && (
        <div className="pane-exit">
          <span>
            Process exited{typeof session.exitCode === 'number' ? ` (code ${session.exitCode})` : ''}
          </span>
        </div>
      )}
    </div>
  )
}
