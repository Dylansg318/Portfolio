#!/usr/bin/env node
/**
 * reap-claude-sessions — the CLOSING half of spawn-claude-sessions.
 *
 * Closes each finished slice's iTerm2 tab AND removes its git worktree, in that
 * order, with a safety check in front of both.
 *
 *   node reap-claude-sessions.mjs --slices a,b,c --dry-run
 *   node reap-claude-sessions.mjs --slices a,b,c
 *   node reap-claude-sessions.mjs --all-merged [--into <branch>]
 *   node reap-claude-sessions.mjs --watch --slices a,b   # started by the spawner
 *
 * --into defaults to the repo's default branch (origin/HEAD).
 *
 * --watch is the AUTOMATIC reap (2026-09-28: the orchestrator kept having to be asked whether it
 * had reaped, even with a standing note telling it to reap unprompted). spawn-claude-sessions.mjs
 * starts it, detached, for exactly the slices it opened. Every --interval-min (5) it fetches
 * origin/<into>; a slice is reaped once it passes every check below (not this session, clean,
 * merged, has commits of its own, not mid-turn) AND its worktree (HEAD + status) has not changed
 * for --grace-min (10). There is no "done" message in this flow, so that quiet period is what
 * stands in for one. It exits when none of its slices has a worktree left, or after --max-hours (72).
 *
 * WHY THIS EXISTS. The parallelize flow used to end at "remove the worktree",
 * which leaves the tab open on a directory that no longer exists. The session
 * still registers as live, its shell is rooted in a deleted path, and the next
 * person cannot tell a finished slice from a running one. Reaping is BOTH.
 *
 * ORDER IS LOAD-BEARING: close the tab FIRST, then remove the worktree. Do it
 * the other way and the session spends the gap rooted in a deleted directory.
 * (Measured 2026-09-04: worktrees removed while three tabs were still open —
 * every one of them became a shell in a path that no longer resolved.)
 *
 * ============================================================================
 * THE TRAP THIS SCRIPT EXISTS TO NOT REPEAT — read before editing closeTab().
 * ============================================================================
 * `repeat with t in tabs of w` binds a POSITIONAL specifier ("tab 3 of window
 * 1"), which AppleScript re-evaluates at every use. Collect three such refs,
 * close the first, and the other two now point at DIFFERENT tabs, because the
 * list renumbered under them.
 *
 * Measured 2026-09-04, closing three slice tabs at indices 3/4/5 of eight:
 *   close "tab 3" -> hit the intended tab
 *   close "tab 4" -> list had shifted; hit what was tab 5
 *   close "tab 5" -> list had shifted twice; hit what was tab 7 —
 *                    A LIVE UNRELATED SESSION, killed with 137 lines of
 *                    uncommitted draft open in it.
 * The intended tab 4 survived, having slid down to position 3.
 *
 * spawn-claude-sessions.mjs learned this for WINDOWS (it holds `window id N`
 * rather than the loop variable). The same hazard exists one level down for
 * TABS, and the fix here is the same shape: never hold a positional reference
 * across a mutation. closeTab() re-resolves by TTY and closes exactly one tab
 * per AppleScript invocation. Do not "optimise" it into a batch loop.
 * ============================================================================
 *
 * IDENTITY IS THE `-w` FLAG, NOT THE TAB TITLE. Claude Code rewrites tab titles
 * to rolling conversation summaries, so a title that reads "ci-floor-assertions"
 * today may read anything tomorrow. The spawner launches each slice as
 * `claude -w <slice> -n <slice> ...`, and that argv survives for the life of the
 * process. We match on it, then map pid -> tty -> tab.
 *
 * BACKGROUND SESSIONS (2026-10-06). Slices start as background sessions by default now. Their
 * process is `claude bg-spare …` with no tty and no `-w`, so the tab lookup above never sees one —
 * and a merged, clean slice would read "no live tab" and have its worktree removed from under a
 * running session. So a slice's session is also looked up in `claude agents --json --all` (by the
 * id the spawner recorded, else by its worktree), judged by the same checks, and closed with
 * `claude rm <id>`, which stops it and removes its worktree; `git worktree prune` follows. A list
 * that can't be read decides nothing. Mechanics: ./lib/background-sessions.mjs.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { agentIn, listBackground } from './lib/background-sessions.mjs';

const CLAUDE_BIN = process.env.CLAUDE_BIN || path.join(os.homedir(), '.local', 'bin', 'claude');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d = null) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const DRY = has('--dry-run');
const KEEP_BRANCHES = !has('--delete-branches');
const WATCH = has('--watch');

function git(cwd, ...a) {
  return execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
}

function resolveRepo() {
  try {
    return git(process.cwd(), 'rev-parse', '--show-toplevel');
  } catch {
    console.error('error: run this from inside the git repo the slices worked on');
    process.exit(1);
  }
}

const REPO = resolveRepo();

// The spawner's owner book lives in the MAIN checkout (the common git dir's parent), wherever this runs.
function spawnBook() {
  try {
    const main = path.dirname(git(REPO, 'rev-parse', '--path-format=absolute', '--git-common-dir'));
    return JSON.parse(readFileSync(path.join(main, '.claude', 'worktrees', '.spawn-owners.json'), 'utf8')) || {};
  } catch {
    return {};
  }
}

// The integration branch a slice must be merged into before it is reaped. Defaults to the
// repo's own default branch (origin/HEAD) — a hardcoded `working` made every slice in a
// `main` repo REFUSE as "not merged". No origin/HEAD → ask rather than guess.
function resolveInto() {
  const given = val('--into');
  if (given) return given;
  try {
    return execFileSync('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], {
      cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim().replace(/^origin\//, '');
  } catch {
    console.error('error: cannot tell the integration branch (origin/HEAD is not set) — pass --into <branch>,');
    console.error('       or set it once with: git remote set-head origin --auto');
    process.exit(1);
  }
}

const INTO = resolveInto();

/** All registered worktrees: [{ path, branch, locked }] */
function worktrees() {
  const out = git(REPO, 'worktree', 'list', '--porcelain');
  const list = [];
  let cur = {};
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (cur.path) list.push(cur);
      cur = { path: line.slice(9), locked: false, branch: null };
    } else if (line.startsWith('branch ')) {
      cur.branch = line.slice(7).replace('refs/heads/', '');
    } else if (line === 'locked' || line.startsWith('locked ')) {
      cur.locked = true;
    }
  }
  if (cur.path) list.push(cur);
  return list;
}

