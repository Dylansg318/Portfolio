# ai-context-tools — AI-context maintenance + architecture visualizer

Tools that keep an AI coding agent's context surfaces lean and truthful in a
large repo — plus a script that turns a code-symbol index into an interactive
architecture map.

## The problem

Claude Code loads two context surfaces every session:

| Surface | Where it lives | Loaded for | Maintained by |
|---|---|---|---|
| **`CLAUDE.md`** + `docs/claude/**` | in the repo | **every developer** (on pull) | committed edits + CI lint |
| **`MEMORY.md`** + `memory/*.md` | `~/.claude/projects/<repo>/memory/` (per-machine) | **you only** | local regen + your edits |

Both rot in characteristic ways. Hand-written index entries drift from the files
they point at. The auto-memory index bloats until the harness silently truncates
its tail — the worst failure mode, because nothing tells you the last N memories
stopped loading. And an oversized `CLAUDE.md` doesn't truncate; it gets
*ignored*.

The thesis here: **make the index a generated artifact.** Each memory file
carries a frontmatter `description`; `MEMORY.md` is regenerated from those, so
index/file drift is structurally impossible and a scheduled job keeps everything
inside budget at zero LLM cost.

## The pieces

- **`rebuild-memory-index.mjs`** — regenerates `MEMORY.md` from each memory file's
  frontmatter (single source of truth → the index can't drift or silently bloat past
  the truncation point). `--write` to apply; no flag = check mode, exit 1 on
  drift/over-budget. Enforces **both** budgets — see below.
- **`check-claude-context.mjs`** — lints the committed surface: `CLAUDE.md` line
  budget, **bans per-user `memory/*.md` pointers** in `CLAUDE.md` (teammates can't
  resolve paths under your `~/.claude`), and flags oversized curated docs (with a
  reasoned exemption list for legitimately-large living references). Runs in CI;
  exit 1 on violation (`--warn` to soften).
- **`nightly-context-maintenance.sh`** — the local Mon/Thu job: pull → regenerate
  index → lint → an optional second-model (`codex`) drift pass that re-verifies
  memory claims against the live code and writes a dated report. It never auto-edits
  memory and never commits/pushes — unattended writes to a shared branch are unsafe.
- **`com.example.context-maintenance.plist`** + **`install-launchd.sh`** — schedule
  the local job on macOS via launchd (Mon + Thu, 05:10 local).
- **`codegraph-viz.mjs`** — reads a CodeGraph SQLite symbol index (~19K nodes /
  ~38K edges in the source project) read-only via `node:sqlite`, aggregates symbols
  → directories and edges → cross-module dependencies, and emits a self-contained
  interactive HTML architecture map (~200 nodes; pan/zoom/search/filter,
  force-directed via vis-network).

## The real limits (measured + first-party)

Only **`MEMORY.md` truncates**. Per [the memory docs](https://code.claude.com/docs/en/memory),
it loads "the first 200 lines … or the first 25KB, **whichever comes first**", and anything
past that "is not loaded at session start" — with no warning in-session.

**Both dimensions are live, and they need OPPOSITE fixes:**

| Budget | Ours | Real cap | The only thing that helps |
|---|---|---|---|
| Bytes | 22,000 | 25,000 | Shorten the frontmatter `description` hooks |
| Lines | 180 | 200 | **Merge or delete memories** — one entry is one line |

Trimming hooks buys byte headroom and **zero** line headroom. In one measured
incident the index sat at 24,862 B / 188 lines — 138 bytes and 12 entries from the
wall; a trim pass freed 3 KB of bytes and moved the line count not at all. If the
line budget is the one firing, merge — don't trim. (An earlier version of the
script enforced bytes only and would have sailed past the line cap silently; the
check mode now fails on either.)

**`CLAUDE.md` never truncates** — it is "loaded in full regardless of length". Its
budget here is about *adherence*, not capacity: bloated instruction files get
ignored, and the first-party guidance is "target under 200 lines per CLAUDE.md
file". So treat that lint as advice and `MEMORY.md`'s as a hard deadline.

## Schedule (the hybrid)

- **CI (cross-user, $0):** a scheduled workflow lints the committed surface twice a
  week and on any PR touching `CLAUDE.md` / `docs/claude/`.
- **Local (your memory):** `bash install-launchd.sh` once; thereafter the Mon/Thu
  job regenerates your `MEMORY.md` and writes a drift report under
  `memory/_drift-reports/`.

Cadence is twice a week, not nightly: context drift accrues over weeks, so nightly
would mostly produce empty runs.

## Authoring a memory (so the index stays good)

Keep the frontmatter `description` a **tight ≤200-char hook** — it *is* the index
line and the recall-relevance signal. Put detail in the body. Set `section:` to one
of `Profile | How to work | Finance | Infra | Operations | Tooling | External APIs`
(defaults by `type` if omitted). Then rerun the index build.

## External deps / environment

Node 20+ (`node:sqlite` for the visualizer needs Node ≥ 22.5); no npm packages.
The visualizer expects a [CodeGraph](https://www.npmjs.com/package/@colbymchenry/codegraph)
index at `.codegraph/codegraph.db` and loads vis-network from a CDN in the output
HTML. The launchd pieces are macOS-only. Optional: `codex` CLI for the drift pass.
Configuration via `CONTEXT_REPO`, `CONTEXT_BRANCH`, `CLAUDE_MEMORY_DIR` env vars
(defaults: git toplevel / `main` / the standard `~/.claude` project memory path).

Extracted from a private production ERP; identifiers, fixtures and incident details have been sanitized.
