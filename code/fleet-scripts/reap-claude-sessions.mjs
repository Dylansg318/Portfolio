#!/usr/bin/env node
/**
 * reap-claude-sessions — say which spawned Claude tabs are safe to close, and close them.
 *
 * WHY THIS EXISTS: `spawn-claude-sessions.mjs` opens one iTerm2 tab per slice and nothing
 * ever closes them. After the integrator merges a phase, the window holds a mix of tabs that
 * are (a) finished and merged, (b) still working, (c) waiting on a question, and (d) corpses
 * whose Claude process already exited — and they all look identical, because Claude Code
 * rewrites every tab's title to a conversation summary. Observed in practice: 5 open tabs,
 * one of which had no process on its tty at all.
 *
 * There is a second, sharper cost. `worktree-audit --prune` refuses to remove a worktree with
 * a live process cwd'd inside it, so a tab left open on a merged slice permanently blocks the
 * cleanup of its own worktree (a full checkout — often around a gigabyte each with installed
 * dependencies). Reap runs BEFORE prune, not after.
 *
 *   node reap-claude-sessions.mjs                 # report only (default)
 *   node reap-claude-sessions.mjs --close         # close only the provably-safe tabs
 *   node reap-claude-sessions.mjs --close --dry-run
 *   node reap-claude-sessions.mjs --close --all-merged   # also close merged-but-silent
 *   node reap-claude-sessions.mjs --json
 *
 * SAFE means every one of these holds, not a guess from the tab title:
 *   - it is not this tab (the caller is never reaped)
 *   - its Claude process is gone           OR
 *   - it sits in a .claude/worktrees/ slice whose tree is clean, whose branch content is on
 *     the integration branch (worktree-audit's per-file test, not the three-dot trap), which
 *     is not mid-turn, holds no coordination lock, and which broadcast a "done" message.
 * Anything else is KEPT and printed with the reason it was kept. A tab in the MAIN checkout is
 * never auto-closed while it has a process: those are hand-opened sessions, not spawned slices.
 *
 * SCROLLBACK IS LOST when a tab closes. --dry-run first if that matters.
 *
 * Env: FLEET_REPO (default: git toplevel of this script's directory),
 *      FLEET_BASE_BRANCH (default "main").
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);

const REPO = process.env.FLEET_REPO || (() => {
  try {
    return execFileSync('/usr/bin/git', ['rev-parse', '--show-toplevel'], {
      cwd: path.dirname(new URL(import.meta.url).pathname), encoding: 'utf8',
    }).trim();
  } catch {
    return process.cwd();
  }
})();
const BASE = `origin/${process.env.FLEET_BASE_BRANCH || 'main'}`;
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);

// OWNERSHIP. Safety evidence (clean tree, merged, announced done) looks exactly
// the same for a slice belonging to someone else's run — which is how a reap
// from one session once closed a finished slice from a DIFFERENT operator's
// run. Nothing was lost (the commit was already on the integration branch) but
// the scrollback was, and it was not that session's to close.
//
// spawn-claude-sessions.mjs now records who opened each slice. A slice this tab
// did not spawn is reported FOREIGN and left alone unless --any-owner is passed.
// A slice with NO record (spawned before this existed, or opened by hand) is
// also FOREIGN — refusing to close is the safe direction when we cannot tell.
const MY_TAB = (process.env.ITERM_SESSION_ID || '').split(':').pop() || '';

function loadOwners(repo) {
  try {
    return JSON.parse(readFileSync(path.join(repo, '.claude', 'worktrees', '.spawn-owners.json'), 'utf8')) || {};
  } catch {
    return {};
  }
}

const args = process.argv.slice(2);
const CLOSE = args.includes('--close');
const DRY = args.includes('--dry-run');
const JSON_OUT = args.includes('--json');
const ALL_MERGED = args.includes('--all-merged');
const ANY_OWNER = args.includes('--any-owner');
const HELP = args.includes('--help') || args.includes('-h');

if (HELP) {
  console.log(`
reap-claude-sessions — which spawned Claude tabs are safe to close, and close them

  (no flags)       report only
  --close          close the SAFE tabs (SIGTERM the session, then close the iTerm2 tab)
  --dry-run        with --close, print what would close and stop
  --all-merged     also treat merged+clean+idle tabs as safe even if they never announced
  --any-owner      also close slices spawned by a DIFFERENT tab (default: only this run's)
  --json           machine-readable

Run this BEFORE \`worktree-audit --prune\` — an open tab blocks its own worktree's removal.
`);
  process.exit(0);
}

/* ---------------------------------------------------------------- helpers */

