'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');

// agent.js is single-file (the supervisor's auto-update delivers exactly one
// file), so pure helpers live in it and are exported for tests. Requiring it
// runs module-level setup: point the log at a temp file so tests don't create
// tools/print-agent/agent.log. The main loop only starts under require.main.
process.env.LOG_PATH = path.join(os.tmpdir(), 'agent-test.log');
const lib = require('../agent');

test('withTimeout resolves when the inner promise settles in time', async () => {
  const v = await lib.withTimeout(() => Promise.resolve('ok'), 50);
  assert.equal(v, 'ok');
});

test('withTimeout rejects and fires onTimeout when the inner promise hangs', async () => {
  let killed = false;
  await assert.rejects(
    () => lib.withTimeout(() => new Promise(() => {}), 20, () => { killed = true; }),
    /timed out after 20ms/
  );
  assert.equal(killed, true);
});

test('withTimeout ignores a late resolve after timeout (no double-settle)', async () => {
  let resolveLate;
  const p = lib.withTimeout(() => new Promise((r) => { resolveLate = r; }), 20);
  await assert.rejects(() => p, /timed out/);
  resolveLate('too late'); // must not throw / must not matter
});

test('breakerDecision pauses only at/after the failure threshold', () => {
  assert.deepEqual(lib.breakerDecision({ consecutiveFailures: 0 }), { pause: false, cooldownMs: 0 });
  assert.deepEqual(lib.breakerDecision({ consecutiveFailures: 2 }), { pause: false, cooldownMs: 0 });
  assert.deepEqual(lib.breakerDecision({ consecutiveFailures: 3 }), { pause: true, cooldownMs: 60000 });
  assert.deepEqual(lib.breakerDecision({ consecutiveFailures: 9, cooldownMs: 5000 }), { pause: true, cooldownMs: 5000 });
});

// --- lintZpl -----------------------------------------------------------------

test('lintZpl passes a normal label', () => {
  const zpl = '^XA^PW812^LL1218^FO60,120^A0N,50,50^FDTracking 123^FS^XZ';
  assert.deepEqual(lib.lintZpl(zpl), []);
});

test('lintZpl passes a graphics-only label (boxes count as content)', () => {
  assert.deepEqual(lib.lintZpl('^XA^FO40,60^GB700,1000,4^FS^XZ'), []);
});

test('lintZpl flags a payload with no ^XA at all', () => {
  const problems = lib.lintZpl('plain text the printer will ignore');
  assert.ok(problems.some((p) => p.includes('no ^XA')));
});

test('lintZpl flags unbalanced ^XA/^XZ', () => {
  const problems = lib.lintZpl('^XA^FO1,1^A0N,20,20^FDx^FS');
  assert.ok(problems.some((p) => p.includes('unbalanced')));
});

test('lintZpl flags an empty format (would feed a blank label)', () => {
  const problems = lib.lintZpl('^XA^PW812^LL1218^XZ');
  assert.ok(problems.some((p) => p.includes('no printable content')));
});

test('lintZpl flags a block whose only ^FD is empty', () => {
  const problems = lib.lintZpl('^XA^FO60,120^A0N,50,50^FD^FS^XZ');
  assert.ok(problems.some((p) => p.includes('no printable content')));
});

test('lintZpl reports the specific empty block in a multi-block payload', () => {
  const problems = lib.lintZpl('^XA^FD ok ^FS^XZ^XA^PW812^XZ');
  assert.ok(problems.some((p) => p.includes('block 2')));
});

// --- computeVerdict ------------------------------------------------------------
// Length facts measured on the ZP 450: nominal label 1308 dots / 203 dpi = 6.44",
// real feed per label 7-8" including gap/positioning.

const LEN = 1308 / 203;

test('computeVerdict: normal single label (7-8" feed) is ok', () => {
  assert.equal(lib.computeVerdict({ advanced: 7, totalLabels: 1, labelLenIn: LEN }), 'ok');
  assert.equal(lib.computeVerdict({ advanced: 8, totalLabels: 1, labelLenIn: LEN }), 'ok');
});

test('computeVerdict: zero feed is no_feed (the silent-failure case)', () => {
  assert.equal(lib.computeVerdict({ advanced: 0, totalLabels: 1, labelLenIn: LEN }), 'no_feed');
  assert.equal(lib.computeVerdict({ advanced: 0, totalLabels: 2, labelLenIn: LEN }), 'no_feed');
});

