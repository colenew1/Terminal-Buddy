import { clipboard, type WebContents } from 'electron'

/** Snapshot text at the native shortcut, before dictation restores the clipboard. */
export function installTextPaste(contents: WebContents): void {
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.alt) return
    const command = process.platform === 'darwin' ? input.meta && !input.control : input.control || input.meta
    const paste = (command && (input.code === 'KeyV' || input.key.toLowerCase() === 'v')) ||
      (!command && input.shift && (input.code === 'Insert' || input.key === 'Insert'))
    if (!paste) return
    event.preventDefault()
    // Start reading here, without an extra renderer -> main IPC round trip.
    void clipboard.readText().then(text => {
      if (!contents.isDestroyed()) contents.send('clipboard:paste', text)
    }).catch(() => {
      if (!contents.isDestroyed()) contents.send('clipboard:paste', '')
    })
  })
}
