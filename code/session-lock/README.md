# session-lock — git coordination for concurrent AI coding agents in one checkout

A file-lock coordination layer plus a set of guard hooks that let 5–8 concurrent AI coding
sessions (Claude Code, in the source project) work in **one shared git checkout** — plus
~40 git worktrees — without eating each other's staged files, cancelling each other's
deploys, or melting the machine they share. It is pure Node and shell: no daemon, no
database, no dependencies. Mutual exclusion is an `O_EXCL` file create; presence is a
directory of JSON records that self-reap when their process dies; messaging is an
append-only JSONL file whose atomicity comes from POSIX `O_APPEND` semantics.

The distributed-systems problem is small but real. `git add` and `git commit` are two
separate tool calls with model "thinking" in between, and the git index is shared
per-checkout — so between one session's `add` and its `commit`, any other session in the
same checkout can sweep those staged files into *its* commit, under *its* message. That
actually happened: one session's transcript reads "my staged files are exposed to being
swept into their commit," discovered by accident 24 minutes into the collision. The fix is
a lock keyed on `git rev-parse --git-path index` — the *actual* sharing boundary, so two
sessions in one checkout contend while worktrees (which each have their own index) never
block each other — held across the `add → commit` gap, with PID-liveness checks and TTL
expiry so a crashed or hung holder is stolen from rather than deadlocking the layer,
reentrancy by session id, and a hard rule that every unexpected error exits 0: **a
coordination layer must never break the thing it coordinates.**

Around the lock sits a family of harness hooks that encode a second lesson: prose rules
degrade with context depth, but a PreToolUse hook fires the same on turn 3 and turn 300,
and it fires for subagents that never saw the rules at all. `bash-guard` blocks the
sweeping-stage commands (`git add -A`, `git commit -a`, `--no-verify`) with an explained
correction and a deliberate escape hatch; `jest-guard` blocks the uncapped test invocations
that once put a 16 GB machine at load average 37 with 17.2 of 18.4 GB swap consumed;
`context-guard` never blocks anything — it surfaces the rule governing a surface at the
moment the model touches that surface, once per session; `subagent-rules` injects a
trip-wire digest into every dispatched subagent, the one audience no rules file reaches.

## Files

| File | What it is |
|---|---|
| `lib/coord-core.cjs` | The primitives: repo/index keys, O_EXCL locks with PID+TTL validity, presence registry, broadcasts + cursors, file authorship, retention gc, git command classification |
| `coord.cjs` | Hook dispatcher (8 lifecycle events) + operator CLI (`who` / `locks` / `say` / `inbox` / `owner` / `unlock` / `doctor` / `gc`) |
| `bash-guard.cjs` | PreToolUse(Bash): blocks broad staging, `--no-verify`, and deleting a tracked-but-gitignored directory |
| `jest-guard.cjs` | PreToolUse(Bash): blocks uncapped/unscoped test runs on a shared machine; scoped runs pass |
| `context-guard.cjs` | PreToolUse(Edit/SQL): never blocks — surfaces the governing rule at the moment of contact, once per session |
| `subagent-rules.cjs` | SubagentStart: injects a trip-wire rules digest into agents that inherit no project context |
| `user-prompt-submit.cjs` | UserPromptSubmit: re-asserts the project's planning convention on planning-shaped prompts, at the turn where it competes with injected skill text |
| `auto-pull.sh` | SessionStart: fast-forward the integration branch; on failure, print a loud, diagnosed report instead of one swallowed `fatal:` line |
| `test-coord.sh` | 23-assertion end-to-end suite for the lock layer, run against a real (but untouched) git repo |
| `__tests__/guards.test.cjs` | node:test suite for the guards — runs each hook as a real subprocess, because the process contract (exit code + stdout shape) *is* the interface |
| `DESIGN.md` | The operator-facing writeup: lock protocol reasoning, safety properties, measured concurrency limits, and the lessons ledger |

## Design points worth reading for

- **Lock on the index, not the repo.** Keying on `git rev-parse --git-path index` makes the
  lock exactly as wide as the hazard: same-checkout sessions serialize, the 40 worktrees
  never do. (`lib/coord-core.cjs`, `indexKey`)
- **Liveness must track the session's host process, not the hook.** Hooks live for
  milliseconds; naive PID liveness would reap every lock the instant it was taken and
  silently turn the layer into a no-op. `findClaudePid` walks the ancestor chain and
  matches the host *executable* — never a substring, because every hook's own command line
  contains `.claude/` and would self-match. (`lib/coord-core.cjs`)
- **Hold the lock across the gap, release when the index is clean.** PostToolUse releases
  the index lock only when `git diff --cached --quiet` says nothing is staged; the
  staged-but-uncommitted state is precisely the window being protected. (`coord.cjs`)
- **Every failure path fails OPEN.** Malformed stdin, a thrown error, an unresolvable git
  dir — all exit 0 and allow the tool call. The only exit 2 is a deliberate block with a
  message that names the holder, the risk, and the fix. A guard that wedges sessions gets
  deleted, and then it guards nothing.
- **Escape hatches are prefixes, not settings.** `AGENT_ALLOW_BROAD_ADD=1 git add -A` runs.
  The point is not prevention but conversion: the dangerous default becomes an explicit
  decision visible in the transcript.
- **The negative tests are the load-bearing ones.** `git commit --amend` must not read as
  `-a`; `git log --all` must not read as broad staging; `created_at` on a job-monitoring
  table must not trigger the business-date reminder. A guard with false positives is
  switched off within a day.
- **Bounded state, no daemon.** Sessions and locks self-reap on read; the append-only
  broadcast/authorship files are trimmed by a gc that piggybacks on session exit behind an
  hourly stamp — added after the state dir was measured at 9 MB of authorship parsed in
  full by every pre-edit hook.

## Sanitization note

The embedded rule texts in `context-guard.cjs` and `subagent-rules.cjs` are generic
examples standing in for the production rule tables, which named real internal tables,
storefront accounts, and incident specifics; the mechanism is unchanged. Incident dates,
branch names, and vendor names in comments have been genericized ("a production incident
where…") with the measured figures kept.

## Dependencies and running

No npm dependencies. Node ≥ 18 (uses `node:test` for the guard suite) and a POSIX shell.
The hooks speak the Claude Code hooks protocol (JSON on stdin; exit 2 blocks with stderr
returned to the model; `hookSpecificOutput.additionalContext` on stdout injects context),
but nothing about the lock layer is harness-specific. `test-coord.sh` and the guard tests
ran green under the source project's harness; the guard suite
(`node --test __tests__/guards.test.cjs`, 19 tests) also passes in this folder as
extracted. `test-coord.sh` must be run from inside a git repository.

Extracted from a private production ERP; identifiers, fixtures and incident details have
been sanitized.
