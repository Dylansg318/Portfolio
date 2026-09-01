#!/usr/bin/env node
'use strict';
/**
 * bash-guard.cjs — PreToolUse(Bash) guard for commands that damage SHARED
 * state: the git index every session in this checkout writes to, and a
 * tracked directory that looks disposable but is not.
 *
 * Sibling of jest-guard.cjs, which guards a different axis (machine load).
 * Same contract, same escape-hatch philosophy.
 *
 * WHY A HOOK AND NOT A DOC
 * ------------------------
 * The "stage and commit by explicit path" rule was written down THREE times —
 * in the operator's global rules file, in the project rules under "Git Commit
 * Rules", and again under "Multi-Session Safety" — and sessions still ran
 * `git add -A`. That is not a comprehension failure. Prose is advisory and
 * competes for attention with everything else in a long context; a session 200
 * turns deep, finishing a task, reaches for the shorthand it has used in a
 * thousand other repos. A PreToolUse hook does not degrade with context depth,
 * and it applies to subagents that never read the rules file at all.
 *
 * WHAT IT BLOCKS
 * --------------
 *   git add -A / . / --all / -u        ~20 sessions share this checkout. A
 *     git commit -a / -am / --all      sweeping stage takes their half-finished
 *                                      work into YOUR commit, under your
 *                                      message. In one production incident,
 *                                      twelve sessions in one checkout wedged
 *                                      every `git pull` for an hour; in
 *                                      another, three sessions died leaving 6
 *                                      dirty files and the checkout sat at
 *                                      "ahead 7 / behind 119" for THREE DAYS.
 *                                      Naming paths is the only thing that
 *                                      isolates you — `git add` alone does not,
 *                                      because the index is shared and
 *                                      add->commit spans two tool calls.
 *
 *   git commit --no-verify / -n        The pre-commit hook is not a duplicate
 *                                      of CI. Measured at the time this guard
 *                                      landed: the typecheck workflow had not
 *                                      gone GREEN in weeks (0 successes in 93
 *                                      runs), it runs cancel-in-progress so
 *                                      ~60% of runs are cancelled by the next
 *                                      push, and the integration branch CANNOT
 *                                      have branch protection (private repo on
 *                                      a free plan — the protection API returns
 *                                      403). CI is advisory by construction.
 *                                      The pre-commit hook is the only gate
 *                                      that actually stops anything, and it is
 *                                      the ONLY layer that runs the source
 *                                      ratchets, which --findRelatedTests
 *                                      selects zero of.
 *
 *   rm -rf .playwright-mcp             It is listed in .gitignore, so it reads
 *                                      as scratch, but it holds 105 TRACKED
 *                                      files. Deleting it is a silent 105-file
 *                                      deletion staged by the next broad `git
 *                                      add` — which is why this pairs with the
 *                                      rule above.
 *
 * NOT BLOCKED, DELIBERATELY
 * -------------------------
 *   Pushing to the release branch — the team was actively making changes there
 *   and did not want the friction (a deliberate team decision, revisitable).
 *
 *   Chained git commands (`git add x && git commit ...`) — the no-chaining rule
 *   existed only to avoid re-approving each command under an older permission
 *   workflow. That workflow changed, so the rule was retired the same day.
 *   Chaining is fine; sweeping is not, and this file guards the part that
 *   actually mattered.
 *
 * ESCAPE HATCHES
 * --------------
 *   AGENT_ALLOW_BROAD_ADD=1    prefix — stage broadly on purpose (a solo
 *                              checkout, a genuine bulk import).
 *   AGENT_ALLOW_NO_VERIFY=1    prefix — commit past the pre-commit hook
 *                              (docs-only change while the checker is broken).
 *   AGENT_BASH_GUARD_OFF=1     environment — disable this guard wholesale.
 *
 * Contract: exit 0 = allow; exit 2 = block, stderr goes back to the model as
 * the correction. Any internal error fails OPEN — a guard that wedges a
 * session gets deleted, and then it guards nothing.
 */

const ALLOW_BROAD_ADD = /\bAGENT_ALLOW_BROAD_ADD=1\b/;
const ALLOW_NO_VERIFY = /\bAGENT_ALLOW_NO_VERIFY=1\b/;

/** git's own global flags that consume the next token. */
const GIT_GLOBAL_VALUE_FLAGS = new Set([
  '-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path',
  '--super-prefix', '--config-env',
]);

