#!/usr/bin/env node
/**
 * spawn-claude-sessions — start one fully-briefed Claude session per work slice, each in its own
 * git worktree: a background session by default (watched in Claude Code's agent view), or an
 * iTerm2 tab with --tabs.
 *
 * Works in any git repo: run it from inside the repo you want the slices to work on.
 *
 *   node spawn-claude-sessions.mjs --dir .claude/spawn-prompts
 *   node spawn-claude-sessions.mjs --spec slices.json --dry-run
 *   node spawn-claude-sessions.mjs --dir … --tabs        # one iTerm2 tab per slice
 *
 * BACKGROUND SESSIONS BY DEFAULT (2026-10-06). Each slice is a real Claude session in its own
 * worktree, started with `--bg` and watched in agent view; `--tabs` opens iTerm2 tabs instead, for
 * when you want to watch one live. Agent view lists every session working / waiting /
 * done in one place, where a run's tabs had to be read one by one. Each slice launches as
 * `claude --bg -w <slice> -n <slice> "<brief>"` run by execFile from the main checkout — an argv, no
 * shell, so none of the quoting below applies. The name refusal, one worktree at a time, the Owns:
 * check, the brief footer, the owner book, the startup check and the reap watcher are shared with
 * --tabs. The rest of this header is the --tabs path. Mechanics: ./lib/background-sessions.mjs.
 *
 * Setup:
 *   - The repo is resolved from the CALLER'S CWD (the main checkout of whatever repo
 *     that is, even from inside one of its worktrees), not hardcoded.
 *   - --skip-permissions passes `--dangerously-skip-permissions` to each session, so it runs every
 *     tool without asking; the slice's worktree is its isolation. Without it a background slice
 *     that stops on a permission prompt shows as waiting in agent view; a tab's profile may supply
 *     the flag itself.
 *   - With --tabs, the iTerm2 profile comes from --profile / $CLAUDE_SPAWN_PROFILE
 *     (default "Default"). If your profile does not already supply
 *     `--dangerously-skip-permissions`, pass --skip-permissions so sessions
 *     don't park silently on a permission prompt with nobody watching.
 *
 * ONE WINDOW PER RUN is the default (2026-10-01). Adding tabs to the
 * caller's window piled every run into one window — 25 tabs from three unrelated
 * runs, each title cut to "…s (claude)". Each spawn now opens its own window;
 * --same-window adds the tabs to the caller's window as before.
 *
 * ...and the tab that spawned the run follows it there, as the window's first tab
 * (2026-10-01: otherwise the orchestrator stayed behind in the old window), wearing
 * the run's colour, with the window named after the run. See followRun below. Every
 * slice is also told its orchestrator's address, so its done note wakes it — see
 * orchestratorAddress.
 *
 * TARGETING — the load-bearing detail. iTerm2's AppleScript `current window`
 * means FRONTMOST, not "the window this process runs in". With several sessions
 * open that reliably drops tabs into another window. We resolve the caller's own
 * window by matching the GUID half of $ITERM_SESSION_ID against every session
 * id, and only fall back to a NEW window when that lookup fails — never to
 * `current window`.
 *
 * ...and we hold that window BY ID, not by the loop variable. `repeat with w in
 * windows` binds a POSITIONAL specifier (`item k of windows`), which AppleScript
 * re-evaluates on every use. Each `create tab` raises its window to the front and
 * renumbers the list, so the specifier that meant "my window" on iteration 1
 * means a different window on iteration 2. Measured 2026-09-01 spawning five
 * slices from a window that happened to sit at index 2: slices 1/3/5 landed in
 * the caller's window and 2/4 landed in another window — perfect alternation,
 * because `item 2 of windows` flipped between the two on every tab creation.
 * `window id N` is stable across the reorder; the loop now captures `id of w`.
 *
 * ONE WORKTREE AT A TIME, made by the spawner, each slice's tab opening once its worktree is
 * ready; then a startup check — see makeWorktree and waitForSessions (2026-10-05: 26 tabs each
 * making its own worktree at once took ~10 min apiece, and 9 sessions never started).
 *
 * PROMPTS GO VIA FILES, never inline. A multi-line prompt threaded through
 * AppleScript string escaping -> zsh -c -> the shell is a quoting bug farm; a
 * file path is one token that survives all three layers.
 *
 * No iTerm2 badge marks a slice any more (2026-10-05: its watermark sat offset in the
 * top-right of the pane and couldn't be read). The strip above the prompt says which
 * slice a tab is and where it sits in its run ("3/17 wf-tables-2"), and the lead tab
 * says "orchestrator of 17" — a status-line mod (not included here) that reads the book
 * recordOwnership writes.
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, openSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { launchArgv, listBackground, ownerId, parseBackgrounded, agentIn } from './lib/background-sessions.mjs';

// The MAIN checkout, even when run from inside one of its worktrees (`--git-common-dir` is the
// main checkout's .git): the spawner makes each slice's worktree where `claude -w` looks for it.
function resolveRepo() {
  try {
    return path.resolve(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim(), '..');
  } catch {
    console.error('error: run this from inside the git repo the slices should work on');
    process.exit(1);
  }
}

const REPO = resolveRepo();
const CLAUDE_BIN = process.env.CLAUDE_BIN || `${process.env.HOME}/.local/bin/claude`;

// ---------------------------------------------------------------- args

function parseArgs(argv) {
  const a = {
    slices: [], dryRun: false, dir: null, spec: null, newWindow: true,
    profile: process.env.CLAUDE_SPAWN_PROFILE || 'Default',
    skipPermissions: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--dry-run') a.dryRun = true;
    else if (v === '--tabs') a.tabs = true;
    else if (v === '--new-window') { a.newWindow = true; a.tabsOnly = v; }
    else if (v === '--same-window') { a.newWindow = false; a.tabsOnly = v; }
    else if (v === '--skip-permissions') a.skipPermissions = true;
    else if (v === '--no-reap') a.noReap = true;
    else if (v === '--startup-wait') a.startupWait = Number(argv[++i]);
    else if (v === '--run') a.run = argv[++i];
    else if (v === '--profile') { a.profile = argv[++i]; a.tabsOnly = v; }
    else if (v === '--dir') a.dir = argv[++i];
    else if (v === '--spec') a.spec = argv[++i];
    else if (v === '--help' || v === '-h') a.help = true;
  }
  return a;
}

function usage() {
  console.log(`
spawn-claude-sessions — one Claude session per slice, each in its own worktree: a background
session by default (\`claude agents\` / agent view lists them), an iTerm2 tab each with --tabs

  --dir <path>          directory of prompt files; each <name>.md becomes slice <name>
  --spec <path>         JSON: { "slices": [ { "name": "...", "prompt"|"promptFile": "..." } ] }
  --skip-permissions    pass --dangerously-skip-permissions to each session (an unattended
                        session stopped on a permission prompt waits until someone answers it)
  --dry-run             print the plan and the exact launch lines; spawn nothing
  --tabs                open the slices as iTerm2 tabs instead (when you want to watch one live)
    --profile <name>      iTerm2 profile to spawn with (default $CLAUDE_SPAWN_PROFILE or "Default")
    --new-window          the tabs go in a NEW iTerm2 window (the default with --tabs — one
                          window per run)
    --same-window         add the tabs to the caller's window instead
  --run <name>          the run's name (default: the --dir folder's name) — colours its tabs
                        and groups its slices in \`board\` and the strip above the prompt
  --no-reap             do not start the automatic reap (a detached watcher that closes each
                        slice — \`claude rm\`, or its tab — and removes its worktree once it is
                        merged, clean and quiet)
  --startup-wait <s>    how long to wait for every slice's session to start before reporting the
                        ones that didn't (default ${DEFAULT_STARTUP_WAIT_S}; 0 skips the check)

Worktrees are made one at a time, each slice starting once its worktree is ready. The run
stops before making any if a slice's name is already taken (its worktree exists, or its branch
holds unmerged commits), or if two briefs' Owns: lists overlap.

Env: CLAUDE_BIN overrides the claude binary path (default ${CLAUDE_BIN}).
Run from inside the target repo — the repo is resolved from your cwd.
`);
}

// ---------------------------------------------------------------- slices

function loadSlices(args) {
  if (args.spec) {
    const spec = JSON.parse(readFileSync(args.spec, 'utf8'));
    if (!Array.isArray(spec.slices) || !spec.slices.length) {
      throw new Error(`${args.spec}: expected a non-empty "slices" array`);
    }
    return spec.slices.map((s) => {
      if (!s.name) throw new Error('every slice needs a "name"');
      if (!s.prompt && !s.promptFile) throw new Error(`slice ${s.name}: needs "prompt" or "promptFile"`);
      return { name: s.name, prompt: s.prompt, promptFile: s.promptFile };
    });
  }
  if (args.dir) {
    const files = readdirSync(args.dir).filter((f) => /\.(md|txt)$/.test(f)).sort();
    if (!files.length) throw new Error(`${args.dir}: no .md/.txt prompt files found`);
    return files.map((f) => ({
      name: path.basename(f).replace(/\.(md|txt)$/, ''),
      promptFile: path.resolve(args.dir, f),
    }));
  }
  throw new Error('need --dir or --spec (see --help)');
}

/** A slice name becomes a git branch and a directory — keep it boring. */
function assertSaneName(name) {
  if (!/^[a-z0-9][a-z0-9._-]{0,48}$/i.test(name)) {
    throw new Error(`slice name ${JSON.stringify(name)} must be alphanumeric with . _ - (max 49 chars)`);
  }
}

