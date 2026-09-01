#!/usr/bin/env node
'use strict';
/**
 * jest-guard.cjs — PreToolUse(Bash) guard that refuses the Jest invocations
 * that put the shared dev machine into swap.
 *
 * WHY A HOOK AND NOT A DOC
 * ------------------------
 * Every rule this file enforces was already written down — in the project's
 * testing doc, in the root jest.config.cjs tripwire comment, and in a per-user
 * memory file. Sessions kept running the broad commands anyway, because:
 *
 *   • the testing doc is a sub-file, loaded only when you are already working
 *     on tests — not when you reach for `npm run test:client` mid-task.
 *   • the memory file is per-user; it does not exist for other operators.
 *   • SUBAGENTS INHERIT NEITHER. A dispatched agent told "run the tests" has
 *     never seen any of it.
 *
 * A PreToolUse hook is the only layer all three miss. It sees every Bash call
 * in every session and every subagent, and it fires before the process spawns.
 *
 * WHAT IT BLOCKS (and the measurement behind each)
 * ------------------------------------------------
 *   --findRelatedTests on a widely-imported source → 301 suites / 2,473 tests
 *     / 60s. The six suites that actually covered the change ran in 1.8s.
 *     The pre-commit hook already runs this over STAGED files; doing it by
 *     hand first is pure duplicated cost.
 *   a full client run (no path arg) → 534 suites / ~95s, 2 jsdom workers at
 *     ~300MB each. CI runs this on every push already.
 *   a full server Jest lane (no path filter) → 280 suites / ~2min.
 *   --maxWorkers > 2 → the 2-worker cap in client/jest.config.cjs and
 *     jest.config.server.cjs exists because an uncapped run once took 9
 *     workers on a 10-core / 16GB Mac: load average 37 and 17.2GB of 18.4GB
 *     swap consumed.
 *   --watch / --watchAll → never terminates in an agent session; it holds the
 *     worker pool open until the Bash timeout kills it.
 *   a root-rooted `jest` with no --config → loads NO config, so it ignores
 *     both worker caps. jest.config.cjs throws on this too; blocking here
 *     saves the spawn and gives the correction instead of a stack trace.
 *
 * THE ESCAPE HATCH IS DELIBERATE — and deliberately different from the one in
 * jest.config.cjs, which has none. A root-rooted run is never correct, so
 * there is nothing to enable. A full-suite run IS sometimes correct (proving a
 * cross-cutting refactor before a push). So: prefix the command with
 * AGENT_JEST_FULL=1 and it runs. That makes the blast radius a decision
 * instead of a default, which is the whole point.
 *
 * Set AGENT_JEST_GUARD_OFF=1 in the environment to disable the guard wholesale.
 *
 * Contract: exit 0 = allow (stderr, if any, is an advisory note); exit 2 =
 * block, and stderr is fed back to the model as the correction.
 */

const OVERRIDE = /\bAGENT_JEST_FULL=1\b/;

/** Flags that consume the NEXT token, so that token is not a path positional. */
const VALUE_FLAGS = new Set([
  '-c', '--config',
  '-w', '--maxWorkers',
  '-t', '--testNamePattern',
  '--testPathPatterns', '--testPathPattern', '--testPathIgnorePatterns',
  '--rootDir', '--reporters', '--coverageDirectory', '--env',
  '--testEnvironment', '--runTestsByPath', '--selectProjects',
  '--shard', '--outputFile', '--cacheDirectory', '--maxConcurrency',
]);

/** npm scripts that are Jest lanes, mapped to the lane they run. */
const NPM_JEST_SCRIPTS = {
  'test:client': 'client',
  'test:jest:server': 'server',
  verify: 'client',
  test: 'client',
};

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

function note(msg) {
  process.stderr.write(msg + '\n');
  process.exit(0);
}

/**
 * Split a shell command into segments at top-level separators. Crude on
 * purpose: we only need the command WORD of each segment, and a jest run
 * hidden inside a quoted string is not the failure mode we are chasing.
 */
function segments(cmd) {
  return cmd.split(/(?:&&|\|\||[;\n|])/g).map((s) => s.trim()).filter(Boolean);
}

