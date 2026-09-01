'use strict';
/**
 * Regression suite for savepoint.js — the fix for a wedged nightly catalog
 * sync job (incident signature: "current transaction is aborted, commands
 * ignored until end of transaction block").
 *
 * The suite drives a FakeClient that faithfully models Postgres transaction-
 * abort semantics: once any normal statement fails, the transaction is
 * "aborted" and every later normal statement throws the incident error until a
 * ROLLBACK / ROLLBACK TO SAVEPOINT clears it. This lets us prove, without a
 * live DB, that wrapping a risky write in a SAVEPOINT keeps the surrounding
 * transaction usable after a swallowed unique-violation.
 *
 * Dependency-free (node:test only).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { withSavepoint } = require('../savepoint');

const ABORT_MSG =
  'current transaction is aborted, commands ignored until end of transaction block';

// Minimal Postgres-transaction model.
//   - SAVEPOINT / RELEASE SAVEPOINT / ROLLBACK TO SAVEPOINT are control
//     statements; ROLLBACK TO clears the aborted flag (as real PG does).
//   - Any other statement: if the txn is aborted, throw ABORT_MSG. Otherwise
//     run the next queued behavior — which may itself fail and abort the txn.
class FakeClient {
  constructor() {
    this.aborted = false;
    this.log = [];        // every sql string, in order
    this.behaviors = [];  // queue of behaviors for NORMAL statements
  }

  // Queue how the next normal statement resolves. `fail` => throws that error
  // AND aborts the transaction (Postgres behavior on a failed statement).
  enqueue(behavior) { this.behaviors.push(behavior); return this; }

  async query(sql) {
    this.log.push(sql);
    const s = String(sql).trim().toUpperCase();

    if (s.startsWith('SAVEPOINT')) return { command: 'SAVEPOINT' };
    if (s.startsWith('RELEASE SAVEPOINT')) return { command: 'RELEASE' };
    if (s.startsWith('ROLLBACK TO SAVEPOINT')) {
      this.aborted = false; // the whole point: recover the txn
      return { command: 'ROLLBACK' };
    }

    // Normal statement.
    if (this.aborted) {
      const e = new Error(ABORT_MSG);
      e.code = '25P02';
      throw e;
    }
    const behavior = this.behaviors.shift() || { ok: true };
    if (behavior.fail) {
      this.aborted = true; // failed statement poisons the txn
      throw behavior.fail;
    }
    return behavior.result ?? { rowCount: 1 };
  }
}

function naturalKeyViolation() {
  const e = new Error('duplicate key value violates unique constraint');
  e.code = '23505';
  e.constraint = 'idx_listings_natural_key';
  return e;
}

test('success path: releases the savepoint and returns fn result', async () => {
  const c = new FakeClient().enqueue({ result: { rowCount: 1 } });
  const r = await withSavepoint(c, () => c.query('INSERT ...'));
  assert.equal(r.rowCount, 1);
  assert.equal(c.log.length, 3);
  assert.match(c.log[0], /^SAVEPOINT /);
  assert.equal(c.log[1], 'INSERT ...');
  assert.match(c.log[2], /^RELEASE SAVEPOINT /);
  assert.equal(c.aborted, false);
});

test('failure path: rolls back to the savepoint, lifts the abort, rethrows original error', async () => {
  const c = new FakeClient().enqueue({ fail: naturalKeyViolation() });
  await assert.rejects(
    () => withSavepoint(c, () => c.query('INSERT ...')),
    (err) => err.code === '23505' && err.constraint === 'idx_listings_natural_key'
  );
  // Abort was cleared by ROLLBACK TO SAVEPOINT, so the txn is usable again.
  assert.equal(c.aborted, false);
  const after = await c.query('SELECT 1');
  assert.equal(after.rowCount, 1);
  assert.ok(c.log.some(s => /^ROLLBACK TO SAVEPOINT/i.test(s.trim())));
  assert.ok(c.log.some(s => /^RELEASE SAVEPOINT/i.test(s.trim())));
});

test('batch loop: a swallowed natural-key collision does NOT poison later rows', async () => {
  // Models the listing upsert running inside the catalog page transaction:
  // row 1 collides on the natural key (23505, swallowed as duplicate_skipped),
  // rows 2 and 3 must still upsert cleanly.
  const c = new FakeClient()
    .enqueue({ fail: naturalKeyViolation() }) // row 1
    .enqueue({ result: { rowCount: 1 } })     // row 2
    .enqueue({ result: { rowCount: 1 } });    // row 3

  const results = [];
  for (let i = 0; i < 3; i++) {
    try {
      await withSavepoint(c, () => c.query('INSERT ...'), { inTransaction: true });
      results.push('upserted');
    } catch (err) {
      if (err.code === '23505' && err.constraint === 'idx_listings_natural_key') {
        results.push('duplicate_skipped'); // safe now: txn already rolled back to savepoint
      } else {
        throw err;
      }
    }
  }

  assert.deepEqual(results, ['duplicate_skipped', 'upserted', 'upserted']);
  assert.equal(c.aborted, false);
  // The bug signature must never appear.
  assert.ok(!c.log.includes(ABORT_MSG));
});

test('regression witness: WITHOUT a savepoint, the same collision wedges the batch', async () => {
  // Reproduces the incident. Row 1 aborts the txn; row 2 then throws the exact
  // incident error. This is what withSavepoint prevents.
  const c = new FakeClient()
    .enqueue({ fail: naturalKeyViolation() }) // row 1 aborts txn
    .enqueue({ result: { rowCount: 1 } });    // row 2 never gets a clean run

  // Row 1: caught + swallowed, but NO savepoint rollback → txn stays aborted.
  try {
    await c.query('INSERT row1');
  } catch (err) {
    assert.equal(err.code, '23505'); // swallowed as "duplicate_skipped"
  }
  // Row 2: dies with the incident error.
  await assert.rejects(() => c.query('INSERT row2'), (err) => err.message === ABORT_MSG);
});

test('non-transaction callers run fn directly with no savepoint statements', async () => {
  const c = new FakeClient().enqueue({ result: { rowCount: 1 } });
  const r = await withSavepoint(c, () => c.query('INSERT ...'), { inTransaction: false });
  assert.equal(r.rowCount, 1);
  assert.deepEqual(c.log, ['INSERT ...']); // no SAVEPOINT / RELEASE emitted
});

test('non-unique errors still propagate after rolling back the savepoint', async () => {
  const notNull = new Error('null value in column violates not-null constraint');
  notNull.code = '23502';
  const c = new FakeClient().enqueue({ fail: notNull });
  await assert.rejects(
    () => withSavepoint(c, () => c.query('INSERT ...')),
    (err) => err.code === '23502'
  );
  assert.equal(c.aborted, false); // rolled back, so caller's rethrow aborts cleanly
});
