'use strict';
/**
 * "What will git refuse to commit?" — the shared skip seam for the pre-commit
 * gate's whole-tree scanners (the verify script's source scans and
 * arch-guard.mjs).
 *
 * WHY THIS EXISTS. Those scanners read the FILESYSTEM, so they used to scan
 * untracked files too. The pre-commit hook runs them over the whole tree
 * BEFORE it looks at what you staged, so in a checkout shared by many agent
 * sessions ONE stray file failed EVERY session's commit, with an error naming
 * a file the committer never touched. Measured in production: an
 * already-executed one-off repair script, left behind by a session that died,
 * blocked every live session's commits for roughly a day. A pull cannot clear
 * it — untracked files survive every fetch, merge and checkout, so it must be
 * deleted in that tree.
 *
 * WHY `git ls-files --others` IS THE EXACT ANSWER, not an approximation.
 * For a path-form commit — `git commit -m "…" <paths>`, which this repo
 * mandates — git runs hooks with GIT_INDEX_FILE pointed at a TEMPORARY index
 * holding HEAD plus only the named paths, and `--others` is computed against
 * THAT index. The skip set and the commit contents therefore derive from the
 * same index by construction: a file is scanned iff it can land in the commit
 * being made. `git add` moves a file OUT of `--others`, so staged-new files are
 * still scanned. (Verified: a peer's staged-new file shows in `--others` during
 * your path-form commit AND is absent from that commit.)
 *
 * `--exclude-standard` is deliberately OMITTED. An ignored file can no more be
 * committed than an untracked one, and keeping the flag left the same outage
 * alive in a narrower, ignored-file form. That can make the set large, hence
 * the per-root pathspec — repo-wide without the flag would enumerate
 * node_modules.
 *
 * FAIL-OPEN, ALWAYS. Any failure (not a repo, git missing, maxBuffer overflow
 * from a stray untracked node_modules) yields EMPTY sets, which scan
 * EVERYTHING. That costs availability — the outage above returns — but never
 * coverage. The inverse "keep-set" design (scan iff `git ls-files --cached`
 * lists it) fails the other way: an error scans NOTHING and prints a green
 * result on a CI-blocking gate.
 */

const { execFileSync } = require('child_process');
const path = require('path');

const CACHE = new Map();

/**
 * Everything under `root` that git will not commit, as ABSOLUTE paths.
 *
 * Absolute (not cwd-relative) on purpose: one caller walks absolute paths
 * built from __dirname while another walks cwd-relative ones, so an absolute
 * set lets either caller test membership without knowing the other's
 * convention.
 *
 * @param {string} root directory to scope the query to
 * @returns {{files: Set<string>, dirs: Set<string>}} `dirs` holds NESTED GIT
 *   REPOS (a stray clone or worktree). git reports those as a single directory
 *   entry with a trailing slash and never lists the files inside, so a
 *   file-level check alone would miss every file within one — callers must
 *   prune recursion on `dirs`.
 */
function untrackedPaths(root) {
  const abs = path.resolve(root);
  const cached = CACHE.get(abs);
  if (cached) return cached;

  const files = new Set();
  const dirs = new Set();
  try {
    // DO NOT PASS `cwd` HERE. Inside a git hook, GIT_DIR is exported but
    // GIT_WORK_TREE is not, so a git process started in a SUBDIRECTORY treats
    // that subdirectory as the work tree — and every tracked file beneath it
    // comes back as "other". That inverts this helper: the skip set swallows
    // the whole tree and the gate silently scans NOTHING while printing a
    // clean bill of health. It shipped exactly once, during a path-form commit
    // in a worktree, and read as `SQL scan: 0 files` /
    // `HARD violations (0) ✓ clean`. Measured in a scratch worktree:
    // `--others` from the repo root → 0 entries, from a subdirectory → the
    // tracked file. Run in the caller's own cwd (the hook, CI and the report
    // script all invoke from the repo root) and scope with an ABSOLUTE
    // pathspec instead.
    const out = execFileSync('git', ['ls-files', '--others', '-z', '--', abs], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    // `-z` is load-bearing: without it git C-quotes non-ASCII paths
    // ("server/caf\303\251.js"), which would never match a real path.
    for (const rel of out.split('\0')) {
      if (!rel) continue;
      // Output is relative to the git process's cwd, which is ours — so a bare
      // resolve() is correct. Test the trailing slash BEFORE resolve(), which
      // strips it.
      if (rel.endsWith('/')) dirs.add(path.resolve(rel));
      else files.add(path.resolve(rel));
    }
  } catch {
    // Fail open — see the header. Empty sets scan everything.
    files.clear();
    dirs.clear();
  }

  const result = { files, dirs };
  CACHE.set(abs, result);
  return result;
}

module.exports = { untrackedPaths };
