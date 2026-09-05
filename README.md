<div align="center">
  <img src="build/icon.png" width="96" alt="Terminal Buddy" />
  <h1>Terminal Buddy</h1>
  <p><b>A terminal manager for people running too many coding agents at once.</b></p>
  <p><i>With a buddy who tells you which one needs you.</i></p>
  <p>Tabs or grid. Right-click any folder → <i>Open in Buddy</i>. Plus a browsable catalog of every Claude&nbsp;Code and Codex skill and past chat on your machine — so you can resume work instead of hunting for it.</p>
</div>

---

## Why

If you keep six or eight terminals open across as many projects, two things go wrong:

1. **You lose track of which one needs you.** Agents run for minutes, then quietly stop and wait. Terminal Buddy watches each pane's output and flags the ones that went silent.
2. **You lose your old sessions.** Claude Code and Codex both keep every conversation on disk as JSONL, but there's no way to browse them. Terminal Buddy indexes them, shows you real titles and previews, and resumes any of them in a new terminal with one click.

It is a personal tool, published in case it's useful. There is no telemetry, no account, and no server — everything reads from your local disk.

## Features

**The buddy**
- A small creature in the title bar whose mood is real state, not decoration: **asleep** with nothing open, **calm** when all is quiet, **working** while output streams, and visibly **agitated** the moment a pane starts waiting on you. Click it to jump straight to whichever pane that is.
- Five themes — Midnight, Grove, Ember, Bubblegum and Paper (light) — each covering the chrome *and* the terminal palette, so switching never leaves the two halves mismatched.
- **Critters.** Every terminal gets an animal and a hue. Six tabs in the same folder all read `Owner`; one of them is the otter. It is the difference between counting tabs and recognising them.

**Terminals**
- 1–16 panes, switchable between **tabs** and **grid** at any time (`Ctrl+Shift+G`)
- Auto-detects PowerShell 7, Windows PowerShell, Command Prompt, Git Bash and WSL
- **Attention badges** — a pane that produced output and then went quiet gets flagged, so you can see at a glance which agent is waiting on you
- **Broadcast mode** — type once, send to every terminal (`Ctrl+Shift+B`)
- **Click to move the cursor** — click any word in the line you're typing and the caret goes there. No arrow-key crawling.
- **Rearrange the grid** — hit the padlock (`Ctrl+Shift+L`) and drag panes onto each other to swap them. Tabs reorder by dragging at any time.
- Rename tabs (double-click), search scrollback (`Ctrl+Shift+F`), reopen your layout on launch
- GPU-accelerated rendering, 5000 lines of scrollback per pane by default

**Catalog** (`Ctrl+Shift+E`)
- **Chats** — every Claude Code and Codex session on disk, newest first, with the title, first prompt, folder, turn count and age. **Resume** launches a terminal in the original folder and runs the resume command for you. **Export .md** writes a clean Markdown transcript.
- **Skills** — every `SKILL.md` from your Claude plugins, user folder and per-project `.claude/skills`, plus Codex prompts. Deduplicated across cached plugin versions.
- **Projects** — every folder you've worked in, derived from your session history. One click opens a terminal there.

**Living on your desktop**
- Installs to the Start menu and desktop like any app — search "Terminal Buddy", or right-click the taskbar icon and **Pin to taskbar**
- A **notification-area icon** with the fleet status in its tooltip, a menu for a new terminal or a recent project, and Quit
- A **count over the taskbar icon** whenever terminals are waiting on you, and a single taskbar flash when one starts
- **Jump list** — right-click the taskbar or Start icon for your recent projects
- Optional **minimise to tray** and **close to tray**, so closing the window doesn't kill eight running agents

**Shell integration**
- **Open in Buddy** on any folder in Explorer
- A `buddy` command for your PATH — `buddy` opens the current folder, `buddy <path>` opens that one
- Opening a second folder adds a tab to the running window instead of launching another copy

## Turning the whimsy down

All of it is in **Settings → Look and feel**, and none of it is load-bearing:

| Setting | Effect |
| --- | --- |
| **Theme** | Five palettes. Pick Paper for daylight, Midnight to keep it sober. |
| **Critters** | Off, and tabs go back to plain numbers. |
| **Chime** | Two soft synthesised notes when a pane starts waiting. **Off by default** — a notification you did not ask for is worse than none. |
| **Calm mode** | Stills every animation, buddy included. |

And under **Settings → Taskbar and tray**: the notification-area icon, minimise-to-tray and close-to-tray, all off-switchable.

`prefers-reduced-motion` is honoured whether or not Calm mode is on. The tone lives in one file, `src/renderer/src/lib/copy.ts`, so it can be flattened in a single edit — and the rule it follows is that the chrome can have a personality while the data never does: counts, paths, ids and errors are always literal.

## Install

Grab the installer or the portable `.exe` from [Releases](../../releases), or build it yourself:

```bash
git clone <this repo>
cd terminal-buddy
npm install
npm run dev          # run it
npm run dist         # build installer + portable into release/
```

