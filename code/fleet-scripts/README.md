# fleet-scripts — parallel Claude Code sessions, one worktree each, and the cleanup after

Three scripts and a shared helper that run a batch of Claude Code sessions in parallel on
one Mac, each fully briefed and working in its own git worktree, and then clean up after
them without closing anyone's live work. Sessions start in the background by default and
show up in Claude Code's agent view; `--tabs` opens them as iTerm2 tabs instead.

## The problem

Splitting a large task across N AI coding sessions is easy to start and miserable to
finish:

- **Starting** used to mean hand-opening N terminal tabs and pasting N long prompts,
  each re-explaining how to make a worktree. Starting them all at the same moment turned
  out to be its own failure: N sessions each making a full checkout at once swamp the
  machine, and some die before they ever start.
- **Watching** a run meant reading its tabs one by one, and a tab's title is a rolling
  summary of the conversation, so it says what the session last did, not which slice it is.
- **Finishing** is where the real losses happen. Every session pushes to its own
  branch; if no one runs the integration pass, finished work rots. One audit found
  41 worktrees (over 11 GB of checkouts) and two pieces of finished, tested work that
  had sat unmerged for **five weeks**. Nobody noticed, because "each session pushes
  its branch" was where the process ended.
- **Cleaning up** is dangerous by default. Closing the wrong tab kills a live session or
  another operator's finished-but-unread scrollback, and removing a worktree before its
  session ends leaves that session working in a folder that no longer exists.

## The pieces

| File | Role |
|---|---|
| `spawn-claude-sessions.mjs` | Starts one session per slice. Checks that every slice name is free and that no two briefs claim the same file, makes each worktree one at a time, and starts each slice once its worktree is ready (`claude --bg -w <slice> -n <slice> "<brief>"`, or an iTerm2 tab with `--tabs`). Then it waits for each session to come up and names any that didn't. Records who started each slice and starts the reap watcher. |
| `reap-claude-sessions.mjs` | Closes finished slices: ends the session (`claude rm` for a background one, or closes its tab), then removes its worktree. It only does that when the worktree is clean, its branch is merged and has commits of its own, the session isn't mid-turn, and it isn't the session running the reaper. `--watch` is the automatic mode the spawner starts. |
| `lib/background-sessions.mjs` | What the spawner and reaper share about background sessions: the launch argv, reading what `claude --bg` and `claude agents --json` print, and who a run belongs to. |
| `worktree-audit.mjs` | Reports finished-but-unmerged work across all worktrees; `--prune` removes only provably-dead checkouts (branches are never deleted). |

Lifecycle: **spawn → work (watched in agent view) → the reap watcher closes each slice once
it's merged and quiet → `worktree-audit` (catch stranded work) → `worktree-audit --prune`**.
Reap runs before prune because a live process sitting in a worktree blocks its removal.
The Sessions panel in [`../iterm-panels/`](../iterm-panels/) reads the spawner's owner
book to group each run's slices under its orchestrator.

## Interesting design points

- **Background sessions by default.** Agent view (`claude agents`) lists every session
  working, waiting on a question, or done, in one place; a run's tabs had to be read one
  by one. Each background slice is launched by `execFile` with its brief as one argument,
  so there's no shell and nothing to quote. A background session's process has no tty and
  no `-w` in its argv, so a reaper that only looks for tabs would call it dead and remove
  its worktree from under it. The reaper also looks each slice up in
  `claude agents --json --all`, by the id the spawner recorded or by its worktree. If that
  list can't be read, the reaper decides nothing that round.
- **One worktree at a time.** The first version had every tab run `claude -w <slice>` at
  once, so a 26-slice run made all 26 worktrees together: 68 checkout workers on 18 cores,
  about ten minutes per checkout behind a blank tab, and 9 sessions exited mid-checkout
  while the orchestrator counted 26 running. The spawner now makes each worktree itself,
  with the branch, path and base Claude Code would have used, and starts each slice as
  soon as its own worktree is ready rather than after all of them. Because `claude -w`
  resumes any worktree with its name, a name that's already taken (the worktree exists, or
  its branch holds unmerged commits) stops the run before anything is made: a slice once
  started inside another session's worktree that held an approved, unpushed commit and a
  staged merge.
- **The startup check.** "Spawned N" only means N were launched. A slice whose `claude`
  exits closes its own tab, and nothing reports it. After launching, the spawner waits up
  to 240 seconds for each slice to show up as a live session and names the ones that
  didn't, so the orchestrator can count them out or relaunch them.