test('computeVerdict: 2-block job that fed only one label is partial (missing slip)', () => {
  assert.equal(lib.computeVerdict({ advanced: 8, totalLabels: 2, labelLenIn: LEN }), 'partial');
});

test('computeVerdict: 2-block job with normal feed is ok', () => {
  assert.equal(lib.computeVerdict({ advanced: 14, totalLabels: 2, labelLenIn: LEN }), 'ok');
  assert.equal(lib.computeVerdict({ advanced: 16, totalLabels: 2, labelLenIn: LEN }), 'ok');
});

test('computeVerdict: dump-mode style over-feed is runaway', () => {
  assert.equal(lib.computeVerdict({ advanced: 25, totalLabels: 1, labelLenIn: LEN }), 'runaway');
  assert.equal(lib.computeVerdict({ advanced: 40, totalLabels: 2, labelLenIn: LEN }), 'runaway');
});

test('computeVerdict: mid-feed jam is partial', () => {
  assert.equal(lib.computeVerdict({ advanced: 3, totalLabels: 1, labelLenIn: LEN }), 'partial');
});

// --- settleStep (drain-detect settle reducer) --------------------------------
const SETTLE_OPTS = { stableNeeded: 2, neverMovedStable: 4, before: 1000 };

test('settleStep drain phase flips to confirm when the printer buffer empties', () => {
  let s = { phase: 'drain', last: null, stable: 0, hsMisses: 0, done: false, after: null };
  s = lib.settleStep(s, { hs: { formatsInBuffer: 2, labelsRemainingInBatch: 1 }, od: null }, SETTLE_OPTS);
  assert.equal(s.phase, 'drain');
  s = lib.settleStep(s, { hs: { formatsInBuffer: 0, labelsRemainingInBatch: 0 }, od: null }, SETTLE_OPTS);
  assert.equal(s.phase, 'confirm');
  assert.equal(s.done, false);
});

test('settleStep treats unparsed (-1) buffer counters as drained', () => {
  let s = { phase: 'drain', last: null, stable: 0, hsMisses: 0, done: false, after: null };
  s = lib.settleStep(s, { hs: { formatsInBuffer: -1, labelsRemainingInBatch: -1 }, od: null }, SETTLE_OPTS);
  assert.equal(s.phase, 'confirm');
});

test('settleStep falls through to confirm after 4 consecutive ~HS misses', () => {
  let s = { phase: 'drain', last: null, stable: 0, hsMisses: 0, done: false, after: null };
  for (let i = 0; i < 3; i++) {
    s = lib.settleStep(s, { hs: null, od: null }, SETTLE_OPTS);
    assert.equal(s.phase, 'drain');
  }
  s = lib.settleStep(s, { hs: null, od: null }, SETTLE_OPTS);
  assert.equal(s.phase, 'confirm');
});

test('settleStep a good ~HS read resets the miss counter', () => {
  let s = { phase: 'drain', last: null, stable: 0, hsMisses: 3, done: false, after: null };
  s = lib.settleStep(s, { hs: { formatsInBuffer: 1, labelsRemainingInBatch: 0 }, od: null }, SETTLE_OPTS);
  assert.equal(s.hsMisses, 0);
  assert.equal(s.phase, 'drain');
});

test('settleStep confirm phase settles after stableNeeded equal advanced reads', () => {
  let s = { phase: 'confirm', last: null, stable: 0, hsMisses: 0, done: false, after: null };
  s = lib.settleStep(s, { hs: null, od: 1013 }, SETTLE_OPTS);   // first read
  assert.equal(s.done, false);
  s = lib.settleStep(s, { hs: null, od: 1013 }, SETTLE_OPTS);   // stable=1
  assert.equal(s.done, false);
  s = lib.settleStep(s, { hs: null, od: 1013 }, SETTLE_OPTS);   // stable=2 -> done
  assert.equal(s.done, true);
  assert.equal(s.after, 1013);
});

