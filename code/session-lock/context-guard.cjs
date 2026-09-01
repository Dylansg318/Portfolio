#!/usr/bin/env node
'use strict';
/**
 * context-guard.cjs — PreToolUse(Edit|Write|MultiEdit|mcp__db__query)
 * reminder hook. It NEVER blocks. It puts the rule that governs a surface in
 * front of the model at the moment the model touches that surface.
 *
 * WHY THIS SHAPE
 * --------------
 * The rules here cannot be decided by a machine. Whether a query SHOULD use the
 * business date depends on the question being asked; whether an edit to a sync
 * file breaks an invariant depends on what the edit does. A hook that guessed
 * would be wrong often enough to be disabled — an "obviously right" heuristic
 * in this codebase once regressed 3,027 of 4,000 real cases.
 *
 * But the TRIGGER is mechanical even when the verdict isn't. That is the whole
 * design: block nothing, decide nothing, and simply move the reminder from
 * "loaded 300 turns ago in a 1M-token context, competing with everything" to
 * "on screen at the instant it applies."
 *
 * FIRES ONCE PER RULE PER SESSION. A reminder that repeats on every file in a
 * ten-file refactor is noise, and noise is how the whole layer gets switched
 * off. State lives in a tmp file keyed by session id; if it cannot be written,
 * the hook still emits (fail toward the reminder, not toward silence).
 *
 * The rules below are GENERIC EXAMPLES standing in for the production rule
 * table (which named real internal tables, routes, and incident numbers). The
 * mechanism — mechanical trigger, human-judgment text, once-per-session — is
 * what this file demonstrates.
 *
 * Set AGENT_CONTEXT_GUARD_OFF=1 to disable.
 *
 * Contract: always exit 0. Emits {"hookSpecificOutput":{...,"additionalContext"}}
 * on stdout, which the agent harness hands to the model as a system reminder.
 * permissionDecision is deliberately OMITTED — this hook must not perturb the
 * permission flow at all (a hook returning "ask" is documented to silently
 * override settings.json deny rules; anthropics/claude-code#39344).
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

/**
 * Each rule: a mechanical trigger, and the text to surface. `id` is the
 * once-per-session key.
 */
const FILE_RULES = [
  {
    id: 'payment-seam',
    test: (p) => /server\/services\/(payments|billing)\//.test(p) || /payments\/gateway/.test(p),
    text:
      'ONE PAYMENT SEAM — you are editing a payment surface. Every charge goes\n' +
      'through the single gateway wrapper: quote() freezes the exact amount into a\n' +
      'DB token, charge() takes ONLY a token and re-validates before submitting.\n' +
      'Do not add a second path that calls the payment API directly — the last\n' +
      'bypass shipped an unreviewed charge at 2.5x the quoted amount.',
  },
  {
    id: 'load-bearing-ui',
    test: (p) =>
      /client\/src\/lib\/nav\.(js|ts)$/.test(p) ||
      /client\/src\/components\/layout\//.test(p),
    text:
      'LOAD-BEARING UI — these pieces look like dead code and are not. Do not drop\n' +
      'them as a side effect of unrelated work:\n' +
      '  • the NAV registry array in client/src/lib/nav.js — the route highlighter\n' +
      '    in the same file must stay in sync with it\n' +
      '  • the admin entry lives ONLY in the topbar menu, never in the NAV array\n' +
      'Editing them is fine and needs no sign-off — losing them by accident is not.',
  },
];

const SQL_RULES = [
  {
    id: 'order-date',
    // created_at used anywhere a date window/bucket/sort is being built.
    //
    // The table test is deliberately the PLURAL `orders`, not /order(s)?/: the
    // singular form matches the `ORDER BY` keyword, which made this fire on
    // `SELECT created_at FROM job_runs ORDER BY created_at` — a sync-monitoring
    // query where created_at is the CORRECT column. Caught by the test below;
    // it is exactly the false positive that gets a reminder hook switched off.
    test: (s) =>
      /\bcreated_at\b/i.test(s) &&
      /\borders\b/i.test(s) &&
      /(date_trunc|extract|interval|between|>=|<=|>|<|group by|order\s+by)/i.test(s),
    text:
      'BUSINESS DATE vs RECORD DATE — this query windows on `created_at` and touches\n' +
      'orders. For ANY business metric (revenue, velocity, ship times, activity) the\n' +
      'correct column is COALESCE(o.order_date, o.created_at): backfills insert rows\n' +
      'months after the sale, and a plain created_at filter once overstated 30-day\n' +
      'revenue by ~60%. Same for date_trunc / EXTRACT / sorts / date math.\n' +
      'created_at IS correct for intake/audit/sync monitoring — "what landed in our\n' +
      'system" rather than "what the business did". If that is what you meant, carry on.',
  },
  {
    id: 'account-scope',
    // The positive match alone would nag on every correctly-scoped query; the
    // NEGATIVE half (!store_account) is what makes this fire only on the bug.
    test: (s) => /\bexternal_order_id\b/i.test(s) && !/store_account/i.test(s),
    text:
      'STOREFRONT SCOPE — this query filters on external_order_id without scoping by\n' +
      '`store_account`. The same external order number exists under MORE THAN ONE\n' +
      'storefront account as completely separate orders. Unscoped, this silently\n' +
      'picks one of them at random. Add the account scope, or state explicitly that\n' +
      'you mean all of them (a few reports intentionally cross storefronts).',
  },
];

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/** Once-per-session dedupe. Fails toward emitting. */
function alreadyFired(sessionId, ids) {
  if (!sessionId) return new Set();
  const f = path.join(os.tmpdir(), `agent-context-guard-${sessionId}.json`);
  let seen = [];
  try {
    seen = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!Array.isArray(seen)) seen = [];
  } catch {
    seen = [];
  }
  const fired = new Set(seen);
  const fresh = ids.filter((i) => !fired.has(i));
  if (fresh.length) {
    try {
      fs.writeFileSync(f, JSON.stringify(seen.concat(fresh)));
    } catch {
      /* not fatal — worst case the reminder repeats */
    }
  }
  return fired;
}

function main() {
  if (process.env.AGENT_CONTEXT_GUARD_OFF === '1') return;

  let d = {};
  try {
    d = JSON.parse(readStdin() || '{}');
  } catch {
    return;
  }

  const tool = d.tool_name || '';
  const ti = d.tool_input || {};
  const matched = [];

  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) {
    const p = ti.file_path || ti.notebook_path || '';
    if (!p) return;
    // Strip everything up to a recognized top-level source dir, so the rules
    // match repo-relative paths whether the tool sent an absolute path, a
    // worktree path, or a relative one.
    const rel = p.replace(/^.*?\/(?=(?:server|client|scripts|docs)\/)/, '');
    for (const r of FILE_RULES) if (r.test(rel)) matched.push(r);
  } else if (/mcp__db/.test(tool)) {
    const sql = ti.sql || ti.query || '';
    if (!sql) return;
    for (const r of SQL_RULES) if (r.test(sql)) matched.push(r);
  } else {
    return;
  }

  if (!matched.length) return;

  const fired = alreadyFired(d.session_id, matched.map((m) => m.id));
  const fresh = matched.filter((m) => !fired.has(m.id));
  if (!fresh.length) return;

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: fresh.map((m) => m.text).join('\n\n'),
    },
  }));
}

try {
  main();
} catch {
  /* fail silently — a reminder is never worth breaking a tool call over */
}
process.exit(0);