/** Inline prompts get spilled to disk so the spawn command stays one token. */
function materializePrompts(slices) {
  const dir = path.join(REPO, '.claude', 'spawn-prompts');
  mkdirSync(dir, { recursive: true });
  return slices.map((s) => {
    assertSaneName(s.name);
    let file = s.promptFile ? path.resolve(s.promptFile) : null;
    if (!file) {
      file = path.join(dir, `${s.name}.md`);
      writeFileSync(file, s.prompt, 'utf8');
    }
    if (!existsSync(file)) throw new Error(`slice ${s.name}: prompt file not found: ${file}`);
    return { ...s, promptFile: file };
  });
}

// THE SLICE WAKES ITS ORCHESTRATOR (2026-10-01). A note on the shared board lands on a
// peer's NEXT turn, and an idle orchestrator has none — so a slice's "done" sat unread until the
// user went into the slice and told it to report back. A SendMessage does wake it (measured: an
// idle orchestrator's turn began 3 ms after one arrived). So the spawner finds the Claude session
// it runs under (up the parent-pid chain to a pid with a <config>/sessions/<pid>.json) and gives
// every slice that session's messaging address. Briefs are never edited: each slice launches from
// a copy with the footer, kept under ~/.claude/logs (another repo's .claude/ may not be ignored).
/** Every Claude Code settings folder on this machine — each keeps its own sessions/<pid>.json. */
function configRoots() {
  const roots = [process.env.CLAUDE_CONFIG_DIR, path.join(os.homedir(), '.claude')];
  try {
    for (const d of readdirSync(path.join(os.homedir(), '.claude-profiles'))) roots.push(path.join(os.homedir(), '.claude-profiles', d));
  } catch { /* no account profiles */ }
  return [...new Set(roots.filter(Boolean).map((r) => path.resolve(r)))];
}

