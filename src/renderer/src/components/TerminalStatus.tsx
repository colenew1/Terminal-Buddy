import type { Session } from '../store/useStore'

/** These labels describe observations, not guessed model completion. */
export default function TerminalStatus({ session }: { session: Session }): React.JSX.Element {
  const [state, label, hint] = session.status === 'exited'
    ? ['exited', 'Exited', 'This terminal process has ended.']
    : session.replacing
      ? ['sending', 'Opening', 'The saved session is being opened in this terminal.']
      : session.busy
        ? ['active', 'Output active', 'The terminal is producing output. Input remains available.']
        : session.attention
          ? ['attention', 'May need you', 'Output has paused. Check the terminal for a question or result.']
          : ['quiet', 'Quiet', 'No recent output. Check the native prompt before replying; silence does not prove completion.']
  return <span className={`terminal-status is-${state}`} title={hint} role="status"><i aria-hidden="true" />{label}</span>
}
