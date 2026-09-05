import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import Buddy from './Buddy'

const STEPS = [
  { title: 'Meet your Terminal Buddy', icon: '👋', target: '.brand', text: 'Your real terminals, with a little more personality. This short tour shows you around without running commands or changing your workspace.', tip: 'Use Next and Back, or skip anytime. You can replay this in Settings.' },
  { title: 'Start with the plus', icon: '+', target: '.tab-new', text: 'The + opens a chooser. Start a plain terminal, launch a new Claude or Codex chat, pick a project folder, or resume a saved chat.', tip: 'New windows start from your home folder. Nothing launches until you choose. Shortcut: Ctrl+Shift+T.' },
  { title: 'One place to type', icon: '>_', target: '.cell.is-active .cell-body', text: 'Click directly in the terminal and type. Enter, arrow keys, yes/no choices, trust prompts, and agent slash commands all go straight to the real terminal.', tip: 'No separate chat composer. Paste with Ctrl+V; Ctrl+C copies a selection or interrupts when nothing is selected.' },
  { title: 'Make room for your work', icon: '▦', target: '.topbar .seg', text: 'Tabs show one terminal; Grid shows several. In Grid, unlock the layout to move panes and drag the dividers to resize.', tip: 'Lock again to type. Use ⛶ or double-click empty header space to focus one pane; Escape returns to the same layout.' },
  { title: 'Name it. Pop it out.', icon: '↗', target: '.cell.is-active .cell-head', text: 'Click a terminal name to rename it, or double-click its tab. Use ↗ or drag the header outside the app to pop the same running terminal into its own window.', tip: 'Dock back returns it, or drag it to the docking strip. Closing a popped-out window docks it; closing a terminal ends that terminal.' },
  { title: 'Pick up where you left off', icon: '↶', target: '[data-link-session]', text: 'The catalog holds saved chats. Drag one onto a truly empty pane to replace it, or open it separately. On launch, Buddy asks which saved terminals to reopen.', tip: '“Linked” means Buddy recorded an exact chat ID. For manually started or unlinked chats, use “Link chat.” Running jobs, unsent input, and terminal scrollback are not restored after quitting.' },
  { title: 'A little nudge, no noise', icon: '☾', target: '.topbar button[title^="Settings"]', text: 'A faint amber border pulses when an agent’s output pauses or a used terminal exits. Click the pane or open its tab to clear the light—no typing needed. Calm mode keeps it steady.', tip: 'Desktop alerts and chimes start off; enable them in Settings if you want. A pause isn’t proof of completion or approval: read the terminal prompt. You’re ready to go.' }
]

export default function Walkthrough(): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const [step, setStep] = useState(0)
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const current = STEPS[step]
  useEffect(() => { dialog.current?.showModal() }, [])
  useLayoutEffect(() => {
    const measure = (): void => {
      const el = document.querySelector(current.target)
      const r = el?.getBoundingClientRect()
      setRect(r && r.width && r.height ? { left: r.left - 4, top: r.top - 4, width: r.width + 8, height: r.height + 8 } : null)
    }
    measure()
    heading.current?.focus()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [current])
  const finish = async (): Promise<void> => {
    if (saving) return
    setSaving(true)
    try {
      // Persist before dismissing so a failed save never silently repeats the tour.
      const settings = { ...useStore.getState().settings, walkthroughVersion: 1 }
      await window.buddy.settings.set(settings)
      useStore.setState({ settings, walkthroughOpen: false })
    } catch { setError('Could not save your tour preference. Please try again.'); setSaving(false) }
  }
  return <dialog ref={dialog} className="walkthrough" aria-labelledby="walkthrough-title" onCancel={(e) => { e.preventDefault(); void finish() }}>
    {rect && <div aria-hidden="true" className="walkthrough-highlight" style={rect} />}
    <section className="walkthrough-card">
      <div className="walkthrough-meta"><Buddy mood="calm" size={38} /><span>TERMINAL BUDDY · QUICK TOUR</span><button className="btn tiny" data-tour-skip disabled={saving} onClick={() => void finish()}>Skip tour</button></div>
      <div className="walkthrough-progress" aria-label={`Step ${step + 1} of ${STEPS.length}`}>{STEPS.map((_, i) => <span key={i} className={i <= step ? 'is-done' : ''} />)}</div>
      <span className="walkthrough-icon" aria-hidden="true">{current.icon}</span>
      <h2 ref={heading} tabIndex={-1} id="walkthrough-title">{current.title}</h2>
      <p>{current.text}</p><p className="walkthrough-tip">{current.tip}</p>
      {error && <p role="alert">{error}</p>}
      <div className="guide-actions"><span className="muted">{step + 1} / {STEPS.length}</span><span />
        <button className="btn" data-tour-back disabled={step === 0 || saving} onClick={() => setStep(step - 1)}>Back</button>
        <button className="btn primary" data-tour-next disabled={saving} onClick={() => step === STEPS.length - 1 ? void finish() : setStep(step + 1)}>{step === STEPS.length - 1 ? 'Let’s go' : 'Next →'}</button></div>
    </section>
  </dialog>
}
