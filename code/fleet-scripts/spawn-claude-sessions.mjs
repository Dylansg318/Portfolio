#!/usr/bin/env node
/**
 * spawn-claude-sessions — open one iTerm2 tab per work slice, each running a
 * fully-briefed Claude session in its own git worktree.
 *
 * WHY: the old parallelization flow emitted N blocks of prose that the operator
 * pasted into N hand-opened sessions, and every prompt re-explained how to
 * provision a worktree. Claude Code now does both natively (`-w` provisions and
 * enters a worktree; the prompt can be a positional argument), so the paste step
 * is pure manual labor. This script removes it.
 *
 *   node spawn-claude-sessions.mjs --dir prompts/slices
 *   node spawn-claude-sessions.mjs --spec slices.json --dry-run
 *
 * TARGETING — the load-bearing detail. iTerm2's AppleScript `current window`
 * means FRONTMOST, not "the window this process runs in". With 5-8 Claude
 * sessions open, that reliably drops tabs into someone else's window (observed
 * in production use). We resolve the caller's own window by matching the GUID
 * half of $ITERM_SESSION_ID against every session id, and only fall back to a
 * NEW window when that lookup fails — never to `current window`.
 *
 * PROMPTS GO VIA FILES, never inline. A multi-line prompt threaded through
 * AppleScript string escaping -> zsh -c -> the shell is a quoting bug farm; a
 * file path is one token that survives all three layers.
 *
 * Each spawned session runs under a dedicated iTerm2 profile, which supplies
 * --dangerously-skip-permissions and the repo cwd. That is deliberate: a
 * session that stops on a permission prompt parks silently forever with nobody
 * notified (observed: one background agent blocked five days). Isolation comes
 * from the per-slice worktree, NOT from the permission prompt.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

// Repo root: env override, else the git toplevel of the cwd.
const REPO = process.env.FLEET_REPO || (() => {
  try {
    return execFileSync('/usr/bin/git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    return process.cwd();
  }
})();
const PROFILE = process.env.FLEET_ITERM_PROFILE || 'Claude Fleet';
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const BASE_BRANCH = process.env.FLEET_BASE_BRANCH || 'main';

// ---------------------------------------------------------------- args

function parseArgs(argv) {
  const a = { slices: [], dryRun: false, dir: null, spec: null, newWindow: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--dry-run') a.dryRun = true;
    else if (v === '--new-window') a.newWindow = true;
    else if (v === '--dir') a.dir = argv[++i];
    else if (v === '--spec') a.spec = argv[++i];
    else if (v === '--help' || v === '-h') a.help = true;
  }
  return a;
}

function usage() {
  console.log(`
spawn-claude-sessions — one iTerm2 tab per slice, each in its own worktree

  --dir <path>     directory of prompt files; each <name>.md becomes slice <name>
  --spec <path>    JSON: { "slices": [ { "name": "...", "prompt"|"promptFile": "..." } ] }
  --dry-run        print the plan and the exact commands; spawn nothing
  --new-window     force a new iTerm2 window instead of tabs in the caller's window

Env: FLEET_REPO           repo root (default: git toplevel of cwd)
     FLEET_ITERM_PROFILE  iTerm2 profile for spawned tabs (default "Claude Fleet")
     FLEET_BASE_BRANCH    integration branch worktrees fork from (default "main")
     CLAUDE_BIN           claude binary (default "claude" on PATH)
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

// The iTerm2 BADGE, not the tab title. Claude Code rewrites every tab's title to
// a rolling conversation summary within a turn or two — measured: four spawned
// tabs, three already renamed to things like "duplicate-replacement fix and
// follow-up work", only the newest still showing its slice name. So a title is
// useless as an identity marker. Nothing rewrites the badge, so it keeps saying
// which slice the tab is, for as long as the tab lives.
// Slice names are .md basenames; sanitise to the kebab charset so nothing can
// escape the single quotes below.
const badgeCmd = (name) =>
  `printf '\\033]1337;SetBadgeFormat=%s\\a' "$(printf %s '${String(name).replace(/[^A-Za-z0-9._-]/g, '-')}' | base64)"`;

function buildCommand(slice) {
  const inner =
    `cd ${REPO} && ` +
    `${badgeCmd(slice.name)} && ` +
    `${CLAUDE_BIN} -w ${slice.name} -n ${slice.name} "$(cat '${slice.promptFile}')"`;
  return zshWrap(inner);
}

function spawnScript(slices, { newWindow }) {
  const guid = (process.env.ITERM_SESSION_ID || '').split(':').pop() || '';
  const lines = [];
  lines.push('tell application "iTerm2"');
  if (!newWindow && guid) {
    lines.push(`  set myGuid to ${asStr(guid)}`);
    lines.push('  set targetWindow to missing value');
    lines.push('  repeat with w in windows');
    lines.push('    repeat with t in tabs of w');
    lines.push('      repeat with s in sessions of t');
    lines.push('        if (id of s) is myGuid then set targetWindow to w');
    lines.push('      end repeat');
    lines.push('    end repeat');
    lines.push('  end repeat');
  } else {
    lines.push('  set targetWindow to missing value');
  }
  lines.push('  if targetWindow is missing value then');
  // No caller window found (or --new-window): make ONE window for the first
  // slice, then hang the rest off it as tabs. Never touch `current window`.
  lines.push(`    set targetWindow to (create window with profile ${asStr(PROFILE)} command ${asStr(buildCommand(slices[0]))})`);
  lines.push('  else');
  lines.push('    tell targetWindow');
  lines.push(`      create tab with profile ${asStr(PROFILE)} command ${asStr(buildCommand(slices[0]))}`);
  lines.push('    end tell');
  lines.push('  end if');
  for (const slice of slices.slice(1)) {
    lines.push('  tell targetWindow');
    lines.push(`    create tab with profile ${asStr(PROFILE)} command ${asStr(buildCommand(slice))}`);
    lines.push('  end tell');
  }
  lines.push(`  return ${asStr(`spawned ${slices.length}`)}`);
  lines.push('end tell');
  return lines.join('\n');
}

// ---------------------------------------------------------------- main

// WHO SPAWNED WHAT. The reaper decides safety from evidence — clean tree, work
// on the integration branch, a "done" broadcast — and that evidence is identical
// for a slice someone ELSE is running. In one real incident, a reap from one
// session closed a finished slice belonging to a different operator's run. No
// work was lost (its commit was already on the integration branch) but its
// scrollback was, and it was not ours to close.
//
// So the spawner now writes down what it opened and who opened it. The reaper
// reads this and, by default, only closes slices from THIS tab's run.
// `.claude/worktrees/` is gitignored, and the prune pass removes worktree
// DIRECTORIES via git, so a dotfile at its root survives the cleanup.
const OWNERS_FILE = path.join(REPO, '.claude', 'worktrees', '.spawn-owners.json');

function recordOwnership(slices) {
  const owner = (process.env.ITERM_SESSION_ID || '').split(':').pop() || 'unknown';
  let book = {};
  try { book = JSON.parse(readFileSync(OWNERS_FILE, 'utf8')) || {}; } catch { /* first run */ }
  const at = new Date().toISOString();
  for (const s of slices) book[s.name] = { owner, at };
  try {
    mkdirSync(path.dirname(OWNERS_FILE), { recursive: true });
    writeFileSync(OWNERS_FILE, JSON.stringify(book, null, 2));
  } catch (err) {
    // Never fail a spawn over bookkeeping — the reaper degrades to asking.
    console.warn(`[spawn] could not record slice ownership: ${err.message}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();

  let slices;
  try {
    slices = materializePrompts(loadSlices(args));
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }

  const guid = (process.env.ITERM_SESSION_ID || '').split(':').pop() || '';
  const where = args.newWindow || !guid ? 'a NEW iTerm2 window' : "tabs in the caller's window";
  console.log(`spawning ${slices.length} session(s) as ${where}\n`);
  for (const s of slices) {
    console.log(`  ${s.name.padEnd(28)} worktree=${s.name}  prompt=${path.relative(REPO, s.promptFile)}`);
  }

  if (args.dryRun) {
    console.log('\n--dry-run: commands that WOULD run\n');
    for (const s of slices) console.log(`  ${buildCommand(s)}\n`);
    console.log('--- applescript ---');
    console.log(spawnScript(slices, args));
    return;
  }

  const script = spawnScript(slices, args);
  try {
    const out = execFileSync('/usr/bin/osascript', ['-'], { input: script, encoding: 'utf8' });
    recordOwnership(slices);
    console.log(`\n${out.trim()}`);
  } catch (err) {
    console.error(`\nosascript failed: ${err.stderr || err.message}`);
    process.exit(1);
  }

  console.log(`
Each session provisions its own worktree at .claude/worktrees/<slice> and works there.
When they finish, run:  node worktree-audit.mjs
That reports any branch with work not on origin/${BASE_BRANCH} — the check that would have
caught a finished barcode rasterizer sitting unmerged for five weeks.`);
}

main();
