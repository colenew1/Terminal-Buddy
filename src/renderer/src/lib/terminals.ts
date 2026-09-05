import type { TerminalSnapshot } from '@shared/types'
import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import type { SearchAddon } from '@xterm/addon-search'

export interface TermHandle {
  term: Terminal
  fit: FitAddon
  search: SearchAddon
  container: HTMLElement
  detached?: boolean
  restoring?: boolean
}

/**
 * xterm instances are deliberately kept outside React state. They are mutable,
 * expensive, and must survive every re-render and layout switch — a pane that
 * unmounts loses its scrollback and orphans its pty.
 */
const registry = new Map<string, TermHandle>()
const arriving = new Map<string, { snapshot: TerminalSnapshot; queue: string[] }>()
export function prepareArrival(id: string, snapshot: TerminalSnapshot): void {
  arriving.set(id, { snapshot, queue: [] })
}

export function register(id: string, handle: TermHandle): void {
  registry.set(id, handle)
  const pending = arriving.get(id)
  if (pending) {
    arriving.delete(id)
    handle.restoring = true
    handle.term.resize(pending.snapshot.cols, pending.snapshot.rows)
    handle.term.write(pending.snapshot.data)
    for (const data of pending.queue) handle.term.write(data)
    handle.term.write('', () => {
      if (registry.get(id) !== handle) return
      handle.restoring = false
      fitOne(id)
    })
  }
}

export function unregister(id: string): void {
  const h = registry.get(id)
  if (!h) return
  registry.delete(id)
  try {
    h.term.dispose()
  } catch {
    /* already disposed */
  }
}

export function get(id: string): TermHandle | undefined {
  return registry.get(id)
}

export function ids(): string[] {
  return [...registry.keys()]
}

export function focus(id: string): void {
  registry.get(id)?.term.focus()
}

export function writeTo(id: string, data: string): void {
  const pending = arriving.get(id)
  if (pending) pending.queue.push(data)
  else registry.get(id)?.term.write(data)
}

/** Send the same keystrokes to every live pty (broadcast mode). */
export function broadcastInput(data: string): void {
  for (const id of registry.keys()) window.buddy.pty.write(id, data, true)
}

/**
 * Fit is only meaningful when the element actually has a box. Hidden panes in
 * tab mode are kept at full size precisely so this stays true, but guard anyway
 * — a zero-size fit would resize the pty to nonsense.
 */
export function fitOne(id: string): void {
  const h = registry.get(id)
  if (!h || h.detached || h.restoring) return
  const el = h.container
  if (!el || el.offsetWidth < 20 || el.offsetHeight < 20) return
  try {
    const dims = h.fit.proposeDimensions()
    if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows)) return
    if (dims.cols < 2 || dims.rows < 1) return
    if (dims.cols !== h.term.cols || dims.rows !== h.term.rows) {
      h.fit.fit()
      window.buddy.pty.resize(id, h.term.cols, h.term.rows)
    }
  } catch {
    /* renderer not ready yet */
  }
}

export function fitAll(): void {
  for (const id of registry.keys()) fitOne(id)
}
