# fleet-scripts — parallel AI-session orchestration on macOS/iTerm2

Three scripts that run a small "fleet" of Claude Code sessions in parallel on one
machine — one iTerm2 tab per work slice, each session fully briefed and isolated in
its own git worktree — and then clean up after the fleet without destroying anyone's
work.

## The problem

Splitting a large task across N AI coding sessions is easy to start and miserable to
finish:

- **Starting** used to mean hand-opening N terminal tabs and pasting N long prompts,
  each re-explaining how to provision a worktree.
- **Finishing** is where the real losses happen. Every session pushes to its own
  branch; if no one runs the integration pass, finished work rots. One audit found
  41 worktrees (over 11 GB of checkouts) and two pieces of finished, tested work that
  had sat unmerged for **five weeks** — nobody noticed because "each session pushes
  its branch" was where the process ended.
- **Cleaning up** is dangerous by default: all the tabs look identical (the agent
  rewrites tab titles to rolling conversation summaries), and closing the wrong one
  kills a live session or another operator's finished-but-unreviewed scrollback.

## The pieces

| Script | Role |
|---|---|
| `spawn-claude-sessions.mjs` | One iTerm2 tab per slice, each running `claude -w <slice> "<prompt>"` in its own worktree. Prompts come from files, never inline strings. Records which tab spawned which slice. |
| `reap-claude-sessions.mjs` | Classifies every open Claude tab (SELF / BUSY / UNCOMMITTED / UNMERGED / FOREIGN / DONE / EXITED …) and closes only the provably-safe ones. |
| `worktree-audit.mjs` | Reports finished-but-unmerged work across all worktrees; `--prune` removes only provably-dead checkouts (branches are never deleted). |

Lifecycle: **spawn → work → `worktree-audit` (catch stranded work) → `reap-claude-sessions --close` → `worktree-audit --prune`**. Reap runs before prune because a live process cwd'd inside a worktree blocks its removal.

## Interesting design points

- **The AppleScript "frontmost ≠ this window" trap.** iTerm2's `current window`
  means the *frontmost* window, not the window the calling process lives in. With
  several agent sessions open, spawning into `current window` reliably drops new
  tabs into someone else's window. The spawner instead resolves its own window by
  matching the GUID half of `$ITERM_SESSION_ID` against every session id, and falls
  back to a *new* window — never to `current window`.
- **The `git diff A...B` three-dot trap.** Three-dot diff compares against the
  *merge base*, so it shows every change a branch made since forking even when the
  base branch independently gained the identical content (squash/rebase merges land
  content under new SHAs). Using it as the "is this work merged?" test produced
  false "stranded" verdicts — in the very audit that motivated the script. The
  honest test is per-file content comparison against the base branch
  (`classifyBranch` in `worktree-audit.mjs`).
- **Ownership before evidence.** "Safe to close" evidence (clean tree, merged,
  announced done) is identical for a slice someone *else* spawned. After one reap
  closed a finished slice from a different operator's run, the spawner started
  recording tab-GUID ownership; the reaper refuses foreign or unrecorded slices by
  default (`--any-owner` overrides).
- **Badges, not titles.** The agent rewrites tab titles continuously, so slice
  identity lives in the iTerm2 *badge* (set via the `SetBadgeFormat` escape
  sequence), which nothing rewrites.
- **Prompts via files.** A multi-line prompt threaded through AppleScript escaping →
  `zsh -c` → the shell is a quoting bug farm; a file path is one token that survives
  all three layers.
- **One `ps` pass, not per-tty.** `ps -t <tty>` errors on macOS once a tty is
  released even though iTerm2 still lists it — which reads as a crash instead of the
  correct answer ("that session is dead").
- **Graceful degradation.** The reaper optionally consults a session-coordination
  registry (live sessions, git locks, "done" broadcasts). When that module is
  absent it degrades to worktree/process evidence alone.

## External deps / environment

macOS + iTerm2 + `osascript`; Node 20+ (no npm packages); `git`, `lsof`, `ps`.
Configuration via env vars: `FLEET_REPO` (default: git toplevel of cwd),
`FLEET_BASE_BRANCH` (default `main`), `FLEET_ITERM_PROFILE`, `CLAUDE_BIN`.

Extracted from a private production ERP; identifiers, fixtures and incident details have been sanitized.