/** The Claude session this process runs under (its sessions/<pid>.json), or null. */
function sessionAbove() {
  let pid = process.ppid;
  for (let hop = 0; pid > 1 && hop < 12; hop++) {
    for (const root of configRoots()) {
      try {
        const rec = JSON.parse(readFileSync(path.join(root, 'sessions', `${pid}.json`), 'utf8'));
        if (rec && (rec.messagingSocketPath || rec.sessionId)) return rec;
      } catch { /* not a Claude session */ }
    }
    try { pid = Number(execFileSync('/bin/ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' }).trim()); } catch { break; }
  }
  return null;
}

const ABOVE = sessionAbove();
const orchestratorAddress = () => (ABOVE?.messagingSocketPath ? `uds:${ABOVE.messagingSocketPath}` : null);

// ONE OWNER PER SHARED FILE (2026-10-05). A brief may carry an `Owns:` list: one `- path` per line,
// or inline; a folder ends in `/`. Two slices may not claim overlapping paths, and every slice is
// told who owns what, so it asks the owner instead of editing. Measured on a 26-slice run: only 8
// of 199 files were edited by two slices, but all 8 were unowned shared files, and most of the
// run's coordination chatter was about them.
const OWNS_LINE = /^\s*\**owns\**\s*:\s*\**\s*(.*)$/i;
const normalizePath = (p) => String(p).trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '').replace(/\/{2,}/g, '/');
// A path is path characters only, with a / or a file extension; a note after it (" — ", " - ",
// "(", ";") is dropped, so "Owns: nothing (reads only)" owns nothing.
const looksLikePath = (t) => /^[\w@.\/-]+$/.test(t) && (t.includes('/') || /\.\w+$/.test(t));
const pathsIn = (piece) => piece.replace(/[`*]/g, '').split(/\s+[—–-]\s|\(|;/)[0].split(/\s+/).filter(looksLikePath);
function parseOwns(brief) {
  const lines = String(brief || '').split('\n');
  const at = lines.findIndex((l) => OWNS_LINE.test(l));
  if (at < 0) return [];
  const out = lines[at].match(OWNS_LINE)[1].split(',').flatMap(pathsIn);
  for (const l of lines.slice(at + 1)) {
    const m = l.match(/^\s*[-*]\s+(.*)$/);
    if (!m) break;
    out.push(...pathsIn(m[1]).slice(0, 1));
  }
  return [...new Set(out.map(normalizePath).filter(Boolean))];
}
const covers = (owned, rel) => {
  const o = normalizePath(owned);
  const r = normalizePath(rel);
  return o === r || (o.endsWith('/') && (r.startsWith(o) || `${r}/` === o));
};
function ownershipClashes(slices) {
  const out = [];
  for (let i = 0; i < slices.length; i++) {
    for (let j = i + 1; j < slices.length; j++) {
      for (const a of slices[i].owns) for (const b of slices[j].owns) {
        if (covers(a, b) || covers(b, a)) out.push(`${a} (${slices[i].name}) overlaps ${b} (${slices[j].name})`);
      }
    }
  }
  return out;
}

// Every slice launches from a copy of its brief with a footer: the orchestrator's address, who owns
// what in this run, and the testing split (the slice tests what it changed; the orchestrator runs
// the project's full checks once per merge batch, so 20 slices don't run the same suites at once).
function footerFor(slice, slices, address) {
  const parts = [];
  if (address) {
    parts.push(`Your orchestrator, the session that spawned this run, is at \`${address}\`. When you finish (pushed and verified), or stop on a question only the user can answer, send it a short note with SendMessage (to: that address; run ToolSearch \`select:SendMessage\` first if the tool is not loaded): what you pushed and where, or the question. The message wakes it even when it is idle. If the address no longer answers, carry on as the brief says.`);
  }
  const theirs = slices.filter((o) => o.name !== slice.name).flatMap((o) => o.owns.map((p) => `- ${p} → ${o.name}`));
  if (slice.owns.length) parts.push(`You own these in this run, so other slices send you the changes they need here. Fold each one in and tell the asker when it's pushed:\n${slice.owns.map((p) => `- ${p}`).join('\n')}`);
  if (theirs.length) parts.push(`Other slices of this run own these. Don't edit them. Send the owner the change you need with SendMessage (\`to:\` its slice name), then carry on with the rest:\n${theirs.join('\n')}`);
  parts.push('Tests: run the tests for what you changed. Leave the project\'s full type-check and full test runs to the orchestrator, which runs them once per merge batch after it merges you.');
  return `\n\n---\n${parts.join('\n\n')}\n`;
}

function withFooter(slices, address) {
  const dir = path.join(os.homedir(), '.claude', 'logs', 'spawn-briefs', path.basename(REPO));
  mkdirSync(dir, { recursive: true });
  return slices.map((s) => {
    const launchFile = path.join(dir, `${s.name}.md`);
    writeFileSync(launchFile, readFileSync(s.promptFile, 'utf8').trimEnd() + footerFor(s, slices, address), 'utf8');
    return { ...s, launchFile };
  });
}

// ---------------------------------------------------------------- worktrees

