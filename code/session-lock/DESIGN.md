# Session Coordination — parallel AI coding sessions on one repo

Cross-session awareness for the AI coding-agent sessions and git worktrees that run against
one repo at once. Zero dependencies, no daemon, no MCP server: it is a handful of hooks in
the agent harness's settings plus `coord.cjs`.

Sessions are expected to run in **their own worktree** by default. This layer still matters
for the sessions that legitimately share a checkout (read-only investigation), for
non-agent writers, and for presence/broadcasts across worktrees.

**Kill switch:** `COORD_OFF=1` disables every guard without editing settings.

---

## 1. Why it exists

Agent sessions have no native awareness of each other. Two sessions in the same checkout
share a git index and a working tree, and neither can see the other.

In one production incident that cost a session ~25 minutes, its own transcript read:

> *"I'm blocked on the other session's git lock… Locked again — the other session is
> committing rapidly, **and my staged files are exposed to being swept into their commit**."*

It also discovered the collision **by accident, 24 minutes in** ("The important discovery:
this checkout is not idle"), and had to date untracked files by mtime to guess which ones
belonged to whom ("43 files frozen at noon five days ago versus everything from 14:21
today").

Three distinct failures, each addressed below:

| Failure | Fix |
|---|---|
| Didn't know another session was there | Presence registry, reported at SessionStart |
| Staged files exposed to another session's commit | Index lock across the `add` → `commit` gap |
| mtime archaeology to attribute files | Authorship recorded as files are written |

## 2. The critical section is the INDEX, not the push

This is the load-bearing design decision.

`git add` and `git commit` are two separate tool calls. Between them the index holds your
paths and **nothing stops another session in the same checkout from committing them**.
The project's "commit by explicit path" rule limits the blast radius but cannot close the
window, because the other session's `git commit -a` or broad `git add` still sees your
staged entries.

So the lock is keyed on `git rev-parse --git-path index`:

- Main checkout → `.git/index`
- Worktree → `.git/worktrees/<name>/index`

Sessions in the **same** checkout contend. Sessions in **different worktrees do not** —
which is correct, and is why keying on the repo would have been wrong: it would serialize
40 worktrees that can never actually collide.

## 3. What each hook does

| Event | Behavior |
|---|---|
| `SessionStart` | Register; print other live sessions, **loudly** if any share this checkout; list locks held by others |
| `PreToolUse` Bash | Classify git subcommands. Index ops acquire the index lock — **exit 2 (blocks)** if another live session holds it. Pushes acquire a push lock and warn inside the deploy pipeline's 60s debounce |
| `PostToolUse` Bash | Release locks; broadcast commits and pushes to peers |
| `PreToolUse` Edit/Write | Warn (never blocks) if a live session already edited this file — hard warning same-checkout, merge-conflict note cross-worktree |
| `PostToolUse` Edit/Write | Record authorship |
| `UserPromptSubmit` | Deliver unread peer broadcasts into the turn |
| `Stop` | Release the index lock **unless files are staged** — that half-finished state is exactly what needs protecting |
| `SessionEnd` | Release all locks, unregister (cursor included), run the retention gc |

Read-only git (`status`, `log`, `diff`, `rev-parse`, `fetch`, …) never takes a lock.

**Blocking is reserved for git.** File edits only warn. A layer that blocks edits on a false
positive is worse than the problem it solves; a stolen commit is silent and expensive.

## 4. Commands

```bash
node coord.cjs who              # live sessions, branch, worktree
node coord.cjs locks            # who holds what, and for how long
node coord.cjs say "finding"    # broadcast to all live sessions
node coord.cjs inbox            # recent broadcasts
node coord.cjs owner <file>     # which session last wrote this file
node coord.cjs unlock <res>     # force-release (rarely needed)
node coord.cjs doctor           # resolved paths, keys, host pid, counts
node coord.cjs gc               # force the retention sweep now
```

Broadcast anything another session would act on differently: a cross-cutting bug, a
migration about to land, a file you are mid-rewrite on, a rule you just learned the hard way.

## 5. Safety properties

Each of these exists because its absence would make the layer worse than nothing.

- **Never wedges a session.** Every hook path is wrapped; an unexpected throw exits 0
  (allow). The only non-zero exit is a deliberate, explained block.
- **Cannot deadlock.** A lock is valid only while its owner is alive *and* within TTL
  (index 5 min, push 3 min). A crashed session's locks are reaped; a hung session's expire.
- **Liveness tracks the host process, not the hook.** Hooks are short-lived — using their
  own pid would reap every lock the instant it was taken and silently make the layer a
  no-op. `findClaudePid()` walks the ancestor chain and matches the *executable*, never a
  substring of the command line (every hook path contains `.claude/`, so substring matching
  self-matches). Verify with `doctor`.
- **Reentrant.** Re-acquiring your own lock refreshes it.
- **Atomic without a daemon.** Locks are `O_EXCL` file creates; session records are
  write-temp-then-rename; broadcasts are `O_APPEND` lines.
- **State lives outside the repo** — `~/.claude/session-coord/<repo-key>/`, keyed by
  `git rev-parse --git-common-dir`, which all worktrees of one repo share. Nothing is
  committed and nothing is uploaded.
- **State is bounded.** Sessions and locks always self-reaped, but the append-only files
  did not: in production, authors.jsonl hit 9.0MB / 26,686 lines (parsed in FULL by every
  pre-edit hook) and 980 orphaned cursor files had accumulated. Now: `SessionEnd` deletes
  the session's cursor and runs `gc()` (hourly-stamped) — broadcasts age out at 48h,
  authorship at 7 days / 5,000 lines, orphan cursors at 24h. Notes exist so ACTIVE
  sessions can coordinate; they are not an archive.

## 6. Tests

```bash
bash test-coord.sh     # 23 assertions, exits non-zero on failure
```

Safe in a live checkout: fake session IDs, no real git writes, cleans up after itself.
Covers the block/no-block pair (same checkout vs. worktree), retain-while-staged,
release-on-clean, dead-owner reaping, broadcast delivery and cursor advance, authorship
lookup, the `COORD_OFF` switch, malformed-input tolerance, 8 host-matcher cases, and the
retention gc (aged notes/authors pruned, live cursors kept, cursor removed on session-end).

## 7. Limits

### Concurrency — sessions are cheap; the pre-commit gate is what costs

**There is no session cap.** A dozen sessions ticking along in parallel is fine on a 16 GB
machine. What spikes the machine is several **pre-commit gates firing at once** — so the
thing to stagger is commits, not sessions.

Measured in production with 11 live sessions at steady state (no jest running):

| | |
|---|---|
| Hardware | 16 GB RAM, 10 cores |
| **All 11 agent host processes combined** | **2.8 GB RSS** (~250 MB each) |
| CPU | **45.5% idle** |
| Memory free (`memory_pressure`) | **48%** |
| Load average | 8.90 / 8.93 / 8.91 — flat, and dominated by the window server + terminal at ~54% combined, i.e. *rendering ten tabs of streaming text*, not session compute. Top host process: 8.2%. |
| Per-worktree disk | ~1.1 GB of `node_modules`, NOT shared — irrelevant against hundreds of GB free |

A session waiting on a model response is ~250 MB and ~0% CPU. The expensive moment is the
commit: the verify script loads all ~164 route files, and staged client files add jest at
2 workers × ~300 MB. **That** is the ~1 GB spike, and it lasts seconds — which is why
concurrent *commits*, not concurrent *sessions*, are what to watch.

> **A retracted claim, kept as a trap.** An earlier revision of this section claimed a
> "~6 session" RAM ceiling. That was wrong. It rested on a single snapshot taken while
> several sessions happened to be mid-commit — high load and "88% of swap consumed" — and
> attributed both to *session count*. Two errors: (1) **macOS swap-used is not thrashing.**
> The box had been up 15 days, the swapfile grows on demand, and `Swapins`/`Swapouts` in
> `vm_stat` are lifetime counters, not a rate. The health signal is `memory_pressure`'s
> free percentage, which read **48%**. (2) **Load average was not the sessions.** With zero
> jest running, load still sat at 8.9 — because the window server and the terminal were
> rendering ten tabs of fast-scrolling output. Measure *what* holds the CPU
> (`ps -A -o pcpu,rss,comm | sort -rn | head`) before blaming the thing you happen to be
> thinking about.

Other limits:

- **One machine.** No cross-machine coordination — the state dir is local. (Upstream
  feature request: [claude-code#28300](https://github.com/anthropics/claude-code/issues/28300).)
- **Advisory for non-agent writers.** A human or another tool running `git commit` in the
  same checkout bypasses it entirely — nothing is hooked outside the agent harness.
- **Not multi-agent teams.** Harness features that let one session spawn teammates cover a
  different problem; they cannot span sessions a human started independently.
- **Broadcasts are not a chat.** Fire-and-forget notes delivered on the next turn. There is
  no request/response between sessions.

## 8. Why worktree-by-default became unconditional — lessons

The project rule "work in your own worktree by DEFAULT" carries no conditionals ("if
dirty", "if large") because conditional versions of the rule failed twice in one week:

- A dozen sessions piled into the shared checkout; a dead session's orphaned edit wedged
  every session's `git pull` for an hour.
- Worse: three sessions died leaving 6 files dirty, 5 of which upstream also changed, so
  every `git pull` aborted. The checkout sat at "ahead 7 / behind 119" for **three days**
  across ten sessions — and the stranded work existed in **no git object anywhere** until
  it was hand-rescued to a branch days later.

The old rule only offered a launch-time flag: a session that realized mid-task it should
have isolated itself had to kill itself and start over, so it didn't. A mid-session
enter-worktree tool (no restart, no lost context) is what made the rule followable, with
new worktrees branched from the remote integration branch so they cannot inherit a wedged
checkout.

**Worktree costs, measured:** a fresh worktree has no `node_modules`; installing takes a
few seconds on a warm npm cache. Skipping it means the pre-commit hook fails at the end and
`--no-verify` starts looking attractive.

**The failure mode worktrees introduce is rot, not trampling:** an audit of 41 worktrees
found two finished, tested changes stranded unmerged. The counterpart to worktree-by-default
is a merge-back audit on completion.