Requires Node 18+. **No C++ toolchain needed** — the PTY layer ships prebuilt binaries.

The installer is per-user, needs no admin rights, and adds Start menu and desktop shortcuts. To get it onto the taskbar, launch it once, then right-click its taskbar button → **Pin to taskbar**. (Windows deliberately blocks apps from pinning themselves.)

After first launch, open **Settings (`Ctrl+,`) → Windows integration** and install the context menu and the `buddy` command.

> Install those from the *installed* copy, not a dev build or the unpacked folder — the registry entry stores an absolute path, so it breaks if that folder moves. Re-run them after any move.

> **Windows 11 note:** the context menu entry appears under **“Show more options”** (or `Shift+F10`), not the short default menu. Putting an entry in the top-level Win11 menu requires shipping a signed MSIX package with a COM handler, which is more machinery than this tool warrants.

## Keyboard

| Key | Action |
| --- | --- |
| `Ctrl+Shift+T` | New terminal |
| `Ctrl+Shift+D` | Duplicate terminal (same folder) |
| `Ctrl+Shift+W` | Close terminal |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous |
| `Alt+1` … `Alt+9` | Jump to terminal |
| `Ctrl+Shift+G` | Toggle tabs / grid |
| `Ctrl+Shift+E` | Toggle catalog |
| `Ctrl+Shift+P` | Command palette |
| `Ctrl+Shift+F` | Search in terminal |
| `Ctrl+Shift+B` | Broadcast to all terminals |
| `Ctrl+Shift+L` | Lock / unlock the layout |
| `Ctrl+C` / `Ctrl+V` | Copy / paste |
| `Ctrl+Shift+C` / `Ctrl+Shift+V` | Copy / paste (also works) |
| Right-click | Copy selection, or paste if nothing selected |
| Click / Alt+click | Move the cursor into the line you're typing |
| `Ctrl+,` | Settings |

`Ctrl+C` copies **only when text is selected**; with nothing selected it stays an interrupt, and copying clears the selection so the next press interrupts. Every other bare `Ctrl` combo is left to your shell — `Ctrl+A` still goes to the start of the line, `Ctrl+W` still deletes a word.

### Why Ctrl+V needed fixing

xterm.js treats `Ctrl+V` as the control byte `0x16` and calls `preventDefault()`, which kills the browser's own paste — so the key reached the shell as a raw SYN and appeared to do nothing. On top of that, Electron's default application menu registered `Ctrl+V` as a global accelerator and opened a hidden menu bar on `Alt`, which is why odd `Alt` combinations seemed to paste instead.

Both are gone: the menu is removed (`Menu.setApplicationMenu(null)`) and the app owns every clipboard key itself, routing through Electron's clipboard over IPC rather than `navigator.clipboard`, which needs a permission grant and fails silently without one. See `src/renderer/src/lib/clipboard.ts`.

## How it reads your agent history

Nothing is guessed; both CLIs write structured logs.