// ONE WORKTREE AT A TIME (2026-10-05). Every tab used to run `claude -w <slice>` at the same
// moment, so a run made all its worktrees at once. One run started 26 `git worktree add` runs of
// 21,214 files each, every one with Claude Code's checkout.workers=16. We measured 68 checkout
// workers running together, load 76 on 18 cores, and ~10 min per checkout behind a blank tab. Nine
// claude processes exited mid-checkout, so nine tabs closed with no message while the orchestrator
// counted 26 running. Now the spawner makes each worktree itself, one after another, and opens each
// slice's tab once its worktree is ready. `claude -w` finds it there ("Resuming existing worktree
// at:" — it reuses any worktree with its name). Branch, path and base match what Claude Code would
// make: worktree-<slice> at .claude/worktrees/<slice>, from origin's default branch, fetched once.
// Like Claude Code, the add runs with core.hooksPath=/dev/null.
//
// ...and a name that's already taken stops the run before anything is made. Because `claude -w`
// RESUMES a worktree with its name, a slice once started inside another session's worktree: an
// approved, unpushed commit and a staged merge. A slice that hadn't noticed could have committed
// over both. A leftover branch is reused only when it holds nothing beyond the base; `-B` would
// reset it, as Claude Code's own add does.
const WORKTREES = path.join(REPO, '.claude', 'worktrees');
const git = (...args) => execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function worktreeBase() {
  try { return git('symbolic-ref', '--short', 'refs/remotes/origin/HEAD'); } catch { return 'HEAD'; }
}

/** Why each slice's name can't be used. Empty = every name is free. */
function takenNames(slices, base) {
  const problems = [];
  for (const s of slices) {
    if (existsSync(path.join(WORKTREES, s.name))) {
      problems.push(`${s.name}: .claude/worktrees/${s.name} already exists. Another session may be working in it, and \`claude -w\` would start inside it`);
      continue;
    }
    let ahead = 0;
    try { ahead = Number(git('rev-list', '--count', `${base}..refs/heads/worktree-${s.name}`)); } catch { /* no such branch */ }
    if (ahead) problems.push(`${s.name}: branch worktree-${s.name} holds ${ahead} commit(s) not on ${base}; making the worktree would reset it`);
  }
  return problems;
}