test('settleStep never-moved needs the extra patience (legacy fallback semantics)', () => {
  let s = { phase: 'confirm', last: null, stable: 0, hsMisses: 0, done: false, after: null };
  for (let i = 0; i < 4; i++) {
    s = lib.settleStep(s, { hs: null, od: 1000 }, SETTLE_OPTS); // od === before
    assert.equal(s.done, false, `read ${i + 1} must not settle yet`);
  }
  s = lib.settleStep(s, { hs: null, od: 1000 }, SETTLE_OPTS);   // stable=4 -> done
  assert.equal(s.done, true);
  assert.equal(s.after, 1000);
});

test('settleStep a moving odometer resets stability; a missed read changes nothing', () => {
  let s = { phase: 'confirm', last: 1010, stable: 1, hsMisses: 0, done: false, after: null };
  const before = { ...s };
  s = lib.settleStep(s, { hs: null, od: null }, SETTLE_OPTS);   // miss
  assert.deepEqual({ last: s.last, stable: s.stable, done: s.done }, { last: before.last, stable: before.stable, done: false });
  s = lib.settleStep(s, { hs: null, od: 1013 }, SETTLE_OPTS);   // moved
  assert.equal(s.stable, 0);
  assert.equal(s.last, 1013);
});

// --- settleStep: the wall-clock stability floor ------------------------------
// Regression for the 2026-07-03 false-partial storm. The odometer ticks in
// whole inches (~200ms/inch at 5 ips) and fast mode polls every 250ms, so two
// consecutive EQUAL reads happen routinely while paper is still moving. Sample
// count alone therefore cannot mean "settled" — hence minStableMs.
const TIMED_OPTS = { stableNeeded: 2, neverMovedStable: 4, minStableMs: 700, before: 1000 };

test('settleStep does NOT settle on equal reads that arrive faster than minStableMs', () => {
  let s = { phase: 'confirm', last: null, stable: 0, stableSince: null, hsMisses: 0, done: false, after: null };
  // Three identical reads 250ms apart: the old sample-count rule ended here.
  s = lib.settleStep(s, { hs: null, od: 1007, at: 0 },   TIMED_OPTS);
  s = lib.settleStep(s, { hs: null, od: 1007, at: 250 }, TIMED_OPTS);
  s = lib.settleStep(s, { hs: null, od: 1007, at: 500 }, TIMED_OPTS);
  assert.equal(s.stable >= TIMED_OPTS.stableNeeded, true, 'sample count is satisfied');
  assert.equal(s.done, false, 'but 500ms < 700ms floor, so it must keep polling');
  // Same inch still held past the floor -> genuinely stopped.
  s = lib.settleStep(s, { hs: null, od: 1007, at: 800 }, TIMED_OPTS);
  assert.equal(s.done, true);
  assert.equal(s.after, 1007);
});

test('settleStep restarts the clock when the odometer moves again mid-feed', () => {
  let s = { phase: 'confirm', last: null, stable: 0, stableSince: null, hsMisses: 0, done: false, after: null };
  s = lib.settleStep(s, { hs: null, od: 1004, at: 0 },    TIMED_OPTS);
  s = lib.settleStep(s, { hs: null, od: 1004, at: 600 },  TIMED_OPTS);
  assert.equal(s.done, false);
  s = lib.settleStep(s, { hs: null, od: 1005, at: 800 },  TIMED_OPTS);  // paper moved on
  assert.equal(s.stable, 0);
  assert.equal(s.stableSince, 800, 'floor restarts from the new reading');
  s = lib.settleStep(s, { hs: null, od: 1005, at: 1100 }, TIMED_OPTS);
  s = lib.settleStep(s, { hs: null, od: 1005, at: 1300 }, TIMED_OPTS);
  assert.equal(s.done, false, '500ms since the move is still short of the floor');
  s = lib.settleStep(s, { hs: null, od: 1005, at: 1600 }, TIMED_OPTS);
  assert.equal(s.done, true);
  assert.equal(s.after, 1005);
});

test('settleStep with no clock supplied keeps the pure sample-count semantics', () => {
  let s = { phase: 'confirm', last: null, stable: 0, stableSince: null, hsMisses: 0, done: false, after: null };
  for (let i = 0; i < 3; i++) s = lib.settleStep(s, { hs: null, od: 1007 }, TIMED_OPTS);
  assert.equal(s.done, true, 'a caller that supplies no `at` must not hang on the floor');
});