/** Tokenize, dropping surrounding quotes. Good enough for flag/path shape. */
function tokenize(seg) {
  const raw = seg.match(/(?:[^\s'"]+|'[^']*'|"[^"]*")+/g) || [];
  return raw.map((t) => t.replace(/^['"]|['"]$/g, ''));
}

const isEnvAssign = (t) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(t);

/**
 * Classify one segment. Returns null when it is not a Jest invocation.
 * { lane: 'client'|'server'|'unknown', args: string[], viaNpm: bool, rootRooted: bool }
 */
function classify(seg, cwdIsRoot) {
  const toks = tokenize(seg);
  let i = 0;
  while (i < toks.length && (isEnvAssign(toks[i]) || toks[i] === 'sudo' || toks[i] === 'time')) i++;
  if (i >= toks.length) return null;

  let cmd = toks[i];
  let args = toks.slice(i + 1);

  // npx / bunx / pnpm dlx wrappers: unwrap to the real binary.
  if (cmd === 'npx' || cmd === 'bunx') {
    while (args.length && args[0].startsWith('-')) args.shift();
    if (!args.length) return null;
    cmd = args[0];
    args = args.slice(1);
  }

  // `node node_modules/.bin/jest ...`
  if (cmd === 'node' && args.length && /(?:^|\/)jest(?:\.js|\.cjs)?$/.test(args[0])) {
    cmd = args[0];
    args = args.slice(1);
  }

  // npm/yarn/pnpm run <script>
  if (cmd === 'npm' || cmd === 'yarn' || cmd === 'pnpm') {
    let a = args.slice();
    if (a[0] === 'run' || a[0] === 'run-script') a = a.slice(1);
    const script = a[0];
    if (!script || !Object.prototype.hasOwnProperty.call(NPM_JEST_SCRIPTS, script)) return null;
    // Args after `--` are forwarded to the underlying runner.
    const dashdash = a.indexOf('--');
    const fwd = dashdash === -1 ? [] : a.slice(dashdash + 1);
    return { lane: NPM_JEST_SCRIPTS[script], args: fwd, viaNpm: true, script, rootRooted: false };
  }

  if (!/(?:^|\/)jest(?:\.js|\.cjs)?$/.test(cmd)) return null;

  // Which config will it find? An explicit --config wins; otherwise cwd decides.
  const cfgIdx = args.findIndex((a) => a === '-c' || a === '--config' || a.startsWith('--config='));
  const cfg = cfgIdx === -1
    ? null
    : (args[cfgIdx].includes('=') ? args[cfgIdx].split('=')[1] : args[cfgIdx + 1]) || null;

  let lane = 'unknown';
  if (cfg && /server/.test(cfg)) lane = 'server';
  else if (cfg && /client/.test(cfg)) lane = 'client';
  else if (/(?:^|\/)client$/.test(cwdIsRoot.cwd) || cwdIsRoot.cdClient) lane = 'client';

  return { lane, args, viaNpm: false, rootRooted: !cfg && !cwdIsRoot.cdClient && !/(?:^|\/)client$/.test(cwdIsRoot.cwd) };
}

/** Does this arg list name specific suites? */
function isScoped(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') continue;
    if (a.startsWith('-')) {
      // `--testPathPatterns=foo` scopes; the bare form consumes the next token.
      if (/^--testPathPatterns?=/.test(a)) return true;
      if (a === '--testPathPatterns' || a === '--testPathPattern') return true;
      if (a === '--runTestsByPath') return true;
      if (VALUE_FLAGS.has(a)) i++; // skip its value
      continue;
    }
    return true; // a positional = a path/pattern
  }
  return false;
}

function workerCount(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    let v = null;
    if (a === '-w' || a === '--maxWorkers') v = args[i + 1];
    else if (/^--maxWorkers=/.test(a)) v = a.split('=')[1];
    if (v == null) continue;
    if (/%$/.test(v)) return { pct: parseInt(v, 10) };
    const n = parseInt(v, 10);
    if (Number.isFinite(n)) return { n };
  }
  return null;
}

const SCOPED_HELP = [
  'Run the suites that cover your change instead:',
  '',
  '  cd client && node_modules/.bin/jest --maxWorkers=2 src/path/to/File.test.tsx',
  '  npm run test:jest:server -- server/path/to/file.test.js',
  '  npm run test:node -- --for-staged   (paths on stdin)',
  '',
  'The broad runs already happen without you: the pre-commit hook scopes to your',
  'staged files, and CI runs the FULL client + server lanes on every push.',
  '',
  'If you genuinely need the full run (proving a cross-cutting refactor), make it',
  'a decision: prefix the command with AGENT_JEST_FULL=1',
].join('\n');

function main() {
  if (process.env.AGENT_JEST_GUARD_OFF === '1') return;

  let d = {};
  try {
    d = JSON.parse(readStdin() || '{}');
  } catch {
    return; // never wedge a session over a parse failure
  }
  const cmd = (d.tool_input && d.tool_input.command) || '';
  if (!cmd || !/jest|test:client|test:jest:server|npm (run )?(test|verify)/.test(cmd)) return;

  const overridden = OVERRIDE.test(cmd);
  const cwd = d.cwd || process.cwd();

  // Track `cd client` earlier in the same command line.
  let cdClient = /(?:^|[;&|]\s*)cd\s+[^\s;&|]*client(?:\/)?\s*(?:$|[;&|])/.test(cmd);

  for (const seg of segments(cmd)) {
    if (/^cd\s+/.test(seg) && /client\/?$/.test(seg.trim())) cdClient = true;

    const j = classify(seg, { cwd, cdClient });
    if (!j) continue;

    const args = j.args;
    const argStr = args.join(' ');

    // --- always-blocked, override or not -----------------------------------
    if (/--watch(All)?\b/.test(argStr)) {
      block(
        'BLOCKED: jest --watch in an agent session.\n\n' +
        'Watch mode never exits — it holds the jsdom worker pool open until the Bash\n' +
        'timeout kills it, and until then those workers sit resident (~300MB each)\n' +
        'alongside every other live session.\n\n' +
        'Run the suite once instead:\n' +
        '  cd client && node_modules/.bin/jest --maxWorkers=2 src/path/to/File.test.tsx'
      );
    }

    const w = workerCount(args);
    if (w && !process.env.CI && ((w.n != null && w.n > 2) || (w.pct != null && w.pct > 50))) {
      block(
        `BLOCKED: --maxWorkers ${w.n != null ? w.n : w.pct + '%'} on a local run.\n\n` +
        'Both Jest configs cap local runs at 2 workers on purpose. Each jsdom worker\n' +
        'holds ~300MB, and this repo routinely has a dozen agent sessions live in the\n' +
        'same checkout. An uncapped run once took 9 workers on a 10-core / 16GB Mac:\n' +
        'load average 37, 17.2GB of 18.4GB swap consumed.\n\n' +
        'Drop the flag (the config cap applies) or pass --maxWorkers=2.'
      );
    }

    if (j.rootRooted && !j.viaNpm) {
      block(
        'BLOCKED: jest invoked from the repo root with no --config.\n\n' +
        'It finds no config there, so it ignores the 2-worker caps in\n' +
        'client/jest.config.cjs and jest.config.server.cjs and forks one worker per\n' +
        'core across the whole tree. jest.config.cjs is a tripwire that throws on\n' +
        'this; you are being stopped one step earlier.\n\n' +
        'Use a real lane:\n' +
        '  cd client && node_modules/.bin/jest --maxWorkers=2 src/path/to/File.test.tsx\n' +
        '  npm run test:jest:server -- server/path/to/file.test.js'
      );
    }

    // --- listing is free ----------------------------------------------------
    if (/--listTests\b/.test(argStr)) continue;

    if (overridden) continue;

    // --- the documented 301-suite blowup -----------------------------------
    if (/--findRelatedTests\b/.test(argStr)) {
      block(
        'BLOCKED: jest --findRelatedTests.\n\n' +
        'On a widely-imported source file this fans out to the whole client suite —\n' +
        'measured 301 suites / 2,473 tests / 60s for two settings files, because they\n' +
        'are imported everywhere. Naming the six suites that actually covered the\n' +
        'change ran in 1.8s.\n\n' +
        'You also do not need to run it by hand: the pre-commit hook already runs\n' +
        '--findRelatedTests over your STAGED files, and CI runs the full suite on push.\n\n' +
        SCOPED_HELP
      );
    }

    // --- unscoped full runs -------------------------------------------------
    if (!isScoped(args)) {
      if (j.lane === 'server') {
        block(
          `BLOCKED: the full server Jest lane${j.script ? ` (npm run ${j.script})` : ''} — 280 suites / ~2min.\n\n` +
          'CI runs this lane on every push, blocking. Locally, name the suite:\n' +
          '  npm run test:jest:server -- server/path/to/file.test.js\n\n' +
          'Note: from inside a worktree this lane exits "No tests found" and runs ZERO\n' +
          'tests. Override for a local worktree run:\n' +
          '  node node_modules/.bin/jest -c jest.config.server.cjs \\\n' +
          '    --testPathIgnorePatterns="/node_modules/" --testPathPatterns="<name>"\n\n' +
          SCOPED_HELP
        );
      }
      block(
        `BLOCKED: the full client Jest run${j.script ? ` (npm run ${j.script})` : ''} — 534 suites / ~95s.\n\n` +
        SCOPED_HELP
      );
    }
  }

  // --- advisory: the node:test lane is cheap-ish but not free ---------------
  if (/npm run test:node\b/.test(cmd) && !/--for-staged|--\s+\S/.test(cmd)) {
    note(
      'NOTE: `npm run test:node` runs the full ~985-suite node:test lane (~2min).\n' +
      'CI runs it on every push. For a local check, scope it:\n' +
      '  npm run test:node -- --for-staged   (paths on stdin)\n' +
      '  node --import tsx --test server/path/to/file.test.js'
    );
  }
}

main();
