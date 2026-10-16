# iterm-panels — Claude Code sessions and the clipboard in iTerm2's side panel

Two side panels for iTerm2's toolbelt, used all day alongside a dozen or so Claude Code
sessions. **Sessions** lists every Claude session on the Mac, the ones waiting on you on
top, and opens one with a click. **Clipboard** replaces iTerm2's paste history with one
that shows pictures as pictures and hides anything that looks like a key.

## The problem

- **Which session needs me?** With ten or more sessions running, some in tabs and some
  in the background, the only way to know which one had stopped to ask a question was
  to open each one. A session that had stopped to ask looked exactly like the ones still
  working, and its question arrived with no reminder of what the session was for.
- **What is this one doing?** Tab titles get rewritten to a rolling summary, so a tab
  said what the session last did, not what it was asked to do.
- **Four screenshots, four identical lines.** iTerm2's Paste History can't be restyled:
  every item is one cut-off line of monospace, four pasted screenshots read as four
  identical `/var/folders/…` paths, and a copied API key sits there in plain text.

## The pieces

| File | Role |
|---|---|
| `session-board.mjs` | The one implementation of "what is each session doing". Reads Claude Code's own files and prints every live session grouped by run, with its state, its job, and the question it's waiting on. `--waiting` for just the ones blocked on you, `--json` for the panel. |
| `lib/session-info.mjs` | The readers `session-board` uses: the live registry, transcripts, background-session job files, and the spawner's record of which slice belongs to which run. |
| `session-panel/panel.py` | Serves the Sessions page to iTerm2's toolbelt and does what its buttons ask: open a session with `claude attach`, start one with `claude --bg`, rename, close with `claude rm`. Keeps each open tab's status dot in step with its session. |
| `session-panel/index.html` | The page: Needs you, then one card per parallel run (its orchestrator first), then Working and Finished. A New session box on top takes a prompt and pictures. |
| `session-panel/viewer.py` | One-tab mode: a single tab that switches to whichever session you click, the way Claude Code's agent view does. |
| `clipboard-panel/panel.py` | Watches the Mac's clipboard, keeps the last 100 items in memory, and pastes one into the tab you're in. |
| `clipboard-panel/index.html` | The page: a notes box, search, then what you copied by day. Pictures are thumbnails, files show their names, keys stay hidden until you ask. |

## Interesting design points

- **One reader, two screens.** The panel never works out a session's state itself; it
  runs `session-board.mjs --json` every 2.5 seconds and draws what comes back. The
  terminal command and the panel can't disagree about which session is waiting.
- **The waiting signal is in two places.** A tab session that asks with Claude Code's
  question tool shows as `waiting` in the live registry. A background session that ends
  its turn with a question in plain text doesn't; its job file says `blocked` instead.
  The board checks both, or a background session's question would never reach the top.
- **Stalled is not the same as slow.** A working session whose status line hasn't
  changed for 30 minutes turns amber. One that is inside a command with a known
  deadline (the repo's deploy waiter gives up after a set number of minutes) stays blue
  until that deadline passes.
- **Your own reply isn't news.** Agent view shows your last reply as a background
  session's status line until the session writes a new one. The board compares the
  line against your last message and marks the echo, so "go ahead" doesn't read as
  something the session said.
- **Renaming a running session means typing.** Claude Code only renames a session
  through `/rename` inside it. The panel opens a hidden `claude attach` on a
  pseudo-terminal, stashes anything half-typed in that session's box with Ctrl+S, types
  the command, and confirms by reading the name back from the job file, because the
  screen is drawn for eyes, not for parsing.
- **Never take the keyboard.** iTerm2 hands keyboard focus to the side panel whenever
  the page calls `focus()`, and a row holding focus turns the next Space into a click on
  it. On 2026-10-16 that reopened a session every few seconds and blanked its tab. The
  page now refocuses only the rename box, and only while the panel already has the
  keyboard.
- **No `confirm()` in a side panel.** A browser pop-up may never show inside iTerm2's
  toolbelt, so ending a session that's still working asks in its own row instead.
- **Pictures go through the server.** The side panel's web view can't read a picture
  off the clipboard, so ⌘V asks the panel process to read it with AppKit, save it, and
  hand back a path that goes into the session's first message.
- **macOS has no clipboard notification.** The clipboard panel polls the pasteboard's
  change count twice a second and reads only when it moves. Anything marked concealed
  or transient by a password manager (the nspasteboard.org markers, plus 1Password's
  own) is never stored.
- **Locked to this Mac, this page.** Both servers answer only on `127.0.0.1`, only to
  their own `Host` header (which blocks DNS rebinding), and only to POSTs carrying a key
  generated at start and written into the page they served. The clipboard panel keys
  its GETs too, since the list is your clipboard.

## External deps / environment

macOS, iTerm2 with its Python API turned on (Settings › General › Magic), `uv`, Node 20+,
and a Claude Code version with background sessions (`claude --bg`, `claude attach`,
`claude rm`). Each panel installs as a LaunchAgent:

```bash
uv run --with iterm2 --with pyobjc-framework-Cocoa python session-panel/panel.py --install
uv run --with iterm2 --with pyobjc-framework-Cocoa python clipboard-panel/panel.py --install
```

Then show iTerm2's toolbelt and turn on Sessions and Clipboard in its menu.
Set `PROJECTS` and `DEFAULT_FOLDER` at the top of `session-panel/panel.py` to where your
repos live. New session starts sessions with `--dangerously-skip-permissions`, the way the
author runs them; take the flag out of `Panel.new` if you don't.

The board reads files Claude Code writes for its own use (`~/.claude/sessions/`,
`~/.claude/jobs/`, the transcripts). They aren't a public interface and can change with any
release; every reader returns nothing rather than throwing when a file is missing or
half-written.

Extracted from a private setup; the company's identifiers, folder paths and key prefix
were replaced, and the design reasoning was kept.
