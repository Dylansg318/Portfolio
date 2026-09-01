'use strict';
/**
 * Guard-hook behaviour tests — node:test, no DB, no jest.
 *   node --test __tests__/guards.test.cjs
 *
 * (.cjs, not .js: in the source project this lived in a CommonJS tree; here it
 * carries its module type with it so a surrounding "type":"module" package
 * cannot break it.)
 *
 * These run the hooks as real subprocesses over real stdin payloads, because
 * the thing under test IS the process contract (exit 2 = block, exit 0 = allow,
 * stdout = additionalContext). Asserting against the internal functions would
 * skip the part that can actually break.
 *
 * The NEGATIVE cases matter more than the positive ones. A guard that blocks
 * legitimate work gets switched off within a day, and then it guards nothing —
 * so every "must allow" below is load-bearing.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const HOOKS = path.join(__dirname, '..');

function runHook(file, payload, env = {}) {
  const r = spawnSync(process.execPath, [path.join(HOOKS, file)], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

const bash = (command, env) =>
  runHook('bash-guard.cjs', { tool_name: 'Bash', tool_input: { command } }, env);

// ---------------------------------------------------------------- bash-guard

test('bash-guard BLOCKS broad staging', () => {
  const blocked = [
    'git add -A',
    'git add .',
    'git add --all',
    'git add -u',
    'git add --update',
    'git add -A .',
    'git commit -a -m "x"',
    'git commit -am "x"',
    'git commit --all -m "x"',
    'git -C /somewhere/else add -A',
    'git add -A && git commit -m "x"',
    'cd client && git add .',
  ];
  for (const c of blocked) {
    assert.strictEqual(bash(c).code, 2, `should block: ${c}`);
  }
});

test('bash-guard BLOCKS --no-verify on commit', () => {
  for (const c of ['git commit --no-verify -m "x"', 'git commit -n -m "x"', 'git commit -nm "x"']) {
    assert.strictEqual(bash(c).code, 2, `should block: ${c}`);
  }
});

test('bash-guard BLOCKS rm -rf .playwright-mcp', () => {
  for (const c of ['rm -rf .playwright-mcp', 'rm -rf .playwright-mcp/', 'rm -r ./.playwright-mcp']) {
    assert.strictEqual(bash(c).code, 2, `should block: ${c}`);
  }
});

test('bash-guard ALLOWS explicit-path git work', () => {
  const allowed = [
    'git add path/to/file.js',
    'git add .claude/hooks/bash-guard.cjs',            // starts with a dot, is not "."
    'git add server/a.js server/b.js',
    'git commit -m "msg" path/to/file.js',
    'git commit --amend --no-edit',                     // --amend must not read as -a
    'git commit -m "docs: explain git add -A"',         // the flag inside a quoted message
    'git status --short --branch',
    'git diff --cached --name-only',
    'git pull origin working',
    'git push origin working',
    'git log --all --oneline',                          // --all on a NON-staging subcommand
    'git stash list',
    'git clean -n .playwright-mcp',                     // -n here is dry-run, not no-verify
    'git add -n .',                                     // dry-run staging changes nothing
    'git add --dry-run .',
    'git checkout -- .',
  ];
  for (const c of allowed) {
    const r = bash(c);
    assert.strictEqual(r.code, 0, `should allow: ${c}\n${r.stderr}`);
  }
});

test('bash-guard ALLOWS unrelated rm and non-git commands', () => {
  const allowed = [
    'rm -rf node_modules',
    'rm -rf /tmp/scratch',
    'rm -f .playwright-mcp/one-file.png',   // not recursive, targets a file
    'npm install',
    'ls -la',
    'echo "git add -A"',                     // mentioned, not run
  ];
  for (const c of allowed) {
    const r = bash(c);
    assert.strictEqual(r.code, 0, `should allow: ${c}\n${r.stderr}`);
  }
});

test('bash-guard honours its escape hatches', () => {
  assert.strictEqual(bash('AGENT_ALLOW_BROAD_ADD=1 git add -A').code, 0);
  assert.strictEqual(bash('AGENT_ALLOW_NO_VERIFY=1 git commit --no-verify -m "x"').code, 0);
  assert.strictEqual(bash('git add -A', { AGENT_BASH_GUARD_OFF: '1' }).code, 0);
});

test('bash-guard fails OPEN on malformed input', () => {
  const r = spawnSync(process.execPath, [path.join(HOOKS, 'bash-guard.cjs')], {
    input: 'not json at all',
    encoding: 'utf8',
  });
  assert.strictEqual(r.status, 0);
});

test('bash-guard block message names the fix, not just the rule', () => {
  const r = bash('git add -A');
  assert.match(r.stderr, /git add path\/to\/file/);
  assert.match(r.stderr, /AGENT_ALLOW_BROAD_ADD=1/);
});

// ------------------------------------------------------------- context-guard

const ctxFile = (file_path, session_id) =>
  runHook('context-guard.cjs', { tool_name: 'Edit', tool_input: { file_path }, session_id });

const ctxSql = (sql, session_id) =>
  runHook('context-guard.cjs', { tool_name: 'mcp__db__query', tool_input: { sql }, session_id });

let sid = 0;
const nextSession = () => `test-session-${process.pid}-${++sid}`;

test('context-guard NEVER blocks', () => {
  assert.strictEqual(ctxFile('server/services/payments/gateway.js', nextSession()).code, 0);
  assert.strictEqual(ctxSql('SELECT 1', nextSession()).code, 0);
});

test('context-guard surfaces the payment seam on payment code', () => {
  const r = ctxFile('server/services/payments/gateway.js', nextSession());
  assert.match(r.stdout, /ONE PAYMENT SEAM/);
});

test('context-guard surfaces the load-bearing UI list on nav/layout', () => {
  for (const p of ['client/src/lib/nav.js', 'client/src/components/layout/Topbar.tsx']) {
    const r = ctxFile(p, nextSession());
    assert.match(r.stdout, /LOAD-BEARING UI/, p);
  }
});

test('context-guard says NOTHING on an unrelated file', () => {
  for (const p of ['README.md', 'client/src/pages/Dashboard.tsx', 'scripts/foo.mjs']) {
    const r = ctxFile(p, nextSession());
    assert.strictEqual(r.stdout.trim(), '', `should be silent for ${p}`);
  }
});

test('context-guard flags created_at only when it is a business window on orders', () => {
  const hit = ctxSql(
    "SELECT date_trunc('month', o.created_at), sum(o.total) FROM orders o GROUP BY 1",
    nextSession()
  );
  assert.match(hit.stdout, /BUSINESS DATE vs RECORD DATE/);

  // created_at on a non-order table, and a plain projection — neither is a
  // business window, so neither should nag.
  for (const sql of [
    'SELECT created_at FROM job_runs ORDER BY created_at DESC LIMIT 10',
    'SELECT id, created_at FROM orders LIMIT 5',
  ]) {
    const r = ctxSql(sql, nextSession());
    assert.doesNotMatch(r.stdout, /BUSINESS DATE/, `should stay quiet: ${sql}`);
  }
});

test('context-guard flags an unscoped external-order-id query, not a scoped one', () => {
  const unscoped = ctxSql("SELECT * FROM orders WHERE external_order_id = '12345678'", nextSession());
  assert.match(unscoped.stdout, /STOREFRONT SCOPE/);

  const scoped = ctxSql(
    "SELECT * FROM orders WHERE external_order_id = '12345678' AND store_account = 'store_a'",
    nextSession()
  );
  assert.doesNotMatch(scoped.stdout, /STOREFRONT SCOPE/);
});

test('context-guard fires ONCE per rule per session', () => {
  const s = nextSession();
  const first = ctxFile('server/services/payments/gateway.js', s);
  assert.match(first.stdout, /ONE PAYMENT SEAM/);

  const second = ctxFile('server/services/billing/charge.js', s);
  assert.doesNotMatch(second.stdout, /ONE PAYMENT SEAM/);

  // ...but a different session still gets it.
  const other = ctxFile('server/services/payments/gateway.js', nextSession());
  assert.match(other.stdout, /ONE PAYMENT SEAM/);
});

test('context-guard emits no permissionDecision (must not touch the permission flow)', () => {
  const r = ctxFile('server/services/payments/gateway.js', nextSession());
  const parsed = JSON.parse(r.stdout);
  assert.strictEqual(parsed.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.ok(!('permissionDecision' in parsed.hookSpecificOutput));
  assert.ok(parsed.hookSpecificOutput.additionalContext.length > 0);
});

test('context-guard honours its off switch', () => {
  const r = runHook(
    'context-guard.cjs',
    { tool_name: 'Edit', tool_input: { file_path: 'server/services/payments/gateway.js' }, session_id: nextSession() },
    { AGENT_CONTEXT_GUARD_OFF: '1' }
  );
  assert.strictEqual(r.stdout.trim(), '');
});

// ------------------------------------------------------------ subagent-rules

test('subagent-rules emits the trip-wire digest', () => {
  const r = runHook('subagent-rules.cjs', { hook_event_name: 'SubagentStart', agent_type: 'general-purpose' });
  assert.strictEqual(r.code, 0);
  const parsed = JSON.parse(r.stdout);
  assert.strictEqual(parsed.hookSpecificOutput.hookEventName, 'SubagentStart');
  const ctx = parsed.hookSpecificOutput.additionalContext;
  for (const needle of [
    'vendors',              // the one-canonical-table rule
    'master is sacred',
    'store_account',
    'order_date',
    'git add -A',
    'maxWorkers',
  ]) {
    assert.ok(ctx.includes(needle), `digest should mention ${needle}`);
  }
});

test('subagent-rules honours its off switch', () => {
  const r = runHook('subagent-rules.cjs', {}, { AGENT_SUBAGENT_RULES_OFF: '1' });
  assert.strictEqual(r.stdout.trim(), '');
});