function sh(bin, argv, opts = {}) {
  try {
    return execFileSync(bin, argv, {
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...opts,
    }).trim();
  } catch {
    return '';
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------- iTerm2 enumeration */

// Tab titles are useless for identity — Claude Code rewrites them continuously. We key on the
// session GUID and resolve everything else from the tty.
const LIST_AS = `
tell application "iTerm2"
  set out to ""
  set wi to 0
  repeat with w in windows
    set wi to wi + 1
    set ti to 0
    repeat with t in tabs of w
      set ti to ti + 1
      repeat with s in sessions of t
        set nm to ""
        try
          set nm to (get name of s)
        end try
        set pr to "false"
        try
          set pr to (get is processing of s) as string
        end try
        set out to out & (id of s) & "|~|" & (tty of s) & "|~|" & pr & "|~|" & wi & "|~|" & ti & "|~|" & nm & linefeed
      end repeat
    end repeat
  end repeat
  return out
end tell`;

function itermSessions() {
  const raw = sh('/usr/bin/osascript', ['-e', LIST_AS]);
  if (!raw) return [];
  return raw.split('\n').filter((l) => l.includes('|~|')).map((line) => {
    const [id, tty, processing, wi, ti, ...rest] = line.split('|~|');
    return {
      id,
      tty,
      processing: processing === 'true',
      window: Number(wi),
      tab: Number(ti),
      title: rest.join('|~|'),
    };
  });
}

/* --------------------------------------------------- process / cwd resolution */

// ONE ps pass. Per-tty `ps -t` is unreliable on macOS once a tty is released — it errors with
// "No such file or directory" for a tty iTerm2 still lists, which reads as a crash rather than
// the correct answer ("that session is dead").
function claudePidByTty() {
  const out = sh('/bin/ps', ['-A', '-o', 'pid=,tty=,command=']);
  const map = new Map();
  for (const line of out.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const [, pid, tty, cmd] = m;
    if (tty === '??' || tty === '?') continue;
    // The spawner runs the real binary; MCP servers and npm exec children share the tty.
    const first = cmd.split(/\s+/)[0];
    if (!/(^|\/)claude$/.test(first)) continue;
    if (!map.has(tty)) map.set(tty, Number(pid));
  }
  return map;
}

function cwdOf(pid) {
  const out = sh('/usr/sbin/lsof', ['-a', '-d', 'cwd', '-Fn', '-p', String(pid)]);
  const line = out.split('\n').find((l) => l.startsWith('n'));
  return line ? line.slice(1) : '';
}

/* ------------------------------------------------------------ worktree state */

// Reuse worktree-audit rather than re-deriving "is this branch on the base" — it owns the
// per-file content test and the three-dot trap it documents.
function auditByPath() {
  const raw = sh('/usr/bin/env', ['node', path.join(SCRIPT_DIR, 'worktree-audit.mjs'), '--json'], { cwd: REPO });
  const map = new Map();
  if (!raw) return map;
  let rows;
  try { rows = JSON.parse(raw); } catch { return map; }
  for (const r of rows) map.set(path.resolve(r.path), r);
  return map;
}

/* ----------------------------------------------------------------- coord state */

// OPTIONAL session-coordination layer. In the source repo, hooks register every
// live session in a small registry (`.claude/hooks/lib/coord-core.cjs`) with git
// locks and peer broadcasts; the reaper uses it to see mid-git-op locks and
// "done" announcements. When the module is absent, everything degrades to empty
// — the reaper then relies on worktree/process evidence alone.
function coordState() {
  const empty = { sessions: [], locks: [], broadcasts: [] };
  try {
    const C = require(path.join(REPO, '.claude', 'hooks', 'lib', 'coord-core.cjs'));
    const base = C.root(REPO);
    if (!base) return empty;
    return { sessions: C.sessions(base), locks: C.locks(base), broadcasts: C.allBroadcasts(base) };
  } catch {
    return empty;
  }
}

const DONE_RE = /\b(done|ready to merge|complete[d]?|finished)\b/i;

/* ------------------------------------------------------------------ classify */

function classify() {
  const selfGuid = (process.env.ITERM_SESSION_ID || '').split(':').pop() || '';
  const tabs = itermSessions();
  const pids = claudePidByTty();
  const audit = auditByPath();
  const coord = coordState();

  const rows = [];
  for (const t of tabs) {
    const ttyName = t.tty.replace(/^\/dev\//, '');
    const pid = pids.get(ttyName) || null;
    const row = {
      id: t.id, tty: t.tty, pid, window: t.window, tab: t.tab, title: t.title,
      processing: t.processing, cwd: '', worktree: '', slice: '', branch: '',
      verdict: '', dirty: 0, safe: false, state: '', why: '',
    };

    if (selfGuid && t.id === selfGuid) {
      Object.assign(row, { state: 'SELF', why: 'this tab — never reaped' });
      rows.push(row); continue;
    }
    if (!pid) {
      Object.assign(row, { state: 'EXITED', safe: true, why: 'no Claude process on its tty — a dead tab' });
      rows.push(row); continue;
    }

    row.cwd = cwdOf(pid);
    row.worktree = row.cwd ? (sh('/usr/bin/git', ['rev-parse', '--show-toplevel'], { cwd: row.cwd }) || row.cwd) : '';
    const isMain = row.worktree && path.resolve(row.worktree) === path.resolve(REPO);
    row.slice = !row.worktree || isMain ? '' : path.basename(row.worktree);

    if (t.processing) {
      Object.assign(row, { state: 'BUSY', why: 'mid-turn right now' });
      rows.push(row); continue;
    }
    if (!row.worktree || isMain) {
      Object.assign(row, { state: 'MAIN', why: 'hand-opened session in the main checkout' });
      rows.push(row); continue;
    }

    const a = audit.get(path.resolve(row.worktree));
    if (!a) {
      Object.assign(row, { state: 'UNKNOWN', why: 'worktree not in the audit — inspect by hand' });
      rows.push(row); continue;
    }
    row.branch = a.branch;
    row.verdict = a.verdict;
    row.dirty = a.dirty;

    if (a.dirty > 0) {
      Object.assign(row, { state: 'UNCOMMITTED', why: `${a.dirty} uncommitted file(s)` });
      rows.push(row); continue;
    }
    if (a.verdict === 'stranded' || a.verdict === 'partial') {
      Object.assign(row, { state: 'UNMERGED', why: `work is ${a.verdict} — not on ${BASE}` });
      rows.push(row); continue;
    }

    const sess = coord.sessions.find((s) => s.claude_pid === pid)
      || coord.sessions.find((s) => path.resolve(s.worktree || s.cwd || '') === path.resolve(row.worktree));
    const lock = sess && coord.locks.find((l) => l.owner === sess.id);
    if (lock) {
      Object.assign(row, { state: 'HOLDS-LOCK', why: `holds ${lock.resource} — mid git op` });
      rows.push(row); continue;
    }

    const announced = coord.broadcasts.some((b) =>
      ((sess && b.id === sess.id) || (b.cwd && path.resolve(b.cwd) === path.resolve(row.worktree)))
      && DONE_RE.test(b.text || ''));

    // Whose slice is this? Checked AFTER the done-ness evidence so the report
    // still tells you a foreign slice is finished — it just won't close it.
    const owners = loadOwners(REPO);
    const rec = owners[row.slice];
    const mine = ANY_OWNER || (rec && MY_TAB && rec.owner === MY_TAB);
    row.owner = rec ? rec.owner : '';

    if (announced && !mine) {
      Object.assign(row, { state: 'FOREIGN', why: rec
        ? `done, but spawned by another tab (${rec.owner}) — use --any-owner to close it`
        : 'done, but no spawn record — not this run\'s to close; use --any-owner' });
    } else if (announced) {
      Object.assign(row, { state: 'DONE', safe: true, why: `announced done, tree clean, work on ${BASE}` });
    } else if (ALL_MERGED && mine) {
      Object.assign(row, { state: 'DONE', safe: true, why: 'merged + clean + idle (--all-merged; never announced)' });
    } else {
      Object.assign(row, { state: 'PROBABLY-DONE', why: 'merged + clean + idle, but never announced — check the tab, or use --all-merged' });
    }
    rows.push(row);
  }
  return rows;
}

/* --------------------------------------------------------------------- close */

const CLOSE_AS = (id) => `
tell application "iTerm2"
  set target to missing value
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        if (id of s) is "${id}" then set target to s
      end repeat
    end repeat
  end repeat
  if target is not missing value then close target
end tell`;

async function closeRows(rows) {
  let ok = 0;
  for (const r of rows) {
    // SIGTERM first so Claude runs its SessionEnd hook and deregisters from the coordination
    // registry; killing the tab out from under it would strand its lock and its registry entry.
    if (r.pid) {
      try { process.kill(r.pid, 'SIGTERM'); } catch {}
      for (let i = 0; i < 20; i++) {
        await sleep(400);
        try { process.kill(r.pid, 0); } catch { break; }
      }
    }
    sh('/usr/bin/osascript', ['-e', CLOSE_AS(r.id)]);
    ok++;
    console.log(`  closed  w${r.window}t${r.tab}  ${r.slice || '(main)'}  [${r.state}]`);
  }
  return ok;
}

/* ---------------------------------------------------------------------- main */

const PAD = (s, n) => String(s ?? '').padEnd(n);

async function main() {
  if (process.env.TERM_PROGRAM !== 'iTerm.app' && !process.env.ITERM_SESSION_ID) {
    console.error('reap-claude-sessions: not running under iTerm2 — nothing to enumerate.');
    process.exit(1);
  }

  const rows = classify();
  if (JSON_OUT) { console.log(JSON.stringify(rows, null, 2)); return; }

  const safe = rows.filter((r) => r.safe);
  const keep = rows.filter((r) => !r.safe);

  console.log(`\n${rows.length} Claude tab(s) open    safe to close: ${safe.length}    keep: ${keep.length}\n`);
  console.log(`  ${PAD('TAB', 7)}${PAD('STATE', 15)}${PAD('SLICE', 34)}WHY`);
  for (const r of rows) {
    console.log(`  ${PAD(`w${r.window}t${r.tab}`, 7)}${PAD(r.state, 15)}${PAD(r.slice || '(main checkout)', 34)}${r.why}`);
  }
  console.log('');

  if (!CLOSE) {
    console.log(safe.length
      ? `Re-run with --close to close the ${safe.length} safe tab(s). Scrollback is lost.\n` +
        `Then run \`node worktree-audit.mjs --prune\` — an open tab blocks its own worktree's removal.`
      : 'Nothing safe to close right now.');
    return;
  }
  if (!safe.length) { console.log('Nothing safe to close.'); return; }
  if (DRY) {
    console.log('--dry-run: would close');
    for (const r of safe) console.log(`  w${r.window}t${r.tab}  ${r.slice || '(main)'}  [${r.state}]  pid=${r.pid || '-'}`);
    return;
  }
  console.log(`closing ${safe.length} tab(s):`);
  const n = await closeRows(safe);
  console.log(`\nclosed ${n}. What is still open is still in progress.`);
  console.log('Next: `node worktree-audit.mjs --prune` to reclaim the freed worktrees.');
}

main().catch((e) => { console.error(e.stack); process.exit(1); });