- **The `Owns:` list.** A brief can list the files it owns. Two briefs claiming
  overlapping paths stop the run before anything is made, and every slice launches from a
  copy of its brief with a footer saying who owns what, so a slice that needs a change in
  someone else's file asks the owner instead of editing it. In the 26-slice run only 8 of
  199 files were edited by two slices, but all 8 were shared files nobody owned, and most
  of the run's coordination chatter was about them.
- **The slice wakes its orchestrator.** A note on a shared board lands on a session's next
  turn, and an idle orchestrator doesn't have one. The spawner finds the Claude session
  it's running under and puts that session's messaging address in every brief's footer, so
  a slice's "done" message wakes it.
- **One window per run, with `--tabs`.** Adding tabs to the caller's window once piled
  three runs into one window: 25 tabs, every title cut to "…s (claude)". Each run now gets
  its own window, named after the run, with its tabs in one colour, and the tab that
  started the run moves into that window as its first tab. AppleScript can't move a tab
  between windows, so that step uses iTerm2's Python API.
- **The AppleScript "frontmost ≠ this window" trap.** iTerm2's `current window`
  means the *frontmost* window, not the window the calling process lives in. With
  several agent sessions open, spawning into `current window` reliably drops new
  tabs into someone else's window. The spawner instead resolves its own window by
  matching the GUID half of `$ITERM_SESSION_ID` against every session id, and falls
  back to a *new* window, never to `current window`. It then holds that window as
  `window id N`: the loop variable is a positional reference that AppleScript
  re-evaluates on every use, and each new tab reorders the window list, so five slices
  once alternated between two windows.
- **Close one tab per AppleScript call.** The same positional trap exists one level down.
  Closing three collected tab references once hit the right tab, then the wrong one, then
  a live unrelated session with 137 lines of unsent draft in it. The reaper finds each tab
  by its tty at the moment of closing and closes exactly one per call. It closes the tab
  before removing the worktree, so a session never sits in a deleted folder.
- **Identity is the `-w` flag, not the title.** Claude Code rewrites tab titles to rolling
  summaries. The reaper matches `-w <slice>` in the process's argv (near the front, so
  `ps` truncation can't cut it), falls back to the process's working directory for a
  session that entered its worktree mid-flight, and never guesses from a title. iTerm2
  badges were tried and dropped: the watermark sat offset in the corner and couldn't be
  read.
- **"Merged" means nothing without commits.** A slice that has only just started sits at
  its base, so its branch is already contained in the integration branch and reads as
  merged; one busy slice with 0 commits came back "would reap". The reaper checks the
  branch's reflog for commits of its own first.
- **The `git diff A...B` three-dot trap.** Three-dot diff compares against the
  *merge base*, so it shows every change a branch made since forking even when the
  base branch independently gained the identical content (squash/rebase merges land
  content under new SHAs). Using it as the "is this work merged?" test produced
  false "stranded" verdicts, in the very audit that motivated the script. The
  honest test is per-file content comparison against the base branch
  (`classifyBranch` in `worktree-audit.mjs`).
- **Ownership before evidence.** "Safe to close" evidence (clean tree, merged) looks
  identical for a slice someone *else* spawned. After one reap closed a finished slice
  from a different operator's run, the spawner started recording who started each slice
  (its iTerm2 tab, or `claude:<session id>` when the orchestrator is itself a background
  session) in `.claude/worktrees/.spawn-owners.json`. Each run's reap watcher is given
  only the slices that run started. The reaper doesn't read the owner field itself:
  `--slices` scopes it, and `--all-merged` looks across every run while still applying
  every check above.
- **Prompts via files.** With `--tabs`, a multi-line prompt threaded through AppleScript
  escaping → `zsh -c` → the shell is a quoting bug farm; a file path is one token that
  survives all three layers. Inline prompts from a `--spec` file are written to disk
  first. The briefs themselves are never edited; each slice launches from a copy with the
  footer added.
- **One `ps` pass, not per-tty.** `ps -t <tty>` errors on macOS once a tty is
  released even though iTerm2 still lists it, which reads as a crash instead of the
  correct answer ("that session is dead"). The reaper reads every process once with
  `ps -eo pid=,tty=,command=`.

## External deps / environment

macOS and Node 20+ (no npm packages); `git`, `ps`, `lsof`.

