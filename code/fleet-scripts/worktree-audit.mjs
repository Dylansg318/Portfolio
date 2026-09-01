#!/usr/bin/env node
/**
 * worktree-audit — find finished-but-unmerged work, and prune dead worktrees.
 *
 * WHY THIS EXISTS: one audit of a long-running multi-session repo found 41
 * worktrees across four competing naming conventions holding over 11 GB of
 * checkouts, and — the actual cost — two pieces of finished, tested work that
 * had sat unmerged for five weeks because the old parallel-sessions flow ended
 * at "each session pushes to its own branch" and relied on a human remembering
 * to run an integrator pass. Nobody did. A barcode (MaxiCode) rasterizer and a
 * set of inventory-count fixes quietly rotted.
 *
 *   node worktree-audit.mjs             # report only (default)
 *   node worktree-audit.mjs --prune     # also remove provably-dead worktrees
 *   node worktree-audit.mjs --json      # machine-readable
 *
 * THE THREE-DOT TRAP — read before changing the merge test. `git diff A...B`
 * diffs from the MERGE BASE, so it shows every change made on B since it forked
 * even when A independently gained the identical fix. Using it to answer "is
 * this work already on the integration branch?" produces false "stranded"
 * verdicts (it did, for the inventory-count branch, in the very audit that
 * motivated this script). The honest test is per-file content comparison
 * against the base branch, which is what `classifyBranch` does below.
 *
 * SAFETY: --prune never removes a worktree that (a) has uncommitted changes,
 * (b) holds commits whose content is not on the base branch, (c) has a live
 * process cwd'd inside it, or (d) lives outside the repo (someone's /tmp
 * scratch). Everything else is a checkout that can be recreated with one
 * command, so removing it loses nothing — branches are never deleted.
 *
 * Env: FLEET_REPO (default: git toplevel of cwd), FLEET_BASE_BRANCH (default "main").
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const REPO = process.env.FLEET_REPO || (() => {
  try {
    return execFileSync('/usr/bin/git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    return process.cwd();
  }
})();
const BASE = `origin/${process.env.FLEET_BASE_BRANCH || 'main'}`;

const args = process.argv.slice(2);
const PRUNE = args.includes('--prune');
const JSON_OUT = args.includes('--json');

function git(a, cwd = REPO) {
  try {
    // stderr is piped, not inherited: a missing path is an EXPECTED answer here
    // ("absent from base"), and letting git's `fatal:` reach the terminal makes
    // a correct result look like a crash.
    return execFileSync('/usr/bin/git', a, {
      cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}
function gitOk(a, cwd = REPO) {
  try {
    execFileSync('/usr/bin/git', a, { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function listWorktrees() {
  const out = git(['worktree', 'list', '--porcelain']);
  const wts = [];
  let cur = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) cur = { path: line.slice(9) };
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace('refs/heads/', '');
    else if (line.startsWith('detached')) cur.branch = '(detached)';
    else if (line === '' && cur) { wts.push(cur); cur = null; }
  }
  if (cur) wts.push(cur);
  return wts.filter((w) => w.path !== REPO);
}

/** Processes with a cwd inside `dir` — the only reliable "in use" signal. */
function cwdsInUse() {
  try {
    const out = execFileSync('/bin/sh', ['-c', "/usr/sbin/lsof -a -d cwd -Fn 2>/dev/null | /usr/bin/grep '^n' | /usr/bin/sed 's/^n//' | /usr/bin/sort -u"], {
      encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    });
    return out.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Is this branch's work already on BASE? Compares the content of every file the
 * branch touched, rather than trusting ancestry — squash/rebase merges land the
 * content under a new SHA, so ancestry alone reports landed work as stranded.
 */
function classifyBranch(branch) {
  if (!branch || branch === '(detached)') return { verdict: 'detached', files: [] };
  if (gitOk(['merge-base', '--is-ancestor', branch, BASE])) return { verdict: 'merged', files: [] };

  const touched = git(['diff', '--name-only', `${BASE}...${branch}`]).split('\n').filter(Boolean);
  if (!touched.length) return { verdict: 'no-diff', files: [] };

  const missing = [];
  for (const f of touched) {
    const onBase = git(['rev-parse', `${BASE}:${f}`]);
    const onBranch = git(['rev-parse', `${branch}:${f}`]);
    // Absent from BASE entirely, or present with different content.
    if (!onBase) missing.push({ file: f, why: 'absent from base' });
    else if (onBase !== onBranch) missing.push({ file: f, why: 'differs from base' });
  }
  if (!missing.length) return { verdict: 'landed-elsewhere', files: [] };
  // Every touched file absent from base => nothing of this landed.
  const allAbsent = missing.every((m) => m.why === 'absent from base');
  return { verdict: allAbsent ? 'stranded' : 'partial', files: missing };
}

function main() {
  git(['fetch', 'origin', BASE.replace(/^origin\//, ''), '--quiet']);
  const inUse = cwdsInUse();
  const rows = [];

  for (const w of listWorktrees()) {
    // "Outside the repo" = not under the repo root and not a sibling checkout
    // following the <repo>-<suffix> convention next to it.
    const outside = !w.path.startsWith(REPO) && !w.path.startsWith(`${REPO}-`);
    const gone = !existsSync(w.path);
    const dirty = gone ? 0 : git(['status', '--porcelain'], w.path).split('\n').filter(Boolean).length;
    const busy = inUse.some((c) => c === w.path || c.startsWith(w.path + '/'));
    const { verdict, files } = classifyBranch(w.branch);
    const last = gone ? '' : git(['log', '-1', '--format=%cd', '--date=short'], w.path);

    const hasWork = verdict === 'stranded' || verdict === 'partial';
    const prunable = !busy && !outside && !gone && dirty === 0 && !hasWork;

    rows.push({ path: w.path, name: path.basename(w.path), branch: w.branch, verdict, dirty, busy, outside, last, prunable, missing: files });
  }

  if (JSON_OUT) { console.log(JSON.stringify(rows, null, 2)); return; }

  const work = rows.filter((r) => r.verdict === 'stranded' || r.verdict === 'partial');
  const dirtyRows = rows.filter((r) => r.dirty > 0);
  const prunable = rows.filter((r) => r.prunable);

  console.log(`\nworktrees: ${rows.length}    unmerged work: ${work.length}    dirty: ${dirtyRows.length}    prunable: ${prunable.length}\n`);

  if (work.length) {
    console.log(`UNMERGED WORK — finished in a worktree, not on ${BASE}:`);
    for (const r of work) {
      console.log(`  ${r.name}  [${r.branch}]  ${r.verdict}  last=${r.last}`);
      for (const m of r.missing.slice(0, 6)) console.log(`      ${m.why.padEnd(18)} ${m.file}`);
      if (r.missing.length > 6) console.log(`      … and ${r.missing.length - 6} more`);
    }
    console.log('');
  } else {
    console.log(`UNMERGED WORK: none — every worktree branch is on ${BASE}.\n`);
  }

  if (dirtyRows.length) {
    console.log('UNCOMMITTED CHANGES (never pruned):');
    for (const r of dirtyRows) console.log(`  ${r.name}  ${r.dirty} file(s)`);
    console.log('');
  }

  const skipped = rows.filter((r) => !r.prunable && r.verdict !== 'stranded' && r.verdict !== 'partial' && r.dirty === 0);
  if (skipped.length) {
    console.log('SKIPPED (in use or outside the repo):');
    for (const r of skipped) console.log(`  ${r.name}  ${r.busy ? 'process cwd inside' : 'outside repo tree'}`);
    console.log('');
  }

  if (!PRUNE) {
    console.log(prunable.length
      ? `${prunable.length} worktree(s) are dead and removable — re-run with --prune to remove them (branches are kept).`
      : 'Nothing to prune.');
    return;
  }

  let ok = 0;
  for (const r of prunable) {
    if (!gitOk(['worktree', 'remove', '--force', r.path])) {
      git(['worktree', 'unlock', r.path]);
      if (!gitOk(['worktree', 'remove', '--force', r.path])) { console.log(`  FAILED  ${r.name}`); continue; }
    }
    ok++;
    console.log(`  removed ${r.name}`);
  }
  git(['worktree', 'prune']);
  console.log(`\npruned ${ok} of ${prunable.length}. Branches untouched.`);
}

main();
