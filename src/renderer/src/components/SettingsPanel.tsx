import { useEffect, useState } from 'react'
import type { IntegrationStatus } from '@shared/types'
import { useStore } from '../store/useStore'
import { SHORTCUT_HELP } from '../lib/shortcuts'

export default function SettingsPanel(): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const shells = useStore((s) => s.shells)
  const notify = useStore((s) => s.notify)
  const close = (): void => useStore.getState().setSettingsOpen(false)

  const [status, setStatus] = useState<IntegrationStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [paths, setPaths] = useState<{ userData: string; version: string; packaged: boolean } | null>(null)

  const refreshStatus = (): void => {
    void window.buddy.integration.status().then(setStatus)
  }

  useEffect(() => {
    refreshStatus()
    void window.buddy.app.paths().then(setPaths)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const runOp = async (fn: () => Promise<{ ok: boolean; message: string }>): Promise<void> => {
    setBusy(true)
    try {
      const r = await fn()
      notify(r.message)
    } finally {
      setBusy(false)
      refreshStatus()
    }
  }

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Settings</h3>
          <button className="icon-btn" onClick={close}>
            ✕
          </button>
        </div>

        <div className="modal-body settings">
          <section>
            <h4>Terminal</h4>
            <label className="field">
              <span>Default shell</span>
              <select
                value={settings.defaultShellId}
                onChange={(e) => void setSettings({ defaultShellId: e.target.value })}
              >
                {shells.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Font size</span>
              <input
                type="number"
                min={8}
                max={28}
                value={settings.fontSize}
                onChange={(e) => void setSettings({ fontSize: Number(e.target.value) || 13 })}
              />
            </label>

            <label className="field">
              <span>Font family</span>
              <input
                value={settings.fontFamily}
                onChange={(e) => void setSettings({ fontFamily: e.target.value })}
              />
            </label>

            <label className="field">
              <span>Scrollback lines</span>
              <input
                type="number"
                min={500}
                max={200000}
                step={500}
                value={settings.scrollback}
                onChange={(e) => void setSettings({ scrollback: Number(e.target.value) || 5000 })}
              />
            </label>

            <label className="field">
              <span>Cursor blink</span>
              <input
                type="checkbox"
                checked={settings.cursorBlink}
                onChange={(e) => void setSettings({ cursorBlink: e.target.checked })}
              />
            </label>

            <label className="field">
              <span>Reopen terminals on launch</span>
              <input
                type="checkbox"
                checked={settings.restoreOnLaunch}
                onChange={(e) => void setSettings({ restoreOnLaunch: e.target.checked })}
              />
            </label>

            <label className="field">
              <span>
                Attention delay (ms)
                <small>How long a pane must be quiet after output before it is flagged.</small>
              </span>
              <input
                type="number"
                min={300}
                max={20000}
                step={100}
                value={settings.attentionDelayMs}
                onChange={(e) => void setSettings({ attentionDelayMs: Number(e.target.value) || 1200 })}
              />
            </label>
          </section>

          <section>
            <h4>Resume commands</h4>
            <p className="muted">
              <code>{'{id}'}</code> is replaced with the session id. These are templates so a CLI change is a
              settings edit, not a new release.
            </p>
            <label className="field">
              <span>Claude</span>
              <input
                value={settings.claudeResumeCommand}
                onChange={(e) => void setSettings({ claudeResumeCommand: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Codex</span>
              <input
                value={settings.codexResumeCommand}
                onChange={(e) => void setSettings({ codexResumeCommand: e.target.value })}
              />
            </label>
          </section>

          <section>
            <h4>Windows integration</h4>
            {status && !status.packaged && (
              <p className="muted warn">
                Running from a dev build. The context menu will point at your dev Electron — reinstall it after
                packaging.
              </p>
            )}
            <div className="int-row">
              <div>
                <b>Explorer context menu</b>
                <div className="muted">
                  Adds <b>Open in Buddy</b> to folders. On Windows 11 it appears under “Show more options”
                  (Shift+F10) — the top-level menu needs a signed MSIX package.
                </div>
              </div>
              <button
                className="btn"
                disabled={busy}
                onClick={() =>
                  void runOp(
                    status?.contextMenuInstalled
                      ? window.buddy.integration.uninstallContextMenu
                      : window.buddy.integration.installContextMenu
                  )
                }
              >
                {status?.contextMenuInstalled ? 'Remove' : 'Install'}
              </button>
            </div>

            <div className="int-row">
              <div>
                <b>
                  <code>buddy</code> command
                </b>
                <div className="muted">
                  Run <code>buddy</code> or <code>buddy &lt;folder&gt;</code> from any shell. Adds{' '}
                  {status?.cliDir ?? ''} to your user PATH.
                </div>
              </div>
              <button
                className="btn"
                disabled={busy}
                onClick={() =>
                  void runOp(
                    status?.cliInstalled
                      ? window.buddy.integration.uninstallCli
                      : window.buddy.integration.installCli
                  )
                }
              >
                {status?.cliInstalled ? 'Remove' : 'Install'}
              </button>
            </div>
          </section>

          <section>
            <h4>Keyboard</h4>
            <div className="keys">
              {SHORTCUT_HELP.map(([k, d]) => (
                <div key={k} className="key-row">
                  <kbd>{k}</kbd>
                  <span>{d}</span>
                </div>
              ))}
            </div>
          </section>

          {paths && (
            <section>
              <h4>About</h4>
              <p className="muted mono tiny">
                v{paths.version} · {paths.packaged ? 'packaged' : 'dev'} · data in {paths.userData}
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
