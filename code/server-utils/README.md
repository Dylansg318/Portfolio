# Server utilities

Extracted from a private production ERP; identifiers and incident details have been sanitized.

These are readable excerpts, not an installable package. Each utility is
dependency-free (Node built-ins only) unless noted; TypeScript files run under
`tsx` in dev/test and are precompiled for production. Tests live in
`__tests__/` and use the built-in `node:test` runner — where a utility has no
test file here, it never had a dedicated one upstream.

---

## writeQueryGuard.ts — the security boundary for an LLM write endpoint

Production runs an endpoint that lets an LLM operator agent submit a single
DML statement against the live database. This pure function is the shape
gate in front of it — the route layer adds dry-run rollback, an affected-row
cap, a statement timeout, and audit logging, but everything that can be decided
from the SQL text alone is decided here, with no I/O, so it can be tested
exhaustively.

The design is an **allowlist of the leading verb** (INSERT / UPDATE / DELETE)
plus a short **denylist of specific hazards**, and each choice encodes a
sharp edge:

- A keyword denylist is brittle ("SET" is UPDATE syntax; identifiers can
  contain scary words). Requiring the statement to *begin* with a DML verb,
  combined with single-statement enforcement, is what actually keeps DDL out.
- **CTEs are banned outright**: a data-modifying `WITH` reports only the final
  clause's row count, so it would lie to both the dry-run preview and the
  affected-row cap while mutating thousands of rows. The safe equivalent (a
  subquery in the WHERE) is still allowed.
- **Protected tables** (the audit log, the settings/kill-switch table, the
  migration ledger, identity/auth tables) are unwritable even though the data
  plane is writable — the agent must never be able to erase its own trail or
  escalate via a settings key.
- **Functions whose effects survive ROLLBACK** (`setval`, file/network I/O,
  advisory locks, backend termination) are rejected because a dry-run
  *executes* the statement before rolling it back.

## savepoint.js — why catching a DB error in JS doesn't un-abort the transaction

The best-documented 74 lines in the codebase this came from. When any statement
fails inside a Postgres transaction, the whole transaction is aborted
server-side; catching the error in JavaScript changes nothing, and the *next*
statement on that connection throws `current transaction is aborted…`. The
common "try the INSERT, swallow the unique-violation, keep going" pattern is
therefore a trap inside any caller-supplied transaction — it wedged a nightly
catalog sync in production, failing every remaining row of each page after the
first duplicate. `withSavepoint(runner, fn)` wraps the risky write in a
SAVEPOINT, rolls back to it on failure (which lifts the aborted state), and
rethrows the original error so the caller's swallow is now actually safe.
Dependency-free: `runner` is anything with an async `query(sql)`. The test
suite includes a "regression witness" that reproduces the wedge without the
savepoint.

## totp.ts — RFC 6238 TOTP with hand-rolled base32, zero deps

Complete TOTP code generation (dynamic truncation and all) plus a base32
decoder, on nothing but Node's `crypto`. Returns the code together with the
seconds remaining in the current period so a UI can show a countdown.

## secretCrypto.ts — AES-256-GCM for secrets in Postgres bytea

`secretCipher(envVar)` builds an encrypt/decrypt pair bound to a 32-byte
base64 key in the named env var. Wire format is
`[12-byte IV][16-byte auth tag][ciphertext]` in a single buffer, stored in a
bytea column. Two deliberate details: the key is read **lazily per call** so
module load order doesn't matter (tests and boot-time requires work before
env is populated), and `available()` lets callers degrade gracefully when the
key isn't configured instead of throwing.

## swrCache.ts — stale-while-revalidate for expensive per-key computes

For values whose freshness tolerance is high (nav badges, status chips) but
whose compute is slow (multi-second upstream API fan-out). First call computes
and concurrent callers share the promise; within TTL it's a pure cache hit;
after TTL the **stale value is still returned instantly** and exactly one
background refresh runs — a failed refresh keeps serving stale rather than
surfacing an error into a polling endpoint. Bounded by `maxEntries` with
oldest-write eviction via Map insertion order.

## singleFlight.ts — collapse concurrent same-key calls