- The default mode needs a Claude Code version with background sessions: `claude --bg`,
  `claude agents --json`, `claude attach`, `claude logs`, `claude rm`. Run `claude` once in
  the repo and accept the trust prompt first. An untrusted repo refuses every background
  session, and the spawner stops at the first refusal.
- `--tabs` needs iTerm2 and `osascript`. Moving the spawning tab into the run's window uses
  iTerm2's Python API (Settings › General › Magic) through `uv run --with iterm2`, or
  `python3` with the `iterm2` package. If neither works, the tab stays where it is and the
  spawn carries on.

**`spawn-claude-sessions.mjs`**, run from inside the repo the slices should work on (it
uses that repo's main checkout, even from inside one of its worktrees):

| Flag | Default | What it does |
|---|---|---|
| `--dir <path>` | | A folder of prompt files; each `<name>.md` or `.txt` becomes slice `<name>`. |
| `--spec <path>` | | JSON: `{ "slices": [ { "name": "...", "prompt" or "promptFile": "..." } ] }`. |
| `--skip-permissions` | off | Passes `--dangerously-skip-permissions` to every session, so it runs every tool without asking first. The slice's worktree is then its only isolation. Without it, an unattended session that hits a permission prompt waits until someone answers it. |
| `--dry-run` | | Prints the plan and the exact launch lines. It still checks names and ownership and still writes the brief copies, but makes no worktree and starts nothing. |
| `--tabs` | off | iTerm2 tabs instead of background sessions. |
| `--profile <name>` | `$CLAUDE_SPAWN_PROFILE`, else `Default` | The iTerm2 profile, with `--tabs` only. |
| `--new-window` / `--same-window` | new window | Where the tabs go, with `--tabs` only. |
| `--run <name>` | the `--dir` folder's name | The run's name, less a `-p<N>` phase suffix. It names the window and picks the tab colour. |
| `--no-reap` | | Don't start the reap watcher. |
| `--startup-wait <s>` | 240 | How long the startup check waits; 0 skips it. |

Env: `CLAUDE_BIN` (default `~/.local/bin/claude`), `CLAUDE_SPAWN_PROFILE`. It also reads
`ITERM_SESSION_ID` (the caller's tab), `CLAUDE_CODE_SESSION_ID` (the owner when there's no
tab), and `CLAUDE_CONFIG_DIR`, `~/.claude` and every folder in `~/.claude-profiles/`, where
it looks for the session record of the Claude session it runs under.

It writes each slice's worktree at `.claude/worktrees/<slice>` on branch
`worktree-<slice>`, copies the gitignored files listed in `.worktreeinclude` into it (Claude
Code only does that for worktrees it makes itself), and writes the owner book at
`.claude/worktrees/.spawn-owners.json`, inline prompts under `.claude/spawn-prompts/`, the
launch copies under `~/.claude/logs/spawn-briefs/<repo>/`, and the watcher's log at
`~/.claude/logs/reap-watch-<repo>.log`. Its last message is the merge-back check:
`npm run worktrees:audit` when the repo has that script, else `git branch --no-merged`.

**`reap-claude-sessions.mjs`**, run from inside the repo:

| Flag | Default | What it does |
|---|---|---|
| `--slices a,b,c` | | The slices to reap. |
| `--all-merged` | | Every worktree that's merged, clean and has commits of its own. |
| `--into <branch>` | the branch `origin/HEAD` points to | The integration branch a slice must be merged into. With no `origin/HEAD` it stops and asks for one. |
| `--dry-run` | | Says what it would close and remove; changes nothing. |
| `--delete-branches` | off | For a tab slice, also deletes its merged branch. `claude rm` handles a background slice's branch. |
| `--watch --slices a,b` | | The automatic reap the spawner starts. |
| `--interval-min` / `--grace-min` / `--max-hours` | 5 / 10 / 72 | For `--watch`: how often it looks, how long a slice must sit unchanged, and when it gives up. |

Env: `CLAUDE_BIN` (same default), and it reads `CLAUDE_CODE_SESSION_ID` so it never removes
the background session it's running in.

**`worktree-audit.mjs`** takes `--prune` and `--json`, and reads `FLEET_REPO` (default: the
git toplevel of the cwd) and `FLEET_BASE_BRANCH` (default `main`). It doesn't import the
other two scripts.

Extracted from a private production setup; the company's identifiers, paths and incident
details were replaced, and the design reasoning was kept.
