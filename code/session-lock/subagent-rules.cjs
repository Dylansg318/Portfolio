#!/usr/bin/env node
'use strict';
/**
 * subagent-rules.cjs — SubagentStart hook. Injects the project's trip-wire
 * rules into every dispatched subagent.
 *
 * THE HOLE THIS FILLS
 * -------------------
 * Subagents do NOT inherit the project rules file, its sub-files, or the
 * per-user memory. A dispatched agent starts blank. Everything else in the
 * hooks directory reinforces a rule the model has already been shown; this one
 * supplies a rule that was never in the room at all. That difference is why it
 * matters more than the blockers: nobody is ignoring these rules in a
 * subagent — the subagent has simply never seen them.
 *
 * The prior mitigation was a skill that asked the DISPATCHING session to paste
 * the rules into the prompt by hand. It worked when it was remembered. This
 * hook removes the remembering.
 *
 * WHAT GOES IN HERE
 * -----------------
 * Only rules where a subagent, acting reasonably on a narrow brief, produces
 * expensive damage. Not a summary of the rules file — the point is a short
 * list that survives being read, so anything that is merely useful stays out.
 * Every entry in the production version had actually been violated.
 *
 * The RULES text below is a GENERIC EXAMPLE digest — the production version
 * named real tables, storefront accounts, and dollar figures. The shape is
 * what matters: a handful of domain invariants, the git discipline for a
 * shared checkout, the test-lane discipline for a shared machine, and
 * verify-before-assert.
 *
 * Set AGENT_SUBAGENT_RULES_OFF=1 to disable.
 * Set AGENT_SUBAGENT_RULES_LOG=1 to append a line to
 * $TMPDIR/agent-subagent-rules.log every time this fires — that log is the
 * proof the event is wired, since a hook on an unsupported event is silent.
 *
 * Contract: always exit 0. SubagentStart cannot block, by design.
 */

const RULES = `PROJECT RULES — you are a subagent and did NOT inherit the project rules file.
These are the trip-wires. Full rules live in the repo's rules docs.

DATA MODEL (examples)
• Vendors have ONE canonical table: \`vendors\`, FK \`vendor_id\`. There is NO
  second synonym table and never will be. NEVER create one; push back if asked.
• The product master is sacred: a channel sync MUST NOT INSERT or UPDATE
  \`products\`. Channel syncs write to \`channel_listings\` only.

QUERIES (examples)
• Business metrics (revenue, velocity, activity) window on
  COALESCE(o.order_date, o.created_at) — NEVER plain o.created_at. Backfills
  insert months after the sale; a plain filter once overstated 30-day revenue
  by ~60%. created_at IS correct for intake/audit/sync monitoring.
• The same external order number can exist under more than one storefront
  account as SEPARATE orders. Any query on external_order_id MUST also scope
  by \`store_account\` or it picks the wrong one silently.

GIT (a shared checkout — ~20 sessions in one working tree)
• Stage AND commit by explicit path. NEVER \`git add -A\` / \`git add .\` /
  \`git commit -a\`. Pass the same paths to commit that you passed to add.
• Never push to the release branch. The integration branch is \`working\`.
• On merge conflict: STOP and ask. Never force-push, never \`git stash\`.

TESTS
• Never run a broad Jest lane by hand — name the suite:
    cd client && node_modules/.bin/jest --maxWorkers=2 src/path/to/File.test.tsx
    npm run test:jest:server -- server/path/to/file.test.js
  No full-lane scripts / bare \`jest\` / --findRelatedTests / --maxWorkers above
  2 / --watch. A dozen agent sessions share this machine; an uncapped run put
  it at load average 37 with 17.2GB of 18.4GB swap consumed.
  A PreToolUse hook blocks these, so you will be stopped rather than warned.

VERIFY BEFORE YOU ASSERT
• Call the endpoint, query the data, read the file, run the command. No "done",
  "fixed", or "passing" without the output behind it. If a step was skipped or a
  gate failed, say so plainly.`;

function main() {
  if (process.env.AGENT_SUBAGENT_RULES_OFF === '1') return;

  // Consume stdin so the caller never blocks on an unread pipe.
  let d = {};
  try {
    d = JSON.parse(require('fs').readFileSync(0, 'utf8') || '{}');
  } catch {
    d = {};
  }

  if (process.env.AGENT_SUBAGENT_RULES_LOG === '1') {
    try {
      const os = require('os');
      const path = require('path');
      require('fs').appendFileSync(
        path.join(os.tmpdir(), 'agent-subagent-rules.log'),
        `${new Date().toISOString()} fired agent_type=${d.agent_type || '?'} agent_id=${d.agent_id || '?'}\n`
      );
    } catch {
      /* logging is never fatal */
    }
  }

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SubagentStart',
      additionalContext: RULES,
    },
  }));
}

try {
  main();
} catch {
  /* fail open */
}
process.exit(0);