function readStdin() {
  try {
    return require('fs').readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function block(msg) {
  process.stderr.write(msg + '\n');
  process.exit(2);
}

/** Split at top-level separators. A `git add -A` inside a quoted string is not
 *  the failure mode we are chasing, so crude splitting is correct here. */
function segments(cmd) {
  return cmd.split(/(?:&&|\|\||[;\n|])/g).map((s) => s.trim()).filter(Boolean);
}

function tokenize(seg) {
  const raw = seg.match(/(?:[^\s'"]+|'[^']*'|"[^"]*")+/g) || [];
  return raw.map((t) => t.replace(/^['"]|['"]$/g, ''));
}

const isEnvAssign = (t) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(t);

/**
 * Reduce a segment to { sub, args } for a git invocation, or null.
 * Handles leading env assignments, sudo/time, and git's global value-flags.
 */
function parseGit(seg) {
  const toks = tokenize(seg);
  let i = 0;
  while (i < toks.length && (isEnvAssign(toks[i]) || toks[i] === 'sudo' || toks[i] === 'time')) i++;
  if (i >= toks.length) return null;
  if (!/(?:^|\/)git$/.test(toks[i])) return null;
  i++;

  // Skip git's global flags before the subcommand.
  while (i < toks.length && toks[i].startsWith('-')) {
    if (GIT_GLOBAL_VALUE_FLAGS.has(toks[i])) i += 2;
    else i += 1;
  }
  if (i >= toks.length) return null;

  return { sub: toks[i], args: toks.slice(i + 1) };
}

/**
 * Does this arg list carry a short flag containing `ch`?
 * Handles the combined form (`-am` contains both `a` and `m`). Stops at `--`,
 * and never inspects a long flag (`--amend` must not read as `-a`).
 */
function hasShortFlag(args, ch) {
  for (const a of args) {
    if (a === '--') break;
    if (!a.startsWith('-') || a.startsWith('--')) continue;
    if (a.slice(1).includes(ch)) return true;
  }
  return false;
}

function hasLongFlag(args, name) {
  for (const a of args) {
    if (a === '--') break;
    if (a === name || a.startsWith(name + '=')) return true;
  }
  return false;
}

/** Positional (non-flag) args — the explicit paths. `--` ends flag parsing. */
function positionals(args, valueFlags) {
  const out = [];
  let afterDashDash = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (afterDashDash) { out.push(a); continue; }
    if (a === '--') { afterDashDash = true; continue; }
    if (a.startsWith('-')) {
      if (valueFlags.has(a)) i++; // skip its value
      continue;
    }
    out.push(a);
  }
  return out;
}

const ADD_HELP = [
  'Stage the files YOU touched, by name:',
  '',
  '  git add path/to/file other/path',
  '  git commit -m "..." path/to/file other/path',
  '',
  'Pass the SAME paths to commit that you passed to add (path-form / --only).',
  '`git add` alone does not isolate you: the index is shared across every',
  'session in this checkout, and add->commit spans two separate tool calls, so',
  'another session can stage a file in between and a plain `git commit` sweeps',
  'it into your message.',
  '',
  'If you truly mean to stage everything (solo checkout, bulk import), make it a',
  'decision: prefix the command with AGENT_ALLOW_BROAD_ADD=1',
].join('\n');

function checkGit(g, cmd) {
  const { sub, args } = g;

  // `git add -n/--dry-run .` prints what WOULD be staged and changes nothing.
  const addIsDryRun = sub === 'add' &&
    (hasShortFlag(args, 'n') || hasLongFlag(args, '--dry-run'));

  if (sub === 'add' && !addIsDryRun && !ALLOW_BROAD_ADD.test(cmd)) {
    const broadFlag =
      hasShortFlag(args, 'A') || hasLongFlag(args, '--all') ||
      hasShortFlag(args, 'u') || hasLongFlag(args, '--update');
    // `.` / `./` / `:/` as a whole token means "the entire tree". A path that
    // merely STARTS with a dot (.claude/hooks/x.cjs) is explicit and fine.
    const broadPath = positionals(args, new Set(['--chmod', '--pathspec-from-file']))
      .some((p) => p === '.' || p === './' || p === ':/' || p === '*');

    if (broadFlag || broadPath) {
      block(
        `BLOCKED: broad \`git add\` (${broadFlag ? 'flag' : 'pathspec'}) in a shared checkout.\n\n` +
        'About twenty agent sessions share this working tree and its git index.\n' +
        'A sweeping stage picks up their half-finished work and commits it under\n' +
        'your message — that is how, in one production incident, three dead\n' +
        'sessions left six dirty files that blocked every `git pull` for three days.\n\n' +
        ADD_HELP
      );
    }
  }

  if (sub === 'commit') {
    if (!ALLOW_BROAD_ADD.test(cmd) && (hasShortFlag(args, 'a') || hasLongFlag(args, '--all'))) {
      block(
        'BLOCKED: `git commit -a` / --all in a shared checkout.\n\n' +
        'This stages every tracked modification in the tree — including the files\n' +
        'other live sessions are still editing — and commits them under your\n' +
        'message, bypassing the explicit-path discipline entirely.\n\n' +
        ADD_HELP
      );
    }

    if (!ALLOW_NO_VERIFY.test(cmd) && (hasShortFlag(args, 'n') || hasLongFlag(args, '--no-verify'))) {
      block(
        'BLOCKED: `git commit --no-verify`.\n\n' +
        'The pre-commit hook is NOT a duplicate of CI — right now it is the only\n' +
        'gate that stops anything. Measured when this guard landed:\n' +
        '  • the typecheck workflow had 0 green runs out of its last 93\n' +
        '  • it runs cancel-in-progress, so ~60% of runs are cancelled by the next push\n' +
        '  • the integration branch CANNOT have branch protection (private repo, free\n' +
        '    plan — the protection API returns 403), so a red CI X blocks nothing anyway\n\n' +
        'It is also the ONLY layer that runs the source ratchets (no-inline-styles,\n' +
        'no-magic-spacing, ...): they find their inputs with an fs walk rather than\n' +
        'imports, so --findRelatedTests selects ZERO of them and CI-only coverage\n' +
        'misses them entirely.\n\n' +
        'It is scoped, not the full suite — client tests run only for your staged\n' +
        'client files, server tests only for the suites guarding your staged server\n' +
        'files. A server-only or docs-only commit skips both tiers.\n\n' +
        'If it is failing on something unrelated to your change, say so and fix that\n' +
        'instead. To bypass deliberately: prefix AGENT_ALLOW_NO_VERIFY=1'
      );
    }
  }
}

/** rm targeting the tracked-but-gitignored browser-test output directory. */
function checkRm(seg) {
  const toks = tokenize(seg);
  let i = 0;
  while (i < toks.length && (isEnvAssign(toks[i]) || toks[i] === 'sudo' || toks[i] === 'time')) i++;
  if (i >= toks.length || !/(?:^|\/)rm$/.test(toks[i])) return;

  const args = toks.slice(i + 1);
  const recursive = hasShortFlag(args, 'r') || hasShortFlag(args, 'R') ||
    hasLongFlag(args, '--recursive');
  if (!recursive) return;

  const hit = positionals(args, new Set()).some((p) => /(^|\/)\.playwright-mcp\/?$/.test(p));
  if (!hit) return;

  block(
    'BLOCKED: rm -r .playwright-mcp\n\n' +
    'That directory is listed in .gitignore, so it reads as scratch output. It is\n' +
    'not: it holds 105 TRACKED files. Deleting it stages 105 deletions that the\n' +
    'next commit carries silently.\n\n' +
    'To clear genuinely-untracked scratch inside it, target the files you mean:\n' +
    '  git clean -n .playwright-mcp     # dry run first — see what is untracked\n' +
    '  git clean -f .playwright-mcp     # removes ONLY untracked files'
  );
}

function main() {
  if (process.env.AGENT_BASH_GUARD_OFF === '1') return;

  let d = {};
  try {
    d = JSON.parse(readStdin() || '{}');
  } catch {
    return; // never wedge a session over a parse failure
  }
  const cmd = (d.tool_input && d.tool_input.command) || '';
  if (!cmd) return;
  // Cheap pre-filter: nothing below can fire without one of these words.
  if (!/\bgit\b|\brm\b/.test(cmd)) return;

  for (const seg of segments(cmd)) {
    const g = parseGit(seg);
    if (g) checkGit(g, cmd);
    else checkRm(seg);
  }
}

try {
  main();
} catch {
  process.exit(0); // fail open
}
