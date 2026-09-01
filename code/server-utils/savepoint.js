'use strict';
/**
 * withSavepoint — run a write inside a Postgres SAVEPOINT so a *caught* error
 * (e.g. a swallowed unique-violation) does NOT poison the caller's open
 * transaction.
 *
 * WHY THIS EXISTS
 * ---------------
 * When a statement fails inside a Postgres transaction, the ENTIRE transaction
 * enters the aborted state — every subsequent statement on that connection
 * throws `current transaction is aborted, commands ignored until end of
 * transaction block` until a ROLLBACK. Catching the error in JavaScript does
 * NOT un-abort the server-side transaction.
 *
 * So the common pattern "try an INSERT, catch the unique-violation, treat it as
 * a benign no-op, keep going" is only safe OUTSIDE a transaction (each pooled
 * query auto-commits). Inside a caller-supplied transaction it is a trap: the
 * swallow succeeds in JS but the connection is already poisoned, and the NEXT
 * statement — often for the next row in a batch loop — dies with the aborted-
 * transaction error, which is what surfaces to the caller.
 *
 * That is exactly how a nightly channel-catalog sync job wedged in production:
 * the listing upsert caught a natural-key `23505` (not covered by its
 * `ON CONFLICT` target) and returned `'duplicate_skipped'`, but the per-page
 * catalog transaction was already aborted, so every remaining product on the
 * page failed with `current transaction is aborted…`.
 *
 * THE FIX
 * -------
 * Wrap the risky statement in a SAVEPOINT. On success, RELEASE it. On failure,
 * ROLLBACK TO the savepoint (which clears ONLY that statement's effects and
 * lifts the aborted state) and RELEASE it, then rethrow the ORIGINAL error so
 * the caller can decide to swallow (now safely) or propagate. The transaction
 * stays alive and usable for the next statement.
 *
 * No-transaction callers (a bare pool) pass `inTransaction: false` and the fn
 * runs directly — savepoints are meaningless without an enclosing transaction,
 * and a pooled query never poisons anything.
 *
 * Dependency-free on purpose (no db module / `pg` import): `runner` is any
 * object with an async `query(sql)` method, which keeps this unit-testable
 * without a live DB.
 */

let savepointSeq = 0;

/**
 * @param {{query: (sql: string) => Promise<any>}} runner  pg client (in a txn) or pool
 * @param {() => Promise<T>} fn                             the write to attempt
 * @param {{inTransaction?: boolean}} [opts]               savepoint only when true (default true)
 * @returns {Promise<T>} fn's resolved value
 * @template T
 */
async function withSavepoint(runner, fn, { inTransaction = true } = {}) {
  if (!inTransaction) return fn();

  // Unique name so nested/looped use never collides.
  const name = `_cl_sp_${++savepointSeq}`;
  await runner.query(`SAVEPOINT ${name}`);
  try {
    const result = await fn();
    await runner.query(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (err) {
    // Undo just this statement and lift the aborted state, then release the
    // savepoint so it doesn't accumulate across a batch loop. Rethrow the
    // original error — the caller decides swallow-vs-propagate on a live txn.
    await runner.query(`ROLLBACK TO SAVEPOINT ${name}`);
    await runner.query(`RELEASE SAVEPOINT ${name}`);
    throw err;
  }
}

module.exports = { withSavepoint };
