#!/bin/sh
# auto-pull — SessionStart: fast-forward the integration branch to origin, and when that
# is NOT possible, say why loudly enough that somebody acts on it.
#
# WHY THIS IS A SCRIPT AND NOT A ONE-LINER
# ----------------------------------------
# This used to be an inline one-liner in the hook settings ending in
#   git merge --ff-only FETCH_HEAD 2>&1 | tail -5
# In one production incident, three sessions died leaving edits uncommitted in the SHARED
# checkout. Five of those files had also changed upstream, so every ff-only pull
# aborted rather than overwrite them — correct behaviour, correctly refused.
# The checkout then sat at "ahead 7 / behind 119" for THREE DAYS while ten
# sessions shared it, and every one of them was told, once per session:
#
#   fatal: Not possible to fast-forward, aborting.
#
# That is technically a report and practically invisible: one terse line, no
# cause, no filenames, no severity, in a wall of startup output. Nobody read it.
# A failed auto-pull is not a warning, it is a WEDGED CHECKOUT — every session
# opened against it works from stale code and cannot push. This script says so,
# names the files responsible, and says what to do about them.
#
# It never blocks and never mutates on the failure path: it always exits 0, and
# on failure it only READS. Deciding what happens to somebody else's uncommitted
# work is a human's call, not a hook's.

cd "$CLAUDE_PROJECT_DIR" 2>/dev/null || exit 0

B=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
[ "$B" = working ] || { echo "git: on '$B' — auto-pull skipped (only 'working' auto-pulls)"; exit 0; }

L=$(git rev-parse --git-path index.lock 2>/dev/null)
[ -n "$L" ] && [ -f "$L" ] && { echo 'git: index.lock held by another session — auto-pull skipped'; exit 0; }

git fetch -q origin working 2>&1 | tail -2

# Capture, do NOT pipe. A shell pipeline's status is the status of its LAST
# command, so `git merge ... | tail` is ALWAYS 0 — which is precisely how the
# original inline one-liner swallowed three days of failure. Keep it unpiped.
MERGE_OUT=$(git merge --ff-only FETCH_HEAD 2>&1)
MERGE_RC=$?
if [ "$MERGE_RC" -eq 0 ]; then
  printf '%s\n' "$MERGE_OUT" | tail -3
  exit 0
fi

# ── The ff-only pull failed. Diagnose it. ────────────────────────────────────
COUNTS=$(git rev-list --left-right --count HEAD...FETCH_HEAD 2>/dev/null)
AHEAD=$(printf '%s' "$COUNTS" | awk '{print $1}')
BEHIND=$(printf '%s' "$COUNTS" | awk '{print $2}')

echo ""
echo "╔══════════════════════════════════════════════════════════════════════════╗"
echo "║  THIS CHECKOUT IS WEDGED — auto-pull could not fast-forward.             ║"
echo "╚══════════════════════════════════════════════════════════════════════════╝"
echo "  Position: ahead ${AHEAD:-?}, behind ${BEHIND:-?} of origin/working."
echo "  Every session sharing this checkout is working from STALE code and"
echo "  cannot push until this is cleared. This is not a warning to scroll past."
echo ""

if [ "${AHEAD:-0}" -gt 0 ] 2>/dev/null; then
  NOT_UPSTREAM=$(git cherry FETCH_HEAD HEAD 2>/dev/null | grep -c '^+')
  if [ "${NOT_UPSTREAM:-0}" -eq 0 ]; then
    echo "  · All ${AHEAD} local commit(s) are ALREADY upstream (git cherry: no '+')."
    echo "    Nothing here is unpushed — the divergence is duplicate history, so"
    echo "    once the working tree is clear this branch can simply be reset to"
    echo "    origin/working without losing committed work."
  else
    echo "  · ${NOT_UPSTREAM} of ${AHEAD} local commit(s) are NOT upstream — real unpushed"
    echo "    work. Do NOT reset. Push or rescue them to a branch first:"
    git cherry -v FETCH_HEAD HEAD 2>/dev/null | grep '^+' | head -5 | sed 's/^/      /'
  fi
  echo ""
fi

# The actual blockers: files modified here that ALSO changed upstream. git
# refuses rather than overwrite them, which is exactly why the pull aborts.
TMP_IN=$(mktemp) || exit 0
TMP_OTHER=$(mktemp) || { rm -f "$TMP_IN"; exit 0; }
trap 'rm -f "$TMP_IN" "$TMP_OTHER"' EXIT INT TERM

# NOTE: no process substitution `<(...)` anywhere below — this file runs under
# /bin/sh, which is dash on Linux and has no such syntax.
git diff --name-only HEAD...FETCH_HEAD 2>/dev/null | sort > "$TMP_IN"
git diff --name-only 2>/dev/null | sort > "$TMP_OTHER"
BLOCKERS=$(comm -12 "$TMP_OTHER" "$TMP_IN" 2>/dev/null)

if [ -n "$BLOCKERS" ]; then
  echo "  Uncommitted files that upstream also changed — these are the blockers:"
  printf '%s\n' "$BLOCKERS" | while IFS= read -r f; do
    [ -n "$f" ] || continue
    WHEN=$(stat -f '%Sm' -t '%Y-%m-%d %H:%M' "$f" 2>/dev/null || stat -c '%y' "$f" 2>/dev/null | cut -c1-16)
    echo "      $WHEN  $f"
  done
  echo ""
  echo "  If those timestamps are days old they are probably orphaned by a dead"
  echo "  session. Check before assuming: node coord.cjs owner <file>"
  echo "  Preserve first (a branch, or a patch), THEN clear. Never discard blind."
  echo ""
fi

git ls-files --others --exclude-standard 2>/dev/null | sort > "$TMP_OTHER"
UNTRACKED_BLOCK=$(comm -12 "$TMP_OTHER" "$TMP_IN" 2>/dev/null)
if [ -n "$UNTRACKED_BLOCK" ]; then
  echo "  Untracked files that upstream now adds (also block the merge):"
  printf '%s\n' "$UNTRACKED_BLOCK" | sed 's/^/      /'
  echo ""
fi

echo "  Working in your own worktree avoids this entirely — a worktree has its"
echo "  own working tree and index, so a stranger's unsaved edit cannot wedge it."
echo ""
exit 0