17 lines: concurrent callers with the same key share one execution and one
promise; the key releases when it settles. Per-process by design — cross-
replica overlap just means two harmless refreshes.

## pMapLimit.ts — ordered concurrency-capped map

`Promise.all` semantics (order preserved, first error rejects) with at most
`limit` workers. The worker-pool-over-a-shared-index shape avoids chunking
stalls (no waiting for the slowest item of each batch).

## orderedRelease.js — insertion-order completion for concurrent work

Built for bulk label buys: purchases run concurrently, but the physical
printer must print in insertion order, so slot *i*'s flush waits for slots
0..i-1. A failed buy releases its slot immediately (`arrive(i, null)`), and a
throwing flush is contained per-slot so one jammed label can't stall the rest.
Implemented as a pre-chained promise ladder — gate *i* resolves on
`arrive(i)` — so there is no drain-loop re-entrancy to get wrong. Double
`arrive` is a safe no-op (resolving a resolved promise does nothing).

## inflightDrain.js — graceful shutdown that waits for money-touching requests

The deploy platform SIGTERMs the old container and hard-kills it seconds
later; a 30–60s bulk label buy severed mid-flight once left an orphaned paid
carrier label and an unprinted shipment. This tracks in-flight requests on
the shipping route prefixes only (deliberately not global — a long-poll
endpoint would hold every drain to its ceiling) and lets the shutdown handler
wait for them. The sharp edge: completion is hooked on both `finish` *and*
`close`, because a dead client socket must not leak an entry and wedge every
future drain. Also exposes a process-wide `isDraining()` flag so the job
runner refuses to start doomed runs and checkpointed loops can stop at a safe
boundary.

## logCapture.ts — in-memory log ring buffer for live debugging

Monkey-patches `console.*` into a 5,000-entry ring buffer exposed via a
diagnostics endpoint, so an LLM debugging agent can grep recent server output
without redeploying with temporary log statements. Per-process and reset by
redeploys, by design — it is a live-debugging tool, not log retention. The
patch never lets its own failure block a console call.

## abcClassify.ts — ABC inventory classification, with the ranking bug it fixes

Pure Pareto classifier. The bug it encodes a fix for: the percentile used to
run over the *entire* sellable catalog (27,215 products), so the 20% A bucket
(5,443 slots) was larger than the whole demand-carrying population (3,721) —
every product that sold at all came out class A, silently pinning the
replenishment service level and pointing cycle counts at thousands of
never-sold items. Ranking only products with demand yields a real split
(A = 745 products carrying 89% of 30-day revenue). Zero-revenue products
floor to 'C' — deliberately not null, which would empty the C bucket that
cycle-count schedules filter on. Classes resolve by id, not input index, so a
negative-revenue credit line can't shift the boundaries; numeric strings from
pg NUMERIC columns are handled.

## businessDays.ts — add N business days

Skips weekends (no holiday table). Uses UTC day-of-week on purpose: a
few-hour timezone skew is immaterial for a 2-day escalation SLA. Returns a
new Date; never mutates the input.

## money.ts — shared money formatters

`formatCents`, `formatDollars`, `round2`. The comment is the point: `round2`
is byte-identical to the module-local helpers it replaced, and variants with
*different* semantics (Number.EPSILON, null-passthrough) are deliberately not
unified into it.

## trimToLimit.ts — word-boundary truncation for marketplace titles

A blind `.slice(0, n)` cuts mid-word and strands the load-bearing tail of a
product title ("...20 Disposable Plas"). This cuts at the last space at or
before the limit, hard-cuts only when the first word alone is over-long, and
appends no ellipsis — on a length-capped marketplace title a "…" wastes a
character and reads as broken.

---

### Seams cut during extraction

- `savepoint.js` — already dependency-free upstream; only the incident's
  internal job/function names were genericized.
- `secretCrypto.ts` — the default cipher binding was renamed to a generic
  `SECRET_CIPHER_KEY` env var (upstream binds vendor-specific listener keys).
- `writeQueryGuard.ts` / `logCapture.ts` — endpoint paths and the audit-table
  name were genericized; logic unchanged.
- `abcClassify.ts` — consumer references point at "the replenishment SQL" and
  "the cycle-count scheduler" instead of internal file paths; the measured
  numbers are real.
