/**
 * arch-guard rule set — ILLUSTRATIVE.
 *
 * The production rule set this engine was extracted from is almost entirely
 * business-specific (inventory chokepoints, reservation-ledger invariants,
 * channel/table names, frozen lists of legacy writers with per-entry history).
 * It has been replaced here with three generic rules that demonstrate the
 * three rule kinds. Write your own against your own tables and seams — the
 * value of this tool is entirely in what you encode here.
 *
 * Hard-won conventions from running this in production:
 *
 *  - ALLOWLISTS ONLY SHRINK. When a rule is born with existing violators,
 *    freeze them into `baseline` (warn tier — visible on every run) rather
 *    than `allow` (silent). A warn-only rule never converges on its own, but a
 *    baseline plus a hard tier for NEW writers is a ratchet: debt stays on
 *    screen while the next bypass is red from day one.
 *
 *  - COMMENT EVERY ENTRY with why it is allowed. Six months later nobody can
 *    re-derive it from the SQL, and an uncommented allowlist grows.
 *
 *  - `/a^/` is the deliberate "match nothing" allow — for rules where no
 *    exception may ever exist.
 *
 *  - A rule scoped to one directory reports clean about the directories it
 *    does not read. The production version once policed order-import spines
 *    under `server/` while the two scripts that had written 89% of the
 *    historical cohort sat unscanned in root `scripts/`. Scope `roots` to
 *    everywhere the invariant applies, not to where you expect violations.
 */

export const RULES = [
  // ── 1. Payments chokepoint — sql-chokepoint ────────────────────────────────
  // No module outside lib/payments may write the payments tables. Every module
  // imports the same shared query helper, so an import-graph linter cannot see
  // this — only a source scan can. The optional `cols` filter (unused here)
  // narrows a hit to statements that touch protected COLUMNS within a few
  // lines of the statement start; see the engine's WINDOW.
  {
    id: 'payments-chokepoint',
    kind: 'sql-chokepoint',
    tier: 'hard',
    roots: ['server', 'scripts'],
    start: /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(payments|payment_applications)\b/i,
    allow: /(^|\/)server\/lib\/payments\//, // THE seam: postPayment/applyPayment live here
    // Frozen legacy writers that predate the seam. Warn on every run; delete
    // an entry when its writer migrates onto the seam; NEVER add one.
    baseline: {
      match: /(^|\/)server\/services\/legacyBillingSync\.js$/,
      tier: 'warn',
      message:
        'FROZEN BASELINE — payments writers that predate the seam. This list only shrinks: '
        + 'migrate the writer onto lib/payments and delete its entry. Never add one:',
    },
    message:
      'NEW write to a payments table outside lib/payments — route through the payment seam '
      + '(an inline write gets no idempotency key, no audit row, no double-post guard):',
  },

  // ── 2. Job registry — required-call ────────────────────────────────────────
  // Every scheduled-job entrypoint must register through the shared registry;
  // a job wired straight onto a timer is invisible to the drain/telemetry/
  // config machinery and "runs fine" until a deploy kills it mid-flight.
  // Deliberately a NAMED-FILE list, not a directory sweep: these are the
  // entrypoints a scheduler can start. A new one is a deliberate act, and
  // whoever adds it adds it here too. A MISSING file is a violation — a rename
  // must update this list in the same commit or the surface silently drops
  // out of coverage.
  {
    id: 'jobs-use-registry',
    kind: 'required-call',
    tier: 'hard',
    files: [
      'server/jobs/nightlyReconcile.js',
      'server/jobs/inboxPoller.js',
      'server/jobs/staleSessionSweep.js',
    ],
    // The trailing `\(` is load-bearing — see the engine: an import or a
    // comment mentioning the registry must NOT satisfy this rule.
    call: /\bregisterJob\s*\(/,
    message:
      'A scheduled-job entrypoint no longer registers with the shared registry (or was renamed '
      + 'out of this list) — it must call registerJob() so drain/telemetry/config can see it:',
  },

  // ── 3. Audited writes from routes — forbidden-line ─────────────────────────
  // No route file may push an UPDATE/DELETE through the raw query helper; route
  // handlers must use the audit wrapper (auditedWrite), which records who/what/
  // why alongside the write. Reads through the raw helper are fine, which is
  // why the pattern anchors on the statement verb inside the call — an import
  // rule can't make this distinction because both wrappers come from the same
  // module.
  {
    id: 'no-unaudited-route-writes',
    kind: 'forbidden-line',
    tier: 'hard',
    roots: ['server/routes'],
    pattern: /\brawQuery\s*\(\s*[`'"]\s*(UPDATE|DELETE)\b/i,
    allow: /a^/, // no exceptions: routes never write unaudited
    message:
      'Route file runs UPDATE/DELETE through the raw query helper — use the auditedWrite() '
      + 'wrapper so the write carries an actor and a reason:',
  },
];
