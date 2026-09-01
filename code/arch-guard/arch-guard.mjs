#!/usr/bin/env node
/**
 * arch-guard — the SQL/source-level half of a two-layer architecture guard.
 *
 * dependency-cruiser (or any import-graph linter) enforces MODULE IMPORT
 * boundaries. But some invariants are about what the code RUNS, not what it
 * imports — every module imports the same shared `query` helper, so an import
 * graph literally cannot see `query("INSERT INTO products …")`. Those
 * invariants live here as targeted source scans (pure Node fs + regex; no
 * dependencies, no shelling out except `git ls-files` in the skip helper).
 *
 * Report-only by default (exit 0). Pass --strict to exit 1 when a HARD
 * violation is found — use that form if you wire this into CI.
 *
 *   node arch-guard.mjs            # print report, always exit 0
 *   node arch-guard.mjs --strict   # exit 1 on hard violations
 *
 * Importable: `import { runGuard } from './arch-guard.mjs'` returns the
 * structured result, so a wider report script can embed it.
 *
 * The rules themselves live in rules.mjs — this file is only the engine.
 * Three rule kinds cover every invariant the production version needed:
 *
 *   sql-chokepoint   Statements touching a protected table may appear only in
 *                    an allowlisted set of files ("chokepoints"). Supports an
 *                    optional column filter (only flag when a protected column
 *                    is set within a few lines of the statement start) and an
 *                    optional FROZEN BASELINE — pre-existing writers that warn
 *                    on every run but don't fail the build, so legacy debt
 *                    stays visible while a NEW bypass is hard from day one.
 *
 *   forbidden-line   No non-comment line under `roots` may match `pattern`
 *                    (outside `allow`). Tripwires against a known-bad idiom.
 *
 *   required-call    Every file in a NAMED list must contain a live CALL of a
 *                    guard function. A missing file is RED, not skipped — a
 *                    rename must update the list in the same commit, or the
 *                    surface silently drops out of coverage.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// Files git will never commit are not this guard's business — one stray
// untracked file used to fail EVERY session's commit in a shared checkout.
// The full rationale (and why `git ls-files --others` is the EXACT answer,
// not an approximation) lives in the helper; it is shared with the verify
// script so the two halves of the pre-commit gate cannot drift apart.
import untrackedFiles from './lib/untrackedFiles.cjs';
import { RULES } from './rules.mjs';

const { untrackedPaths } = untrackedFiles;

const CODE_EXTS = ['.js', '.mjs', '.cjs', '.ts'];
const TEST_RE = /(\.test\.[jt]s$|\.spec\.[jt]s$|[/\\]__tests__[/\\]|[/\\]test[/\\]|\.d\.ts$)/;
const MIGRATIONS_RE = /(^|\/)(db\/)?migrations\//;
// The guard's OWN sources carry rule-definition strings (messages quoting
// "INSERT INTO payments", pattern literals) that aren't executable SQL — they
// must never be scanned against their own rules.
const SELF_RE = /(^|\/)(arch-guard\.mjs|rules\.mjs)$/;

// SQL statements in most codebases keep their SET/column list within a few
// lines of the statement start; 8 was measured as enough in the source repo.
const WINDOW = 8;

// Comment lines (incl. JSDoc `* …` continuation lines) never count — a
// doc-comment SQL example isn't executable code.
const isComment = (line) => {
  const t = line.trim();
  return t.startsWith('*') || t.startsWith('//') || t.startsWith('/*');
};

const read = (f) => {
  try {
    return readFileSync(f, 'utf8');
  } catch {
    return '';
  }
};

/**
 * Recursively list code files under `dir` (skips node_modules, and anything
 * git will not commit). `root` is the directory the walk was ENTERED at; it is
 * threaded through the recursion so the skip set is fetched (and memoized)
 * once per top-level root rather than per directory.
 *
 * The skip sets hold ABSOLUTE paths, so `resolve()` each candidate before
 * testing — that makes the check independent of the caller's cwd. Two residual
 * ways a path can still disagree, BOTH of which under-filter (scan more, never
 * less — the safe direction): macOS NFD-vs-NFC (readdirSync returns NFD, git's
 * core.precomposeunicode returns NFC), and Windows, where join() emits
 * backslashes and git emits forward slashes.
 */
function walk(dir, root = dir) {
  // Defensive: a caller passing walk directly to Array#map/flatMap hands us
  // the INDEX as `root` (that exact bug crashed on resolve(0) during
  // development). A non-string root can only mean a top-level call.
  if (typeof root !== 'string') root = dir;
  if (!existsSync(dir)) return [];
  const skip = untrackedPaths(root);
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // A nested git repo (a stray clone or worktree someone left behind) is
      // reported by `git ls-files --others` as a single DIRECTORY entry and
      // never as its individual files, so a file-level check alone would miss
      // every file inside it. Prune the recursion.
      if (skip.dirs.has(resolve(full))) continue;
      out.push(...walk(full, root));
    } else if (CODE_EXTS.some((e) => entry.name.endsWith(e)) && !skip.files.has(resolve(full))) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Walk each root exactly once, memoized per runGuard() call — several rules
 * usually share `['server']`.
 *
 * NOT `roots.flatMap(walk)` — flatMap passes (element, index, array), so the
 * index would land in walk's second parameter and become the skip-set root.
 */
