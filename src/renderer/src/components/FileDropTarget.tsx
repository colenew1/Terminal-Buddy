import { useEffect, useState, type ReactNode } from 'react'

/** Shared by docked and popped-out terminals; files never become image pastes. */
export default function FileDropTarget({ children, enabled, canPaste, paste, focus }: {
  children: ReactNode
  enabled: boolean
  canPaste: boolean
  paste: (text: string) => void
  focus: () => void
}): React.JSX.Element {
  const [hover, setHover] = useState(false)
  const [paths, setPaths] = useState<string[]>([])
  const [error, setError] = useState('')
  const [copying, setCopying] = useState(false)
  useEffect(() => { if (!enabled) { setHover(false); setPaths([]); setError('') } }, [enabled])
  const close = (): void => { setPaths([]); setError(''); focus() }
  const text = paths.map(path => `"${path}"`).join(' ')
  return <div style={{ display: 'contents' }}
    onDragOver={event => {
      if (!event.dataTransfer.types.includes('Files')) return
      event.preventDefault(); event.stopPropagation()
      event.dataTransfer.dropEffect = enabled ? 'copy' : 'none'
      if (enabled) setHover(true)
    }}
    onDragLeave={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHover(false)
    }}
    onDrop={event => {
      if (!event.dataTransfer.types.includes('Files')) return
      event.preventDefault(); event.stopPropagation(); setHover(false)
      if (!enabled || copying) return
      try {
        const next = Array.from(event.dataTransfer.files, file => window.buddy.clipboard.filePath(file)).filter(Boolean)
        setPaths(next)
        setError(next.length ? '' : 'This drop has no local file path. Save the file to your computer first.')
      } catch { setPaths([]); setError('Could not read the dropped file paths. Try dropping a local file again.') }
    }}>
    {children}
    {hover && <div className="file-drop-hint">Drop to copy or paste the file path</div>}
    {(paths.length > 0 || error) && <div className="file-drop-actions" role="group" aria-label="Dropped files"
      onMouseDown={event => event.stopPropagation()} onContextMenu={event => { event.preventDefault(); event.stopPropagation() }}
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}>
      <strong>{paths.length > 1 ? `Use ${paths.length} file paths` : 'Use file path'}</strong>
      {paths.length > 0 && <code title={paths.join('\n')}>{paths.join('\n')}</code>}
      {error && <p role="alert">{error}</p>}
      <div>
        <button className="btn primary" data-copy-path disabled={!paths.length || copying} onClick={async () => {
          setCopying(true)
          try { await window.buddy.clipboard.write(text); close() }
          catch { setError('Could not copy the path. Please try again.') }
          finally { setCopying(false) }
        }}>{copying ? 'Copying…' : 'Copy as Path'}</button>
        <button className="btn" data-paste-path disabled={!paths.length || !canPaste || copying} onClick={() => { paste(text); close() }}>Paste path</button>
        <button className="btn" disabled={copying} onClick={close}>Cancel</button>
      </div>
    </div>}
  </div>
}
