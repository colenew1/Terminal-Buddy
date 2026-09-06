import type { TransferState } from '@shared/types'
import { useStore, type Session } from '../store/useStore'
import { findCritter, pickCritter } from './critters'
import { prepareArrival } from './terminals'

export function connectWindowTransfers(): () => void {
  const offRequest = window.buddy.workspace.onTransferRequest(token => {
    const s = useStore.getState()
    const error = !s.ready || s.restoreItems || s.restoring || s.walkthroughOpen || s.presetsOpen || s.pendingCloseId || s.linkSessionId || s.sessions.some(x => x.replacing)
      ? 'Finish opening or recovering sessions in each window before moving terminals.' : undefined
    useStore.setState({ transferBusy: true })
    const state: TransferState = {
      error,
      sessions: s.sessions.map(session => ({ session, critter: session.critter.name,
        span: session.span, pos: session.pos, hasInput: session.hasInput, hasConversation: session.hasConversation,
        attention: session.attention, unseen: session.unseen, busy: session.busy, lastDataAt: session.lastDataAt,
        agent: s.agents[session.id] ?? null, feeds: s.feeds[session.id] ?? [] })),
      workspace: { sessions: s.sessions.map(x => ({ cwd: x.cwd, shellId: x.shellId, title: x.title,
        assistantId: x.assistantId, assistantName: x.assistantName, resume: x.resume, agent: x.resume?.agent ?? s.agents[x.id] ?? undefined, critter: x.critter.name, span: x.span, pos: x.pos })),
        layout: s.layout, gridSizes: s.gridSizes, activeIndex: Math.max(0, s.sessions.findIndex(x => x.id === s.activeId)),
        unrestoredSessions: s.unrestoredSessions }
    }
    window.buddy.workspace.transferReply(token, state)
  })
  const offArrival = window.buddy.workspace.onTransferArrive((arrivals, recovery) => {
    const s = useStore.getState()
    const sessions: Session[] = arrivals.map(item => {
      prepareArrival(item.session.id, item.snapshot)
      return { ...item.session, status: item.exited ? 'exited' : 'running', exitCode: item.exitCode,
        critter: findCritter(item.critter) ?? pickCritter(s.settings.critterPack, []), span: item.span, pos: item.pos,
        hasInput: item.hasInput, hasConversation: item.hasConversation, attention: item.attention,
        unseen: item.unseen, busy: item.busy, lastDataAt: item.lastDataAt, replacing: false, detached: false }
    })
    useStore.setState({ sessions: [...s.sessions, ...sessions], activeId: sessions[0]?.id ?? s.activeId,
      newSessionOpen: false, focusedSessionId: null, locked: true, unrestoredSessions: recovery,
      agents: { ...s.agents, ...Object.fromEntries(arrivals.map(item => [item.session.id, item.agent])) } })
    for (const item of arrivals) useStore.getState().addFeedEvents(item.session.id, item.feeds)
  })
  const offRemove = window.buddy.workspace.onTransferRemove(ids => {
    const s = useStore.getState(), sessions = s.sessions.filter(x => !ids.includes(x.id))
    const keep = <T,>(value: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(value).filter(([id]) => !ids.includes(id)))
    useStore.setState({ sessions, activeId: sessions.some(x => x.id === s.activeId) ? s.activeId : sessions[0]?.id ?? null,
      focusedSessionId: null, moveSessionId: null, pendingCloseId: null, linkSessionId: null,
      agents: keep(s.agents), feeds: keep(s.feeds), toolStats: keep(s.toolStats) })
  })
  const offEnd = window.buddy.workspace.onTransferEnd(() => {
    useStore.setState({ transferBusy: false })
    useStore.getState().persistNow()
  })
  return () => { offRequest(); offArrival(); offRemove(); offEnd() }
}