function makeLister() {
  const cache = new Map();
  return (roots) =>
    roots.flatMap((r) => {
      if (!cache.has(r)) cache.set(r, walk(r));
      return cache.get(r);
    });
}

const normalize = (f) => f.replace(/\\/g, '/');

const isExempt = (rel) => TEST_RE.test(rel) || MIGRATIONS_RE.test(rel) || SELF_RE.test(rel);

/**
 * sql-chokepoint scanner. Line-based on the statement START (real SQL keeps
 * `INSERT INTO <table>` together on one line — whole-file matching would let a
 * `\s` in the pattern bridge newlines and match two unrelated tokens), with a
 * short forward window for the optional column filter.
 */
function scanSqlChokepoint(files, rule) {
  const hits = [];
  for (const f of files) {
    const rel = normalize(f);
    if (isExempt(rel)) continue;
    if (rule.allow.test(rel)) continue;
    const baseline = rule.baseline && rule.baseline.match.test(rel);
    const lines = read(f).split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (isComment(lines[i])) continue;
      if (!rule.start.test(lines[i])) continue;
      if (rule.cols) {
        const win = lines.slice(i, i + WINDOW).join('\n');
        if (!rule.cols.test(win)) continue;
      }
      hits.push({ file: `${rel}:${i + 1}`, baseline });
    }
  }
  return hits;
}

function scanForbiddenLine(files, rule) {
  const out = [];
  for (const f of files) {
    const rel = normalize(f);
    if (isExempt(rel)) continue;
    if (rule.allow && rule.allow.test(rel)) continue;
    const lines = read(f).split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (isComment(lines[i])) continue;
      if (rule.pattern.test(lines[i])) {
        out.push(`${rel}:${i + 1}`);
        break; // one hit per file keeps the report readable
      }
    }
  }
  return out;
}

function scanRequiredCall(rule) {
  // A CALL, not a mention: the trailing `\(` in a well-formed rule.call is
  // load-bearing. Negative-testing the production version of this rule caught
  // it passing twice on nothing — first on a COMMENT naming the guard, then on
  // a bare `import { assertGuard }` whose call site had been renamed away.
  // Both forms leave the door wide open: an import line never matches (the
  // name is followed by a comma or brace, not a paren) and comment lines are
  // skipped, so only a real invocation satisfies the rule.
  const hasLiveCall = (f) => read(f).split('\n').some((l) => !isComment(l) && rule.call.test(l));
  // A MISSING file is RED, not skipped. `existsSync(f) && …` would let a
  // rename drop a surface out of coverage silently — and a gradual .js → .ts
  // migration renames files constantly, so that is a live path to a false
  // green, not a hypothetical one.
  return rule.files.filter((f) => !existsSync(f) || !hasLiveCall(f));
}

export function runGuard(rules = RULES) {
  const hard = []; // breaks an invariant — blocks under --strict
  const warn = []; // worth a human look (frozen baselines, warn-tier rules)
  const info = []; // informational inventory, never blocks

  const bucket = (tier) => (tier === 'hard' ? hard : tier === 'warn' ? warn : info);
  const list = makeLister();

  for (const rule of rules) {
    if (rule.kind === 'sql-chokepoint') {
      const hits = scanSqlChokepoint(list(rule.roots), rule);
      const fresh = hits.filter((h) => !h.baseline).map((h) => h.file);
      const legacy = hits.filter((h) => h.baseline).map((h) => h.file);
      if (fresh.length) bucket(rule.tier).push({ rule: rule.id, message: rule.message, files: fresh });
      if (legacy.length)
        bucket(rule.baseline.tier ?? 'warn').push({
          rule: `${rule.id}-baseline`,
          message: rule.baseline.message,
          files: legacy,
        });
    } else if (rule.kind === 'forbidden-line') {
      const files = scanForbiddenLine(list(rule.roots), rule);
      if (files.length) bucket(rule.tier).push({ rule: rule.id, message: rule.message, files });
    } else if (rule.kind === 'required-call') {
      const files = scanRequiredCall(rule);
      if (files.length) bucket(rule.tier).push({ rule: rule.id, message: rule.message, files });
    } else {
      throw new Error(`arch-guard: unknown rule kind ${JSON.stringify(rule.kind)} (${rule.id})`);
    }
  }

  return { hard, warn, info };
}

export function format({ hard, warn, info }) {
  const lines = ['# arch-guard — SQL/source-level architecture invariants', ''];
  const section = (title, items, glyph) => {
    lines.push(`## ${title} (${items.length})`);
    if (items.length === 0) lines.push('  ✓ clean');
    else
      for (const it of items) {
        lines.push(`  ${glyph} [${it.rule}] ${it.message}`);
        for (const f of it.files) lines.push(`      - ${f}`);
      }
    lines.push('');
  };
  section('HARD violations', hard, '✗');
  section('Warnings', warn, '!');
  section('Info / inventory', info, 'ℹ');
  return lines.join('\n');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const result = runGuard();
  process.stdout.write(format(result) + '\n');
  if (process.argv.includes('--strict') && result.hard.length > 0) process.exit(1);
}