test('settleStep never-moved still needs the extra patience under a clock', () => {
  let s = { phase: 'confirm', last: null, stable: 0, stableSince: null, hsMisses: 0, done: false, after: null };
  for (let i = 0; i <= 4; i++) {
    s = lib.settleStep(s, { hs: null, od: 1000, at: i * 300 }, TIMED_OPTS);  // od === before
  }
  assert.equal(s.done, true, 'neverMovedStable=4 reads spanning 1200ms > floor');
  assert.equal(s.after, 1000);
  // One read short of neverMovedStable must not settle even well past the floor.
  let t = { phase: 'confirm', last: null, stable: 0, stableSince: null, hsMisses: 0, done: false, after: null };
  for (let i = 0; i < 4; i++) t = lib.settleStep(t, { hs: null, od: 1000, at: i * 900 }, TIMED_OPTS);
  assert.equal(t.done, false);
});

// --- preflightCacheUsable ----------------------------------------------------
test('preflightCacheUsable: fresh healthy cache is usable, everything else is not', () => {
  const pre = { available: true, blocked: null, hs: {}, es: {} };
  const cache = { pre, at: 10000 };
  assert.equal(lib.preflightCacheUsable(cache, { now: 15000, busted: false, cacheMs: 10000 }), true);
  assert.equal(lib.preflightCacheUsable(null,  { now: 15000, busted: false, cacheMs: 10000 }), false);
  assert.equal(lib.preflightCacheUsable(cache, { now: 15000, busted: true,  cacheMs: 10000 }), false);
  assert.equal(lib.preflightCacheUsable(cache, { now: 25000, busted: false, cacheMs: 10000 }), false);          // expired
  assert.equal(lib.preflightCacheUsable({ pre: { ...pre, blocked: 'media out' }, at: 10000 }, { now: 15000, busted: false, cacheMs: 10000 }), false);
  assert.equal(lib.preflightCacheUsable({ pre: { ...pre, available: false }, at: 10000 }, { now: 15000, busted: false, cacheMs: 10000 }), false);
});

// --- ackOutcome (claim-ACK response matrix) ------------------------------------
test('ackOutcome: confirmed claim is acked — safe to print', () => {
  assert.equal(lib.ackOutcome(200, { ok: true, status: 'claimed' }), 'acked');
});

test('ackOutcome: 2xx for a job we no longer own is skip (redelivered/printed/failed)', () => {
  assert.equal(lib.ackOutcome(200, { ok: true, status: 'queued' }),  'skip');
  assert.equal(lib.ackOutcome(200, { ok: true, status: 'printed' }), 'skip');
  assert.equal(lib.ackOutcome(200, { ok: true, status: 'failed' }),  'skip');
  assert.equal(lib.ackOutcome(200, null), 'skip');
});

test('ackOutcome: JSON 404 (route exists, job gone) is skip', () => {
  assert.equal(lib.ackOutcome(404, { error: 'Job not found' }), 'skip');
});

test('ackOutcome: plain-text 404 (pre-ack server, route missing) is legacy', () => {
  assert.equal(lib.ackOutcome(404, 'Cannot POST /api/print-queue/x/ack'), 'legacy');
  assert.equal(lib.ackOutcome(404, ''), 'legacy');
});

test('ackOutcome: 5xx and odd statuses are retry', () => {
  assert.equal(lib.ackOutcome(500, { error: 'boom' }), 'retry');
  assert.equal(lib.ackOutcome(502, 'Bad Gateway'), 'retry');
  assert.equal(lib.ackOutcome(429, null), 'retry');
});

// --- prefetchAllowed -----------------------------------------------------------
test('prefetchAllowed only in a clean healthy state', () => {
  const base = { enabled: true, consecutiveFailures: 0, halted: false, preflightBlocked: false };
  assert.equal(lib.prefetchAllowed(base), true);
  assert.equal(lib.prefetchAllowed({ ...base, enabled: false }), false);
  assert.equal(lib.prefetchAllowed({ ...base, consecutiveFailures: 1 }), false);
  assert.equal(lib.prefetchAllowed({ ...base, halted: true }), false);
  assert.equal(lib.prefetchAllowed({ ...base, preflightBlocked: true }), false);
});
