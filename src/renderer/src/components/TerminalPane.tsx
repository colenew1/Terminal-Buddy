import { useEffect, useRef } from 'react'
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



interface Props {
  session: Session
  visible: boolean
}

export default function TerminalPane({ session, visible }: Props): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const id = session.id

  // Read live values from the store inside callbacks rather than closing over
  // them, so the terminal never has to be rebuilt when settings change.
  const settings = useStore((s) => s.settings)
  const setActive = useStore((s) => s.setActive)

  useEffect(() => {
    const host = hostRef.current
    if (!host || getTerm(id)) return

    const { settings: st, broadcast: initialBroadcast } = useStore.getState()
    void initialBroadcast

    const term = new Terminal({
      fontSize: st.fontSize,
      fontFamily: st.fontFamily,
      scrollback: st.scrollback,
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

    // WebGL keeps 8 panes smooth, but it is not available everywhere and the
    // context can be lost. Either way, fall back to the DOM renderer quietly.
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose())
      term.loadAddon(webgl)
    } catch {
      /* DOM renderer is fine */
    }

    register(id, { term, fit, search, container: host })

    term.onData((data) => {
      if (useStore.getState().broadcast) {
        for (const s of useStore.getState().sessions) window.buddy.pty.write(s.id, data)
      } else {
        window.buddy.pty.write(id, data)
      }
    })

    // Let app shortcuts and clipboard keys through to the window handler
    // instead of the pty. Returning false here also stops xterm calling
    // preventDefault, which is what used to swallow Ctrl+V as a raw 0x16.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      if (matchShortcut(e) !== null) return false
      const clip = matchClipboard(e)
      if (clip === 'paste' || clip === 'cut') return false
      // Ctrl+C is only a copy when something is selected; otherwise the shell
      // needs it as an interrupt.
      if (clip === 'copy') return !term.hasSelection()
      return true
    })

    term.element?.addEventListener('focusin', () => setActive(id))

    const initialFit = (): void => {
      fitOne(id)
      term.focus()
    }
    requestAnimationFrame(initialFit)
    // Web fonts settle a frame or two late; refit once they have.
    const settle = setTimeout(initialFit, 120)

    return () => {
      clearTimeout(settle)
      unregister(id)
    }
  }, [id, setActive])

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
      if (text) window.buddy.pty.write(id, text)
    }
  }

  return (
    <div
      className={`pane ${visible ? 'is-visible' : 'is-hidden'} ${session.status === 'exited' ? 'is-exited' : ''}`}
      onMouseDown={() => useStore.getState().locked && setActive(id)}
      onContextMenu={onContextMenu}
    >
      <div className="pane-host" ref={hostRef} />
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