/**
 * Every running Claude session: [{ pid, tty, slice|null }].
 *
 * `slice` comes from the `-w` flag the spawner passes, which is the reliable
 * marker — it sits at the front of argv (well before the prompt text, so `ps`
 * truncation cannot eat it) and nothing rewrites it. But a session that entered
 * its worktree MID-FLIGHT (the EnterWorktree tool, rather than `claude -w`) has
 * no such flag, so `slice` is null for those and they are matched by working
 * directory instead — see sessionFor(). Without that fallback the reaper reports
 * "no live tab", removes the worktree anyway, and recreates the exact stranded-
 * tab bug this script exists to prevent.
 */
function claudeSessions() {
  const out = execFileSync('ps', ['-eo', 'pid=,tty=,command='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const found = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const [, pid, tty, cmd] = m;
    if (!/\/claude(\s|$)/.test(cmd)) continue;
    if (tty === '??' || tty === '-') continue; // no controlling terminal = no tab
    const w = cmd.match(/\s-w\s+(\S+)/) || cmd.match(/\s--worktree\s+(\S+)/);
    found.push({
      pid: Number(pid),
      tty: tty.startsWith('/dev/') ? tty : `/dev/${tty}`,
      slice: w ? w[1] : null,
    });
  }
  return found;
}

/**
 * Is `pid` an ancestor of this process? i.e. are we running INSIDE that session?
 *
 * Load-bearing: the reaper is normally invoked BY a Claude session, and that
 * session may itself sit in a merged, clean worktree — so `--all-merged` would
 * otherwise close the tab it is currently running in, killing itself mid-sweep
 * and leaving the remaining slices unreaped. Verified 2026-09-04: a dry run
 * matched the calling session's own tab, whose TITLE read "Book negative balance
 * model" (a rolling summary of its conversation) while its cwd proved what it
 * actually was.
 */
function isSelfAncestor(pid) {
  let cur = process.pid;
  for (let hop = 0; hop < 40 && cur > 1; hop++) {
    if (cur === pid) return true;
    try {
      cur = Number(execFileSync('ps', ['-o', 'ppid=', '-p', String(cur)], { encoding: 'utf8' }).trim());
    } catch {
      return false;
    }
    if (!Number.isFinite(cur)) return false;
  }
  return false;
}

/** A process's current working directory, or null. */
function cwdOf(pid) {
  try {
    const out = execFileSync('lsof', ['-a', '-d', 'cwd', '-p', String(pid), '-Fn'], { encoding: 'utf8' });
    const line = out.split('\n').find((l) => l.startsWith('n'));
    return line ? line.slice(1) : null;
  } catch {
    return null;
  }
}

/**
 * Every session a slice could be running in: `{ tabs, agents, book }` — tabs from `ps`, background
 * sessions from `claude agents --json --all` (exited ones included: `claude rm` clears them too).
 * Throws when the background list can't be read.
 */
function liveSessions() {
  return { tabs: claudeSessions(), agents: listBackground(CLAUDE_BIN, { all: true }), book: spawnBook() };
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

/**
 * The session for a worktree: a tab by `-w` name first, then a tab by cwd, then a background
 * session (its recorded id, else one working in the worktree).
 * Never guesses from the tab title — Claude Code rewrites those to rolling
 * conversation summaries, so a title is not identity.
 */
function sessionFor(live, slice, wtPath) {
  const byFlag = live.tabs.find((s) => s.slice === slice);
  if (byFlag) return byFlag;
  const byCwd = live.tabs.find((s) => s.slice === null && cwdOf(s.pid) === wtPath);
  if (byCwd) return byCwd;
  const ag = agentIn(live.agents, wtPath, live.book[slice]?.bg);
  if (!ag) return null;
  const up = Boolean(ag.pid) && alive(ag.pid);
  return { kind: 'background', id: ag.id, sessionId: ag.sessionId, pid: up ? ag.pid : null, busy: up && (ag.status === 'busy' || ag.state === 'working') };
}

/**
 * Close exactly ONE tab, resolved by tty at the moment of closing.
 * See the trap note at the top: one tab per invocation, never a batch.
 */
function closeTab(tty) {
  const scpt = `
    on run argv
      set target to item 1 of argv
      tell application "iTerm2"
        repeat with w in windows
          repeat with t in tabs of w
            repeat with s in sessions of t
              if (tty of s) is equal to target then
                close t
                return "closed"
              end if
            end repeat
          end repeat
        end repeat
      end tell
      return "not-found"
    end run`;
  return execFileSync('/usr/bin/osascript', ['-', tty], { input: scpt, encoding: 'utf8' }).trim();
}

/** Is the session on this tty mid-turn? iTerm2's own flag; unknown reads as not busy. */
function isProcessing(tty) {
  const scpt = `
    on run argv
      set target to item 1 of argv
      tell application "iTerm2"
        repeat with w in windows
          repeat with t in tabs of w
            repeat with s in sessions of t
              if (tty of s) is equal to target then return (get is processing of s) as string
            end repeat
          end repeat
        end repeat
      end tell
      return "unknown"
    end run`;
  try {
    return execFileSync('/usr/bin/osascript', ['-', tty], { input: scpt, encoding: 'utf8' }).trim() === 'true';
  } catch {
    return false;
  }
}

/** A worktree is safe to remove only if nothing is uncommitted in it. */
function isClean(wtPath) {
  try {
    return git(wtPath, 'status', '--porcelain') === '';
  } catch {
    return false;
  }
}

/** Its branch must already be contained in the integration branch. */
function isMerged(branch) {
  if (!branch) return false;
  try {
    git(REPO, 'merge-base', '--is-ancestor', branch, `origin/${INTO}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * "Merged" is vacuous for a branch with no commits of its own: a slice that has only just
 * started (or is still planning) sits AT its base, so it is an ancestor of the integration
 * branch and reads as merged — and reaping it closes a live session mid-work. Measured
 * 2026-09-24: a busy `race-room` slice with 0 commits came back "would reap".
 * The branch reflog tells the two apart — a finished slice has `commit:` entries, a fresh
 * one only "branch: Created from …". No reflog at all (disabled/expired) = unknown → the
 * old behaviour (allow), since the clean-tree and merged checks still stand.
 */
function hasOwnCommits(branch) {
  let log;
  try {
    log = execFileSync('git', ['reflog', 'show', '--format=%gs', `refs/heads/${branch}`], {
      cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return true;
  }
  const entries = log.split('\n').filter(Boolean);
  if (!entries.length) return true;
  return entries.some((e) => /^(commit|cherry-pick|revert)\b/.test(e));
}

/** Why a slice may not be reaped right now, or null when it may. */
function refusal(slice, wt, live) {
  const sess = sessionFor(live, slice, wt.path);
  const self = sess && ((sess.pid && isSelfAncestor(sess.pid))
    || (sess.kind === 'background' && sess.sessionId && sess.sessionId === process.env.CLAUDE_CODE_SESSION_ID));
  if (self) return 'this is the session running the reaper — close it yourself';
  if (!isClean(wt.path)) return 'worktree has uncommitted or untracked files';
  if (!isMerged(wt.branch)) return `branch ${wt.branch} is not merged into origin/${INTO}`;
  if (!hasOwnCommits(wt.branch)) return `branch ${wt.branch} has no commits of its own — still starting, or abandoned; remove it by hand if abandoned`;
  if (sess && (sess.kind === 'background' ? sess.busy : isProcessing(sess.tty))) return 'mid-turn right now';
  return null;
}

/**
 * A background slice's close: `claude rm` stops it and removes its worktree (and local branch) when
 * Claude Code judges that safe; anything it leaves is removed as a tab slice's would be, then
 * `git worktree prune` drops the admin folder `claude rm` once left behind.
 */
function reapBackground(slice, wt, sess) {
  if (DRY) return { slice, action: 'would reap', why: `claude rm ${sess.id} (background session${sess.pid ? `, pid ${sess.pid}` : ', exited'}), which removes ${wt.path}` };
  try {
    execFileSync(CLAUDE_BIN, ['rm', sess.id], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 });
  } catch (err) {
    return { slice, action: 'REFUSE', why: `claude rm ${sess.id} failed: ${String(err.stderr || err.message).trim().split('\n').pop()}` };
  }
  if (existsSync(wt.path)) {
    try {
      if (wt.locked) git(REPO, 'worktree', 'unlock', wt.path);
      git(REPO, 'worktree', 'remove', wt.path);
    } catch (err) {
      return { slice, action: 'PARTIAL', why: `session removed, but worktree remove failed: ${err.message}` };
    }
  }
  try { git(REPO, 'worktree', 'prune'); } catch { /* best effort */ }
  let branch = 'deleted its branch (merged)';
  try { git(REPO, 'rev-parse', '--verify', '--quiet', `refs/heads/${wt.branch}`); branch = `kept branch ${wt.branch}`; } catch { /* gone with claude rm */ }
  return { slice, action: 'reaped', why: `claude rm ${sess.id}, removed ${wt.path}, ${branch}` };
}

/** Close the slice's tab, then remove its worktree — the order is load-bearing (header). */
function reapOne(slice, wts, live) {
  const wt = wts.find((w) => path.basename(w.path) === slice);
  if (!wt) return { slice, action: 'SKIP', why: 'no worktree registered by that name' };
  const why = refusal(slice, wt, live);
  if (why) return { slice, action: 'REFUSE', why };
  const sess = sessionFor(live, slice, wt.path);
  if (sess?.kind === 'background') return reapBackground(slice, wt, sess);

  if (DRY) {
    return {
      slice,
      action: 'would reap',
      why: `${sess ? `close tab ${sess.tty} (pid ${sess.pid}), ` : 'no live tab, '}remove ${wt.path}`,
    };
  }

  // Tab first, worktree second — never leave a session rooted in a deleted dir.
  let tab = 'no live tab';
  if (sess) {
    try {
      // SIGTERM before closing the tab so Claude runs its SessionEnd hook and
      // deregisters from any session-coordination registry. Closing the tab
      // outright leaves a stale "live session" entry behind — which is the
      // same confusion a half-reap causes, just in a different list.
      try {
        process.kill(sess.pid, 'SIGTERM');
        execFileSync('/bin/sleep', ['1']);
      } catch { /* already gone */ }
      tab = `${closeTab(sess.tty)} ${sess.tty}`;
    } catch (err) {
      return { slice, action: 'REFUSE', why: `could not close tab: ${err.message}` };
    }
  }

  try {
    if (wt.locked) git(REPO, 'worktree', 'unlock', wt.path);
    // No --force: git refuses on dirt, which is the last line of defence.
    git(REPO, 'worktree', 'remove', wt.path);
  } catch (err) {
    return { slice, action: 'PARTIAL', why: `tab ${tab}, but worktree remove failed: ${err.message}` };
  }

  if (!KEEP_BRANCHES) git(REPO, 'branch', '-d', wt.branch);
  return { slice, action: 'reaped', why: `${tab}, removed ${wt.path}, kept branch ${wt.branch}` };
}

function main() {
  const wts = worktrees();
  let live;
  try {
    live = liveSessions();
  } catch (err) {
    console.error(`reap-claude-sessions: ${err.message} — nothing was decided; try again in a minute.`);
    process.exit(1);
  }

  let slices;
  if (has('--all-merged')) {
    slices = wts
      .filter((w) => w.path !== REPO && isMerged(w.branch) && hasOwnCommits(w.branch) && isClean(w.path))
      .map((w) => path.basename(w.path));
  } else {
    const raw = val('--slices');
    if (!raw) {
      console.error('usage: reap-claude-sessions.mjs --slices a,b,c [--dry-run]');
      console.error('       reap-claude-sessions.mjs --all-merged [--into <branch>]   (default: origin/HEAD)');
      console.error('       reap-claude-sessions.mjs --watch --slices a,b [--interval-min 5 --grace-min 10 --max-hours 72]');
      process.exit(1);
    }
    slices = raw.split(',').map((s) => s.trim()).filter(Boolean);
  }

  if (!slices.length) {
    console.log('nothing to reap.');
    return;
  }

  const results = slices.map((slice) => reapOne(slice, wts, live));
  const pad = Math.max(...results.map((r) => r.slice.length));
  for (const r of results) {
    console.log(`${r.slice.padEnd(pad)}  ${r.action.padEnd(10)}  ${r.why}`);
  }

  const bad = results.filter((r) => r.action === 'REFUSE' || r.action === 'PARTIAL');
  if (bad.length) process.exitCode = 1;
}

/** The automatic reap: see the header. Logs one line per decision to stdout (the spawner's log file). */
async function watch() {
  const slices = String(val('--slices') || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!slices.length) { console.error('--watch needs --slices a,b'); process.exit(1); }
  const intervalMs = Number(val('--interval-min', '5')) * 60_000;
  const graceMs = Number(val('--grace-min', '10')) * 60_000;
  const deadline = Date.now() + Number(val('--max-hours', '72')) * 3_600_000;
  const stamp = () => new Date().toISOString();
  const fingerprint = (wt) => {
    try { return `${git(wt.path, 'rev-parse', 'HEAD')}|${git(wt.path, 'status', '--porcelain')}`; } catch { return null; }
  };
  const quiet = new Map(); // slice -> { fp, at }: first tick it passed every check with this fingerprint
  console.log(`${stamp()} watching ${slices.join(', ')} in ${REPO} (into origin/${INTO}) — every ${intervalMs / 60_000} min, quiet ${graceMs / 60_000} min`);
  for (;;) {
    await new Promise((r) => setTimeout(r, intervalMs));
    try { git(REPO, 'fetch', '--quiet', 'origin', INTO); } catch { /* offline: judge on what we have */ }
    const wts = worktrees();
    let live;
    try {
      live = liveSessions();
    } catch (err) {
      // A tick that can't see the background sessions decides nothing — one may be running in a slice.
      console.log(`${stamp()} skipped this tick — ${err.message}`);
      if (Date.now() > deadline) { console.log(`${stamp()} --max-hours reached; reap by hand`); return; }
      continue;
    }
    const left = slices.filter((slice) => wts.some((w) => path.basename(w.path) === slice));
    for (const slice of left) {
      const wt = wts.find((w) => path.basename(w.path) === slice);
      if (refusal(slice, wt, live)) { quiet.delete(slice); continue; }
      const fp = fingerprint(wt);
      const q = quiet.get(slice);
      if (!q || q.fp !== fp) { quiet.set(slice, { fp, at: Date.now() }); continue; }
      if (Date.now() - q.at < graceMs) continue;
      const r = reapOne(slice, wts, live);
      console.log(`${stamp()} ${r.slice}  ${r.action}  ${r.why}`);
    }
    const still = slices.filter((slice) => worktrees().some((w) => path.basename(w.path) === slice));
    if (!still.length) { console.log(`${stamp()} every slice reaped — watch over`); return; }
    if (Date.now() > deadline) { console.log(`${stamp()} --max-hours reached; still open: ${still.join(', ')} — reap by hand`); return; }
  }
}

if (WATCH) watch().catch((e) => { console.error(e.stack); process.exit(1); });
else main();
