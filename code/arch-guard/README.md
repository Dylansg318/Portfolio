# arch-guard

A dependency-free source scanner for the architectural invariants an import
graph cannot see.

> Extracted from a private production ERP; the production rule set is
> business-specific and has been replaced with illustrative rules.

## The two-layer thesis

Architecture rules split into two kinds, and each needs a different tool:

1. **Import boundaries** — "route files may not import repositories directly",
   "nothing outside `lib/payments` imports the payment SDK". An import-graph
   linter like [dependency-cruiser](https://github.com/sverweij/dependency-cruiser)
   enforces these perfectly, because the evidence *is* the import edge.

2. **Behavioral invariants** — "no channel-sync code may `INSERT INTO` the
   product master", "every write to the payments tables goes through one seam".
   An import graph is **structurally blind** here: every module imports the
   same shared `query` helper, so `query("INSERT INTO products …")` and
   `query("SELECT 1")` produce the identical import edge. The invariant lives
   in the *string the code runs*, not in what it imports.

arch-guard is layer 2: targeted regex scans over the source tree (pure Node
`fs` — no dependencies, no AST, no build step) that flag statements touching
protected tables outside an allowlisted set of chokepoint files. In the
production system it ran alongside a dependency-cruiser config that owned
layer 1 — a typical layer-1 rule looked like:

```js
// .dependency-cruiser.cjs (layer 1 — imports; NOT part of this extraction)
{
  name: 'routes-not-into-repositories',
  severity: 'error',
  from: { path: '^server/routes' },
  to: { path: '^server/repositories' },
}
```

Neither layer replaces the other. dependency-cruiser cannot see SQL;
arch-guard should not re-implement module-boundary checking that an import
graph does better.

## Usage

```
node arch-guard.mjs            # print report, always exit 0 (report-only)
node arch-guard.mjs --strict   # exit 1 on HARD violations — the CI form
```

Report-only is the deliberate default: a guard that reds the build the day it
lands teaches people to ignore it. Run it visible-but-green until the hard
tier is actually clean, then wire `--strict` into CI and the pre-commit hook.

(Run as shipped, the illustrative `required-call` rule reds on its example
paths — that's the missing-file-is-red behavior working, not a bug. Point the
rules at your own tree.)

It is also importable — `import { runGuard, format } from './arch-guard.mjs'`
returns the structured `{ hard, warn, info }` result for embedding in a wider
report.

## Rule kinds

Rules live in [`rules.mjs`](rules.mjs) (the shipped set is illustrative —
write your own). Three kinds covered everything the production system needed:

| Kind | Invariant shape | Example |
|---|---|---|
| `sql-chokepoint` | statements touching a protected table may appear only in allowlisted files | "no module outside `lib/payments` may write the payments tables" |
| `required-call` | every file in a named list must contain a live **call** of a guard function | "every scheduled-job entrypoint must call `registerJob()`" |
| `forbidden-line` | no non-comment line may match a known-bad idiom | "no route file may run UPDATE/DELETE through the raw query helper without the audit wrapper" |

Mechanics worth knowing (each learned the hard way; the inline comments carry
the full stories):

- **Line-anchored statement starts.** Real SQL keeps `INSERT INTO <table>`
  on one line; matching whole files lets a `\s` in a pattern bridge newlines
  and match two unrelated tokens. An optional column filter looks a few lines
  ahead of the statement start (`WINDOW`) for `SET`-list matches.
- **Comment lines never count.** A doc-comment SQL example isn't executable
  code — without this, the guard flags its own documentation.
- **Frozen baselines, not silent allowlists.** A rule born with existing
  violators freezes them at *warn* tier — visible on every run — while a NEW
  bypass is *hard* from day one. That's a ratchet: the list only shrinks, and
  a warn-only rule that never converges is the alternative it replaces.
- **`required-call` demands a call, not a mention.** Negative-testing caught
  it passing on a comment naming the guard, then on a bare import whose call
  site had been renamed away. And a **missing file is red, not skipped** —
  otherwise a rename silently drops a surface out of coverage.
- **Scope roots to everywhere the invariant applies.** A guard that doesn't
  read a directory isn't silent about it — it's *wrong* about it. The
  production version once reported clean while the scripts that had written
  most of the historical data sat one directory outside its scan.
- **The guard exempts its own sources** — rule messages quote the very SQL
  they forbid.

## The untracked-files seam

[`lib/untrackedFiles.cjs`](lib/untrackedFiles.cjs) answers one question for
every whole-tree scanner in the pre-commit gate: *what will git refuse to
commit?* Those files are skipped, because they cannot land in the commit being
checked.

Why it exists: the pre-commit hook ran these scanners over the whole
filesystem before looking at what was staged, so in a checkout shared by many
agent sessions **one stray untracked file failed every session's commit** —
with an error naming a file the committer never touched. (Measured: a dead
session's leftover one-off script blocked all live sessions for about a day;
a pull can't clear it, since untracked files survive every fetch and merge.)

`git ls-files --others` is the *exact* answer, not an approximation: during a
path-form commit, git points hooks at a temporary index holding HEAD plus only
the named paths, and `--others` is computed against that same index — so a
file is scanned iff it can land in the commit being made. The helper
**fails open** (any git error → empty skip set → scan everything): that costs
availability but never coverage, whereas the inverse design would print a
green result on a CI-blocking gate after an error.

## Files

- `arch-guard.mjs` — the engine (walk + scan + report; zero dependencies)
- `rules.mjs` — the rule set (illustrative; the part you rewrite)
- `lib/untrackedFiles.cjs` — the "what can't be committed" skip seam
