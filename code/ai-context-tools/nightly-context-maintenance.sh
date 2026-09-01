#!/usr/bin/env bash
# nightly-context-maintenance.sh — the LOCAL half of the hybrid context-maintenance scheme.
#
# Runs on your Mac (via launchd, Mon + Thu — see com.example.context-maintenance.plist) to:
#   1. pull the latest integration branch
#   2. regenerate your per-user MEMORY.md index from each memory file's frontmatter
#      (deterministic, $0 — keeps the index lean and drift-free)
#   3. lint the committed cross-user context (CLAUDE.md budget, no per-user memory pointers)
#   4. run a `codex` drift pass that re-verifies memory claims against the live code and
#      writes a dated REPORT (it does NOT auto-edit memory — you review + apply)
#
# Why local: MEMORY.md + memory/*.md live in ~/.claude (per-machine), so CI can't touch them.
# The committed CLAUDE.md/docs are linted in CI too, by a scheduled workflow.
#
# This script never commits or pushes automatically — unattended writes to a shared branch are
# unsafe (deploy triggers + multi-session). It surfaces what changed; you decide what to commit.
#
# Env: CONTEXT_REPO   repo checkout (default: this script's own directory's git toplevel)
#      CONTEXT_BRANCH integration branch to pull (default: main)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${CONTEXT_REPO:-$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || pwd)}"
BRANCH="${CONTEXT_BRANCH:-main}"
cd "$REPO" || { echo "[nightly] repo not found at $REPO"; exit 1; }

MEM_DIR="$HOME/.claude/projects/$(echo "$REPO" | tr '/' '-')/memory"
REPORT_DIR="$MEM_DIR/_drift-reports"
mkdir -p "$REPORT_DIR"
# launchd has no date; use a monotonic-ish stamp from git + a counter file
STAMP="$(git -C "$REPO" log -1 --format=%cd --date=format:%Y%m%d-%H%M 2>/dev/null || echo run)"
REPORT="$REPORT_DIR/drift-$STAMP.md"

echo "[nightly] $(git -C "$REPO" rev-parse --short HEAD 2>/dev/null) — context maintenance"

# 1. Pull latest (best-effort; offline is fine)
git -C "$REPO" pull --ff-only origin "$BRANCH" >/dev/null 2>&1 && echo "[nightly] pulled $BRANCH" || echo "[nightly] pull skipped (offline or non-ff)"

# 2. Regenerate the per-user index from frontmatter
node "$SCRIPT_DIR/rebuild-memory-index.mjs" --write

# 3. Lint the committed cross-user context (report, don't fail the run)
node "$SCRIPT_DIR/check-claude-context.mjs" --warn

# 4. codex drift pass (optional — only if codex is installed + authed)
if command -v codex >/dev/null 2>&1; then
  echo "[nightly] running codex drift pass -> $REPORT"
  codex exec -c sandbox_mode="read-only" - > "$REPORT" 2>&1 <<EOF
Read-only drift check of this project's Claude memory system. Do NOT modify any files.
Memory dir: $MEM_DIR
Repo: $REPO

For each memory file whose frontmatter 'description' makes a falsifiable claim (a symbol,
file, DB column, cron name, route, migration, or a "fixed/NOT fixed/shipped <date>" status),
spot-check it against the live code (ripgrep/read). List ONLY files whose central claim is now
CONTRADICTED by the code, with: filename, the claim, the contradicting evidence (file:line),
and the corrected one-line hook. Keep it short — this is a periodic drift report, not a re-audit.
End with "NO DRIFT FOUND" if everything still holds.
EOF
  echo "[nightly] drift report written: $REPORT"
  # surface a one-line summary
  grep -iE "CONTRADICTED|STALE|NO DRIFT FOUND" "$REPORT" | head -5 || true
else
  echo "[nightly] codex not on PATH — skipped drift pass (run 'codex login' to enable)"
fi

echo "[nightly] done. Review: git -C \"$REPO\" diff CLAUDE.md docs/ ; and $REPORT"