| | Claude Code | Codex |
| --- | --- | --- |
| Location | `~/.claude/projects/<slug>/<uuid>.jsonl` | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` |
| Session id | the filename | `session_meta.payload.session_id` |
| Title | `ai-title` records, else first real prompt | first real user message |
| Folder | `cwd` on user records | `session_meta.payload.cwd` |

Both stores are large — around 300 MB here — so every file is parsed once and cached against its size and mtime. The first scan takes a few seconds with a progress bar; later launches are instant. Parsing streams line by line and only runs `JSON.parse` on lines that could possibly match, so a 20 MB transcript costs a read, not a heap.

Sessions whose only prompts are machinery (sub-agent runs, `/exit`, injected `AGENTS.md` or caveat blocks) are flagged **internal** and hidden behind a toggle — but a session Claude gave a real title is always kept, even if it opens with a caveat block.

The resume commands are **templates** in Settings:

```
claude --resume {id}
codex resume {id}
```

If either CLI changes its flags, that's a settings edit rather than a new release. Codex records both a thread id and a rollout id; the detail view exposes the alternate one if the first doesn't take.

## Architecture

```
main process                      renderer
├─ PtyManager      spawn/write/   ├─ TerminalPane   one xterm per session,
│                  resize/kill,   │                 never unmounted
│                  8ms output     ├─ TerminalArea   tabs ⇄ grid
│                  batching       ├─ Sidebar        catalog + transcripts
├─ CatalogService  streaming      ├─ Palette        fuzzy jump
│                  JSONL index    └─ store          zustand
│                  + mtime cache
├─ ShellIntegration  registry .reg import, PATH via .NET
└─ WindowManager   single-instance lock, argv → new tab
```

Windows shell surfaces — tray, taskbar badge, jump list — live in `src/main/tray.ts`. The badge itself is painted in the renderer (that is where a canvas and the live theme colours are) and handed to main as a data URL.

Three details worth knowing if you fork this:

- **Hidden panes keep their full size.** In tab mode every pane is absolutely positioned at full size and only `visibility` changes. A `display:none` terminal measures as zero, so `fit()` would resize the pty to nonsense on every tab switch.
- **The pid arrives late.** On Windows, ConPTY populates `pty.pid` asynchronously; reading it at spawn always returns `0`. The manager refreshes it when the first output lands and pushes the correction to the UI.
- **`AppUserModelId` must match the installer's `appId`.** Without it Windows treats a pinned shortcut and the running window as two different apps, and the taskbar shows both.

## Editing the line you're typing

Click anywhere in the current command and the cursor moves there — click the third word, fix it, carry on. Alt+click does the same thing and keeps working even if you switch the feature off in **Settings → Terminal**.

Worth knowing how it works, because it explains the edges. A terminal cannot move the shell's cursor directly: the line buffer belongs to the line editor (PSReadLine, readline), not to the terminal. So Buddy measures the distance from the caret to your click and sends exactly that many arrow keys in one burst. iTerm2, VS Code and Windows Terminal all use the same trick. The editor clamps at both ends of its buffer, so clicking into the prompt or past the last character is harmless.

It deliberately does nothing in three cases:

- **Full-screen programs** (vim, less, htop). They own the whole grid and the cursor isn't a text caret, so arrows would be navigation — or worse.
- **When the program asked for mouse events.** The click belongs to it.
- **When the click would need Up or Down.** Those mean *history* to every shell worth using; sending them would silently replace the line you were editing. Clicks within one wrapped line still work, because horizontal arrows walk over the wrap on their own.

A click on an unfocused pane only focuses it. The next click positions.

## Rearranging panes

The grid is locked by default, because a stray drag while you are working should never shuffle six running agents. Click the **padlock** in the title bar (or `Ctrl+Shift+L`) and:

- a shield drops over every pane — terminals keep producing output but stop taking input, so a drag can't be mistaken for a text selection
- each pane grows a grab pill showing its critter and title
- drag one pane onto another and **they swap places**; the order persists across restarts

Tabs are different: you can drag a tab to reorder it whenever you like, lock or no lock, because there is no way to do that by accident while typing.

## Can I pull an external terminal into Buddy?

Not really, and it is worth being precise about why.

**Reparenting the window** is technically possible — Win32 `SetParent` can graft another app's `HWND` into ours. In practice it is a bad trade: the embedded window floats above Electron's GPU-composited content instead of clipping to its pane, it fights DPI changes and monitor moves, and it needs a native module to call into Win32. Worse, the result would be a foreign window sitting in a hole in the layout: no scrollback search, no attention badge, no critter, none of the things Buddy is for.

**Moving the running process** is not possible at all. A process's stdin/stdout are bound to the ConPTY that created them; there is no Windows API to hand a live console over to a different terminal.

What does work, and covers most of the need:

- **`buddy .`** — run it inside any existing terminal and Buddy opens a pane at that folder. You are one `cd` away from carrying on inside the app.
- **Resume the session.** This is the real answer for agents. A Claude or Codex conversation running in an external window can't be moved, but you can close it and pick it straight back up from the catalog — same folder, same history, now with a critter and an attention badge. That is exactly what the Chats tab is for.

## Limitations

- **Terminals don't survive a restart.** Closing the app kills its ptys. Real persistence needs a detached daemon holding the PTYs, which roughly doubles the architecture — and since both agent CLIs have their own resume, the catalog covers the actual need. Layout and folders *are* restored.
- Windows is the target. The code paths for macOS/Linux exist (shell detection, packaging targets) but are untested; the Explorer integration is Windows-only by nature.
- Skills are catalogued and searchable, not editable. "Type `/name`" writes the invocation into the focused terminal.

## Development

```bash
npm run dev         # electron-vite dev server with HMR
npm run typecheck   # tsc over main, preload and renderer
npm run build       # compile to out/
npm test            # typecheck + build + all three suites below
```

The tests drive the **real application**, not mocks — 29 assertions across three suites:

| Script | What it proves |
| --- | --- |
| `npm run test:smoke` | Boots the app over the Chrome DevTools Protocol, spawns a pty and round-trips `echo` through it, confirms the catalog indexed real skills/chats/projects, toggles the sidebar and grid, saves a screenshot. |
| `npm run test:grid` | Opens 6 terminals, tiles them, checks every pane has real geometry and a unique critter, and waits for the attention badges — and the buddy's mood — to react. |
| `npm run test:registry` | Round-trips the generated `.reg` through the real `reg.exe` under a scratch key (paths with spaces and all), then deletes it. |

Only one Terminal Buddy can run at a time (single-instance lock), so **close the app before running the tests** — otherwise the harness quits instantly. It will tell you if that happens.

Set `BUDDY_EXE` to point the harness at a packaged or installed build instead of `out/`:

```bash
BUDDY_EXE="$LOCALAPPDATA/Programs/Terminal Buddy/Terminal Buddy.exe" npm run test:smoke
```

Regenerate the icon with `npm run icon` (pure Python, no image libraries needed).

## License

MIT