// Claude Code copies .worktreeinclude's gitignored files (typically .env) only into a worktree IT
// creates, so do it here.
function copyIncluded(dir) {
  let lines = [];
  try { lines = readFileSync(path.join(REPO, '.worktreeinclude'), 'utf8').split('\n'); } catch { return; }
  for (const line of lines) {
    const rel = line.trim().replace(/^\//, '');
    if (!rel || rel.startsWith('#')) continue;
    if (/[*?[\]!]/.test(rel)) { console.warn(`  [spawn] .worktreeinclude pattern ${rel} is a glob — not copied`); continue; }
    if (!existsSync(path.join(REPO, rel))) continue;
    try { git('check-ignore', '-q', rel); } catch { continue; } // tracked files arrive with the checkout
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    copyFileSync(path.join(REPO, rel), path.join(dir, rel));
  }
}

function fetchBase(base) {
  if (!base.includes('/')) return;
  const [remote, ...branch] = base.split('/');
  try { git('fetch', '--quiet', remote, branch.join('/')); } catch (err) {
    console.warn(`  [spawn] could not fetch ${base} (${String(err.stderr || err.message).trim()}) — using the local copy`);
  }
}

// The main loop opens each slice's tab as soon as its worktree is ready, rather than after all of
// them. One checkout took 74 s while 26 sessions ran their checks (load 104, 2026-10-05), so
// making a whole run's worktrees first would hold the first tab back for half an hour.
/** Make one slice's worktree. Returns null when it's ready, else why it isn't. */
// A slice whose tab never opened leaves nothing behind: no booking, no empty worktree holding its
// name. One that opened but never started is the orchestrator's to count out or relaunch.
function unmake(s) {
  recordOwnership([s], { forget: true });
  try {
    git('worktree', 'remove', '--force', path.join(WORKTREES, s.name));
    git('branch', '-D', `worktree-${s.name}`);
  } catch (err) {
    console.warn(`  ${s.name.padEnd(28)} its empty worktree is still there (${String(err.stderr || err.message).trim().split('\n').pop()}); remove it before relaunching`);
  }
}

function makeWorktree(s, base) {
  const dir = path.join(WORKTREES, s.name);
  const t0 = Date.now();
  try {
    git('-c', 'core.hooksPath=/dev/null', 'worktree', 'add', '--quiet', '--no-track', '-B', `worktree-${s.name}`, dir, base);
    copyIncluded(dir);
    console.log(`  ${s.name.padEnd(28)} worktree ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return null;
  } catch (err) {
    return `no worktree: ${String(err.stderr || err.message).trim().split('\n').pop()}`;
  }
}

// THE STARTUP CHECK (2026-10-05). "spawned N" only says iTerm opened N tabs. A slice whose
// claude exits closes its own tab, and nothing reports it: one orchestrator reported 26
// sessions working while 9 had never started. So the spawner waits for each slice to register a
// live Claude session (a sessions/<pid>.json whose pid is alive and whose cwd is the slice's
// worktree) and names any that never do.
const DEFAULT_STARTUP_WAIT_S = 240;

function liveSessionDirs() {
  const dirs = new Set();
  for (const root of configRoots()) {
    let files = [];
    try { files = readdirSync(path.join(root, 'sessions')).filter((f) => /^\d+\.json$/.test(f)); } catch { continue; }
    for (const f of files) {
      try {
        const { pid, cwd } = JSON.parse(readFileSync(path.join(root, 'sessions', f), 'utf8'));
        process.kill(pid, 0); // throws once the process is gone
        dirs.add(path.resolve(cwd));
      } catch { /* stale or unreadable */ }
    }
  }
  return dirs;
}

// A background slice is up once `claude agents --json` (what agent view shows) lists a live session
// with its recorded id or in its worktree. A list that won't come back counts nobody up.
function backgroundUp(slices) {
  let agents = [];
  try { agents = listBackground(CLAUDE_BIN); } catch { return new Set(); }
  return new Set(slices.filter((s) => agentIn(agents, path.join(WORKTREES, s.name), s.bg)).map((s) => s.name));
}

async function waitForSessions(slices, waitS, { background = false } = {}) {
  const t0 = Date.now();
  const pending = new Set(slices.map((s) => s.name));
  while (pending.size) {
    const live = background ? null : liveSessionDirs();
    const up = background ? backgroundUp(slices) : new Set(slices.map((s) => s.name).filter((n) => live.has(path.join(WORKTREES, n))));
    for (const name of [...pending]) {
      if (up.has(name)) {
        pending.delete(name);
        console.log(`  ${name.padEnd(28)} session up after ${Math.round((Date.now() - t0) / 1000)}s`);
      }
    }
    if (!pending.size || Date.now() - t0 > waitS * 1000) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return [...pending];
}

// ---------------------------------------------------------------- background

/** One background slice's launch: the claude binary, its argv, and the brief's text as one argument. */
function backgroundLaunch(slice, args) {
  const file = slice.launchFile || slice.promptFile;
  return { bin: CLAUDE_BIN, file, argv: launchArgv({ name: slice.name, prompt: readFileSync(file, 'utf8'), skipPermissions: args.skipPermissions }) };
}

// From the main checkout, like a tab's `cd ${REPO}`: `-w <slice>` then finds the worktree the spawner
// just made and enters it. Returns the session's id (what `claude attach`, `logs`, `stop`, `rm` take).
function launchBackground(slice, args) {
  const { bin, argv } = backgroundLaunch(slice, args);
  const out = execFileSync(bin, argv, {
    cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000,
    env: { ...process.env, PATH: `${path.join(os.homedir(), 'bin')}:${process.env.PATH || ''}` },
  });
  const started = parseBackgrounded(out);
  if (!started) throw new Error(`claude --bg printed no session id: ${out.trim().split('\n')[0] || '(nothing)'}`);
  return started.id;
}

// ---------------------------------------------------------------- applescript

/** AppleScript string literals escape backslash and double-quote, nothing else. */
const asStr = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/**
 * Wrap in `zsh -lc '...'`. Single-quoting means the only character needing care
 * inside is a literal single quote, closed-and-reopened the standard way.
 */
function zshWrap(inner) {
  const escaped = inner.replace(/'/g, `'\\''`);
  return `/bin/zsh -lc '${escaped}'`;
}

// One tab colour per run (2026-10-01), so a run's tabs read as a group even when several runs
// share a window. Nothing Claude does repaints it. Picked from the run name, so a later phase of
// the same run gets the same colour. The strip's run chip wears it too: keep the palette and
// hash in step with runColour in lib/session-info.mjs (published under ../iterm-panels/).
const RUN_COLOURS = [
  [52, 101, 164], [78, 154, 6], [196, 160, 0], [117, 80, 123],
  [206, 92, 0], [6, 152, 154], [164, 0, 0], [143, 89, 2],
];
function runColour(run) {
  let h = 0;
  for (const ch of String(run || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return RUN_COLOURS[h % RUN_COLOURS.length];
}
function tabColourCmd(run) {
  const [r, g, b] = runColour(run);
  return `printf '\\033]6;1;bg;red;brightness;${r}\\a\\033]6;1;bg;green;brightness;${g}\\a\\033]6;1;bg;blue;brightness;${b}\\a'`;
}

/**
 * The run's name: --run, else the prompt folder's name less a phase suffix (date-ranges-p1 and
 * -p2 are one run). A flat spawn-prompts/ folder says nothing, so then the first slice's name.
 */
function runName(args, slices) {
  const fromDir = (args.dir ? path.basename(path.resolve(args.dir)) : args.spec ? path.basename(args.spec).replace(/\.json$/, '') : '')
    .replace(/-p\d+$/, '');
  const name = args.run || (fromDir && fromDir !== 'spawn-prompts' ? fromDir : slices[0].name);
  return String(name).replace(/[^A-Za-z0-9._-]/g, '-');
}

// ~/bin first on PATH (2026-09-24): on a new Apple-silicon Mac a
// login shell put an Intel-only /usr/local/bin/git first, `claude -w` died with
// "bad CPU type in executable" and the tab closed with no message (2026-09-18).
// That binary is gone now; ~/bin/git -> /usr/bin/git keeps it from mattering.
function buildCommand(slice, args) {
  const permFlag = args.skipPermissions ? ' --dangerously-skip-permissions' : '';
  const inner =
    `export PATH="$HOME/bin:$PATH" && ` +
    `cd ${REPO} && ` +
    `${tabColourCmd(slice.run)} && ` +
    `${CLAUDE_BIN} -w ${slice.name} -n ${slice.name}${permFlag} "$(cat '${slice.launchFile || slice.promptFile}')"`;
  return zshWrap(inner);
}

/**
 * One tab per call, because each tab opens the moment its worktree is ready (see makeWorktree).
 * The first call finds or makes the run's window and returns "<window id>|<run session>"; every
 * later call is handed that window id and just adds a tab to it.
 */
function tabScript(slice, args, windowId) {
  const create = `create tab with profile ${asStr(args.profile)} command ${asStr(buildCommand(slice, args))}`;
  if (windowId) {
    return ['tell application "iTerm2"', `  tell window id ${windowId}`, `    ${create}`, '  end tell', 'end tell'].join('\n');
  }
  const guid = (process.env.ITERM_SESSION_ID || '').split(':').pop() || '';
  const lines = [];
  lines.push('tell application "iTerm2"');
  if (!args.newWindow && guid) {
    lines.push(`  set myGuid to ${asStr(guid)}`);
    lines.push('  set targetWindowId to missing value');
    lines.push('  repeat with w in windows');
    lines.push('    repeat with t in tabs of w');
    lines.push('      repeat with s in sessions of t');
    // `id of w`, NOT `w` — see TARGETING above. `w` is positional and goes stale
    // the moment the first `create tab` reorders the window list.
    lines.push('        if (id of s) is myGuid then set targetWindowId to (id of w)');
    lines.push('      end repeat');
    lines.push('    end repeat');
    lines.push('  end repeat');
  } else {
    lines.push('  set targetWindowId to missing value');
  }
  lines.push('  if targetWindowId is missing value then');
  // No caller window found (or --new-window): make ONE window for the first
  // slice, then hang the rest off it as tabs. Never touch `current window`.
  lines.push(`    set targetWindowId to (id of (create window with profile ${asStr(args.profile)} command ${asStr(buildCommand(slice, args))}))`);
  // The new window's first session — followRun finds the run's window by it.
  lines.push('    set runSession to (id of session 1 of tab 1 of window id targetWindowId)');
  lines.push('  else');
  lines.push('    set runSession to ""');
  lines.push('    tell window id targetWindowId');
  lines.push(`      ${create}`);
  lines.push('    end tell');
  lines.push('  end if');
  lines.push('  return (targetWindowId as text) & "|" & runSession');
  lines.push('end tell');
  return lines.join('\n');
}

// iTerm2 under load sometimes refuses the window walk outright: "every window doesn't understand
// the count message" (-1708). On 2026-10-05 at load 105-136, the first slice of two test runs
// failed three tries spread over 6 s, while the second slice's identical script went through a
// minute later. So a tab gets five tries over ~30 s before its slice is reported NOT STARTED.
async function openTab(script) {
  for (let attempt = 1; ; attempt++) {
    try {
      return execFileSync('/usr/bin/osascript', ['-'], { input: script, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch (err) {
      if (attempt >= 5) throw err;
      console.warn(`  [spawn] iTerm2 refused the tab (try ${attempt} of 5): ${String(err.stderr || err.message).trim().split('\n').pop()}`);
      await new Promise((r) => setTimeout(r, 2000 * 2 ** (attempt - 1)));
    }
  }
}

// THE ORCHESTRATOR FOLLOWS ITS RUN (2026-10-01). One window per run left the spawning tab behind
// in the old window, so supervising a run meant hunting for its orchestrator. After the spawn, the
// caller's tab moves into the run's window as its first tab and comes to the front. AppleScript
// can't move a tab between windows; iTerm2's Python API can (Window.async_set_tabs), run through
// `uv --with iterm2` so nothing is installed globally. Session GUIDs are the same in both APIs, and
// a moved tab keeps its process, tty and GUID — the reaper's ownership check and its tty lookup
// don't notice. A window the move empties closes itself. Best-effort: a spawn never fails over it.
// The same pass names the window after the run (the Window menu, ⌘` and Mission Control show runs
// by name, not by whichever tab is active — like Edit Window Title, so no tab rewrites it), and
// gives the orchestrator's tab the run's colour — session-local, the profile is untouched — so the
// lead tab reads as part of its run. A lead that starts a second run while its first is still open
// leaves the first run's window without it (2026-10-05: wf-tables-2's window had no orchestrator
// and nobody could tell where it was), so that window is retitled "<run> · orchestrator in <new run>".
const FOLLOW_PY = `
import sys, iterm2
caller, peer, run, r, g, b = sys.argv[1:7]
problem = None
async def main(connection):
    global problem
    app = await iterm2.async_get_app(connection)
    them = app.get_session_by_id(peer)
    target = them and app.get_window_for_tab(them.tab.tab_id)
    if target is None:
        problem = "run window not found"
        return
    await target.async_set_title(run)
    me = app.get_session_by_id(caller) if caller else None
    if me is None:
        problem = "spawning tab not found"
        return
    if all(t.tab_id != me.tab.tab_id for t in target.tabs):
        home = app.get_window_for_tab(me.tab.tab_id)
        left = home and len(home.tabs) > 1 and await home.async_get_variable("titleOverride")
        if left:
            await home.async_set_title(left.split(" · ")[0] + " · orchestrator in " + run)
        await target.async_set_tabs([me.tab] + target.tabs)
    mark = iterm2.LocalWriteOnlyProfile()
    mark.set_tab_color(iterm2.Color(int(r), int(g), int(b)))
    mark.set_use_tab_color(True)
    await me.async_set_profile_properties(mark)
    await me.async_activate(select_tab=True, order_window_front=True)
iterm2.run_until_complete(main)
if problem: sys.exit(problem)
`;

function followRun(callerGuid, runGuid, run) {
  const argv = ['-', callerGuid || '', runGuid, run, ...runColour(run).map(String)];
  for (const [bin, args] of [['uv', ['run', '--quiet', '--with', 'iterm2', 'python', ...argv]], ['python3', argv]]) {
    const r = spawnSync(bin, args, { input: FOLLOW_PY, encoding: 'utf8', timeout: 60_000 });
    if (r.error?.code === 'ENOENT') continue;
    if (r.status === 0) return null;
    return (r.stderr || r.stdout || String(r.error || 'failed')).trim().split('\n').pop();
  }
  return 'neither uv nor python3 is installed — `brew install uv`';
}

// ---------------------------------------------------------------- main

// WHO SPAWNED WHAT — written so any reaper/cleanup tooling can tell this run's
// slices from another operator's. Closing someone else's finished tab loses
// their scrollback and is not yours to close.
const OWNERS_FILE = path.join(REPO, '.claude', 'worktrees', '.spawn-owners.json');

// The run's owner: the spawning iTerm2 tab, else the Claude session above this process
// (`claude:<session id>` — a background orchestrator has no tab), else 'unknown'.
const OWNER = ownerId({ itermSessionId: process.env.ITERM_SESSION_ID, claudeSessionId: ABOVE?.sessionId || process.env.CLAUDE_CODE_SESSION_ID });

function recordOwnership(slices, { forget = false } = {}) {
  let book = {};
  try { book = JSON.parse(readFileSync(OWNERS_FILE, 'utf8')) || {}; } catch { /* first run */ }
  const at = new Date().toISOString();
  // run + promptFile feed `board`, `brief` and the strip above the prompt (lib/session-info.mjs,
  // published under ../iterm-panels/).
  // `bg` is a background slice's session id: the reaper finds it by that, and `claude rm` takes it.
  for (const s of slices) {
    if (forget) delete book[s.name];
    else book[s.name] = { owner: OWNER, at: s.bg && book[s.name]?.at ? book[s.name].at : at, run: s.run, promptFile: s.promptFile, ...(s.owns?.length ? { owns: s.owns } : {}), ...(s.bg ? { bg: s.bg } : {}) };
  }
  try {
    mkdirSync(path.dirname(OWNERS_FILE), { recursive: true });
    writeFileSync(OWNERS_FILE, JSON.stringify(book, null, 2));
  } catch (err) {
    // Never fail a spawn over bookkeeping.
    console.warn(`[spawn] could not record slice ownership: ${err.message}`);
  }
}

function mergeBackHint() {
  // Prefer the project's own audit script when it has one.
  try {
    const pkg = JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf8'));
    if (pkg.scripts && pkg.scripts['worktrees:audit']) return 'npm run worktrees:audit';
  } catch { /* not a node project */ }
  return 'git branch --no-merged   # every worktree-<slice> branch listed still holds unmerged work';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();
  const background = !args.tabs;
  if (background && args.tabsOnly) {
    console.error(`NOTHING SPAWNED — ${args.tabsOnly} arranges iTerm2 tabs: add --tabs`);
    process.exit(1);
  }

  let slices;
  try {
    slices = loadSlices(args);
    slices.forEach((s) => assertSaneName(s.name));
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
  // Before anything is written: a taken name's prompt and launch copy may belong to a live slice.
  const base = worktreeBase();
  const taken = takenNames(slices, base);
  if (taken.length) {
    console.error(`NOTHING SPAWNED — ${taken.length} slice name(s) already taken. Rename the prompt file(s) and rerun:`);
    for (const t of taken) console.error(`  ${t}`);
    process.exit(1);
  }
  // A folder named without its trailing / would own nothing; it gets the / back, judged on the base.
  const isDir = (p) => { try { return git('cat-file', '-t', `${base}:${p}`) === 'tree'; } catch { return false; } };
  slices = slices.map((s) => ({
    ...s,
    owns: parseOwns(s.prompt ?? (s.promptFile && existsSync(s.promptFile) ? readFileSync(s.promptFile, 'utf8') : ''))
      .map((p) => (!p.endsWith('/') && isDir(p) ? `${p}/` : p)),
  }));
  const clashes = ownershipClashes(slices);
  if (clashes.length) {
    console.error(`NOTHING SPAWNED — ${clashes.length} ownership clash(es). Give each path one owner and rerun:`);
    for (const c of clashes) console.error(`  ${c}`);
    process.exit(1);
  }
  try {
    slices = materializePrompts(slices);
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
  const run = runName(args, slices);
  slices = slices.map((s) => ({ ...s, run }));
  const orchestrator = orchestratorAddress();
  try {
    slices = withFooter(slices, orchestrator);
  } catch (err) {
    console.warn(`[spawn] could not write the briefs' launch copies (orchestrator, ownership, testing footer): ${err.message}`);
  }

  const guid = (process.env.ITERM_SESSION_ID || '').split(':').pop() || '';
  const where = background ? 'background sessions (agent view)' : args.newWindow || !guid ? 'a NEW iTerm2 window' : "tabs in the caller's window";
  console.log(`spawning ${slices.length} session(s) of run ${run} as ${where} (repo: ${REPO}${background ? '' : `, profile: ${args.profile}`})\n`);
  for (const s of slices) {
    console.log(`  ${s.name.padEnd(28)} worktree=${s.name}  prompt=${path.relative(REPO, s.promptFile)}`);
    if (s.owns.length) console.log(`  ${''.padEnd(28)} owns ${s.owns.join(', ')}`);
  }
  console.log(orchestrator
    ? `\norchestrator ${orchestrator} — every brief ends with it, so a slice's done note wakes this session`
    : '\nno Claude session above this spawner — slices will not message an orchestrator');
  console.log(`owner ${OWNER} — recorded in .claude/worktrees/.spawn-owners.json`);

  if (args.dryRun && background) {
    console.log(`\n--dry-run: every name is free; each worktree would be made from ${base}, one at a time, its session starting once it's ready`);
    console.log(`each launch is run from ${REPO} by execFile — an argv, no shell; the last argument is the brief's text\n`);
    for (const s of slices) {
      const { bin, file, argv } = backgroundLaunch(s, args);
      const shown = [...argv.slice(0, -1), `<text of ${file}, ${Buffer.byteLength(argv[argv.length - 1])} bytes>`];
      console.log(`  ${JSON.stringify([bin, ...shown])}\n`);
    }
    return;
  }
  if (args.dryRun) {
    console.log(`\n--dry-run: every name is free; each worktree would be made from ${base}, one at a time, its tab opening once it's ready\n`);
    for (const s of slices) console.log(`  ${buildCommand(s, args)}\n`);
    console.log('--- applescript: the first tab ---');
    console.log(tabScript(slices[0], args, null));
    if (slices[1]) {
      console.log('--- applescript: each later tab ---');
      console.log(tabScript(slices[1], args, '<window id>'));
    }
    return;
  }

  console.log(`\nmaking each worktree from ${base}, one at a time; each ${background ? 'session starts' : 'tab opens'} once its worktree is ready`);
  fetchBase(base);
  const opened = [];
  const failed = [];
  let windowId = null;
  for (const s of slices) {
    const noWorktree = makeWorktree(s, base);
    if (noWorktree) {
      console.error(`  ${s.name.padEnd(28)} NOT STARTED: ${noWorktree}`);
      failed.push({ name: s.name, why: noWorktree });
      continue;
    }
    recordOwnership([s]); // booked before its session starts
    if (background) {
      try {
        const started = { ...s, bg: launchBackground(s, args) };
        recordOwnership([started]);
        opened.push(started);
        console.log(`  ${s.name.padEnd(28)} started in the background · ${started.bg}`);
      } catch (err) {
        const why = `session did not start: ${String(err.stderr || err.message).trim().split('\n').pop()}`;
        console.error(`  ${s.name.padEnd(28)} NOT STARTED: ${why}`);
        failed.push({ name: s.name, why });
        unmake(s);
        // A repo Claude Code hasn't been trusted in refuses every background session (2026-10-06:
        // "Workspace not trusted. Run `claude` in <repo> once and accept the trust prompt"), so the
        // rest would fail the same way — stop before making their worktrees.
        if (/not trusted/i.test(why)) {
          for (const rest of slices.slice(slices.indexOf(s) + 1)) failed.push({ name: rest.name, why: 'not started — the repo is not trusted yet (above)' });
          break;
        }
      }
      continue;
    }
    try {
      const out = await openTab(tabScript(s, args, windowId));
      opened.push(s);
      if (!windowId) {
        const [id, runSession] = out.split('|');
        if (!/^\d+$/.test(id)) throw new Error(`iTerm2 returned no window id (${out})`);
        windowId = id;
        if (runSession) {
          const problem = followRun(guid, runSession, run);
          console.log(problem
            ? `  this tab stays in its own window (${problem})`
            : `  this tab moved into window "${run}" as its first tab, in the run's colour; the strip above its prompt names it the run's orchestrator`);
        }
      }
    } catch (err) {
      const why = `tab did not open: ${String(err.stderr || err.message).trim().split('\n').pop()}`;
      console.error(`  ${s.name.padEnd(28)} NOT STARTED: ${why}`);
      failed.push({ name: s.name, why });
      if (!opened.includes(s)) unmake(s);
    }
  }
  if (!opened.length) {
    console.error('\nNOTHING SPAWNED');
    process.exit(1);
  }
  console.log(`\n${background ? 'started' : 'opened'} ${opened.length} ${background ? 'background session' : 'tab'}(s)`);

  // Before the startup wait, so a caller that gives up on the wait still gets its reaper.
  const reapLog = args.noReap ? null : startReaper(opened);

  const waitS = Number.isFinite(args.startupWait) ? args.startupWait : DEFAULT_STARTUP_WAIT_S;
  let notStarted = [];
  if (waitS > 0) {
    console.log(`\nwaiting up to ${waitS}s for each session to start`);
    notStarted = await waitForSessions(opened, waitS, { background });
  }
  const gone = background
    ? (n) => `${n} (not in \`claude agents\` after ${waitS}s — \`claude logs ${opened.find((o) => o.name === n)?.bg}\` says why)`
    : (n) => `${n} (no session after ${waitS}s; its tab may have closed)`;
  const missing = [...failed.map((f) => `${f.name} (${f.why})`), ...notStarted.map(gone)];
  console.log(missing.length
    ? `\nNOT STARTED — ${missing.length} of ${slices.length} slice(s). Count them out of the run, or relaunch them:\n${missing.map((m) => `  ${m}`).join('\n')}`
    : waitS > 0 ? `\nall ${opened.length} session(s) started` : `\nstartup check skipped (--startup-wait 0)`);

  if (background) {
    console.log(`
Watch them in agent view (\`claude agents\`): working, waiting on a question, or done, in one list.
Open one in a terminal with \`claude attach <id>\`; \`claude logs <id>\` prints its recent output.
${opened.map((s) => `  ${s.name.padEnd(28)} claude attach ${s.bg}`).join('\n')}`);
  }
  console.log(`
Each session works in its own worktree at .claude/worktrees/<slice>.
${reapLog
    ? `Auto-reap is on: each slice ${background ? 'is removed with `claude rm` (its worktree with it)' : "'s tab closes and its worktree is removed"} once its branch is merged
into the integration branch, its tree is clean, it is not mid-turn, and nothing has changed in it
for 10 minutes. Log: ${reapLog}`
    : 'Auto-reap is OFF (--no-reap): reap by hand with reap-claude-sessions.mjs --slices ….'}
When they finish, verify every slice's branch actually merged back:
  ${mergeBackHint()}
Finished work rots unmerged unless someone runs that check — do not skip it.`);
}

// THE AUTOMATIC REAP (2026-09-28). The reap was a step the orchestrator had to remember, and it
// didn't. So every spawn starts a detached `reap-claude-sessions.mjs --watch` for exactly the
// slices it opened; it reaps each one on the reaper's own checks plus a quiet period, and exits
// when none is left. The log lives under ~/.claude/logs, never in the repo (another project's
// .claude/ may not be ignored).
function startReaper(slices) {
  const log = path.join(os.homedir(), '.claude', 'logs', `reap-watch-${path.basename(REPO)}.log`);
  try {
    mkdirSync(path.dirname(log), { recursive: true });
    const fd = openSync(log, 'a');
    const reaper = path.join(path.dirname(fileURLToPath(import.meta.url)), 'reap-claude-sessions.mjs');
    const child = spawn(process.execPath, [reaper, '--watch', '--slices', slices.map((s) => s.name).join(',')], {
      cwd: REPO, detached: true, stdio: ['ignore', fd, fd], env: process.env,
    });
    child.unref();
    return log;
  } catch (err) {
    console.warn(`[spawn] could not start the auto-reap watcher: ${err.message} — reap by hand`);
    return null;
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
