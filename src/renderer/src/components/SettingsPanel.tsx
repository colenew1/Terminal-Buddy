import { useEffect, useState } from 'react'
import type { IntegrationStatus } from '@shared/types'
import { useStore } from '../store/useStore'
import { IS_MAC, SHORTCUT_HELP } from '../lib/shortcuts'
import { THEMES } from '../lib/themes'
import { CRITTER_PACKS, packById } from '../lib/critters'
import Buddy from './Buddy'

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
            <h4>Getting started</h4>
            <p className="muted">A short, click-through tour of terminals, layouts, pop-outs, recovery, and optional alerts.</p>
            <button className="btn" data-replay-tour onClick={() => useStore.setState({ settingsOpen: false, walkthroughOpen: true })}>Replay walkthrough</button>
          </section>
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
              <span>Ask to reopen chats on launch<small>Restore linked conversations, terminal folders, names, and layout.</small></span>
              <input
                type="checkbox"
                checked={settings.restoreOnLaunch}
                onChange={(e) => void setSettings({ restoreOnLaunch: e.target.checked })}
              />
            </label>

            <label className="field">
              <span>
                Click to move the cursor
                <small>
                  Click anywhere in the line you are typing instead of arrowing over. Alt+click always works,
                  even with this off.
                </small>
              </span>
              <input
                type="checkbox"
                checked={settings.clickToPosition}
                onChange={(e) => void setSettings({ clickToPosition: e.target.checked })}
              />
            </label>

            <label className="field">
              <span>
                Attention delay (ms)
                <small>How long an identified agent must be quiet after output before it is flagged.</small>
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
            <h4>Look and feel</h4>
            <div className="themes">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  className={`theme-card ${settings.theme === t.id ? 'is-on' : ''}`}
                  onClick={() => void setSettings({ theme: t.id })}
                  title={t.blurb}
                >
                  <span
                    className="theme-swatch"
                    style={{ background: `linear-gradient(135deg, ${t.swatch[0]}, ${t.swatch[1]})` }}
                  />
                  <span className="theme-name">{t.name}</span>
                  <span className="theme-blurb">{t.blurb}</span>
                </button>
              ))}
            </div>

            <label className="field">
              <span>
                Critters
                <small>Gives every pane a character, so cards from the same folder stay tellable apart.</small>
              </span>
              <input
                type="checkbox"
                checked={settings.critters}
                onChange={(e) => void setSettings({ critters: e.target.checked })}
              />
            </label>

            {settings.critters && (
              <div className="packs">
                {CRITTER_PACKS.map((pack) => (
                  <button
                    key={pack.id}
                    className={`pack ${settings.critterPack === pack.id ? 'is-on' : ''}`}
                    onClick={() => void setSettings({ critterPack: pack.id })}
                  >
                    <span className="pack-emoji">
                      {pack.critters.slice(0, 5).map((c) => c.emoji).join(' ')}
                    </span>
                    <span className="pack-name">{pack.label}</span>
                  </button>
                ))}
              </div>
            )}

            <label className="field">
              <span>
                Chime when output pauses
                <small>Two soft in-app notes, independent of system notification sounds.</small>
              </span>
              <input
                type="checkbox"
                checked={settings.chime}
                onChange={(e) => void setSettings({ chime: e.target.checked })}
              />
            </label>

            <label className="field">
              <span>Desktop notifications — {settings.desktopNotifications ? 'On' : 'Off'}<small>Off by default. Opt in to desktop alerts and window attention cues after 8 seconds without output following terminal input, or when its process exits. A pause is not confirmed completion. Limited to one pause alert per terminal every 30 seconds.</small></span>
              <input type="checkbox" checked={settings.desktopNotifications} onChange={(e) => void setSettings({ desktopNotifications: e.target.checked })} />
            </label>
            <button className="btn tiny" disabled={!settings.desktopNotifications} onClick={() => void window.buddy.app.testNotification().then((r) => notify(r.message)).catch(() => notify('The system could not display the test notification.'))}>Send test desktop alert</button>

            <label className="field">
              <span>
                Calm mode
                <small>Stops every animation, buddy included.</small>
              </span>
              <input
                type="checkbox"
                checked={settings.reduceMotion}
                onChange={(e) => void setSettings({ reduceMotion: e.target.checked })}
              />
            </label>

            <div className="buddy-preview">
              <div>
                <b>Your buddy</b>
                <div className="muted">Asleep · calm · working · needs you</div>
              </div>
              <div className="buddy-row">
                <Buddy mood="asleep" size={30} title="Nothing open" />
                <Buddy mood="calm" size={30} title="All quiet" />
                <Buddy mood="working" size={30} title="Output streaming" />
                <Buddy mood="alert" size={30} title="A pane went quiet" />
              </div>
            </div>
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

            <p className="muted">
              And when a skill is dropped on a terminal sitting at a prompt, <code>{'{skill}'}</code> becomes{' '}
              <code>/name</code>. Dropping onto a terminal that is already running the agent just types the
              slash command instead.
            </p>
            <label className="field">
              <span>Claude skill</span>
              <input
                value={settings.claudeSkillCommand}
                onChange={(e) => void setSettings({ claudeSkillCommand: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Codex skill</span>
              <input
                value={settings.codexSkillCommand}
                onChange={(e) => void setSettings({ codexSkillCommand: e.target.value })}
              />
            </label>
          </section>

          <section>
            <h4>{IS_MAC ? 'Dock and menu bar' : 'Taskbar and tray'}</h4>
            <label className="field">
              <span>
                Notification area icon
                <small>Keeps Terminal Buddy reachable while the window is closed.</small>
              </span>
              <input
                type="checkbox"
                checked={settings.trayIcon}
                onChange={(e) => void setSettings({ trayIcon: e.target.checked })}
              />
            </label>
            <label className="field">
              <span>
                Minimise to tray
                <small>Minimising hides the window instead of parking it on the taskbar.</small>
              </span>
              <input
                type="checkbox"
                disabled={!settings.trayIcon}
                checked={settings.minimizeToTray}
                onChange={(e) => void setSettings({ minimizeToTray: e.target.checked })}
              />
            </label>
            <label className="field">
              <span>
                Close to tray
                <small>
                  Closing the window hides it rather than killing every running terminal. Quit from the tray
                  menu.
                </small>
              </span>
              <input
                type="checkbox"
                disabled={!settings.trayIcon}
                checked={settings.closeToTray}
                onChange={(e) => void setSettings({ closeToTray: e.target.checked })}
              />
            </label>
            <p className="muted tiny">
              {IS_MAC ? 'The Dock badge counts terminals waiting on you. The menu bar icon lists recent projects.' : 'A count appears over the taskbar icon whenever terminals are waiting on you, and right-clicking it lists your recent projects.'}
            </p>
          </section>

          {window.buddy.platform === 'win32' && <section>
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
          </section>}

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
