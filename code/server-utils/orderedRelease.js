'use strict';

// In-order release chain for bulk-buy physical prints. Buys run concurrently,
// but the print agent claims print jobs strictly oldest-first, so the printed
// stack order equals INSERTION order — slot i's print enqueue must wait for
// slots 0..i-1. A failed buy arrives with null and releases its slot
// immediately (the stack just skips it — nothing downstream shifts relative
// order). A flushFn error is contained per-slot: a bought label must never
// stall every later label's print.
//
// Built as a pre-chained promise ladder (gate i resolves on arrive(i)) so
// there is no drain-loop re-entrancy to get wrong.
function createOrderedRelease(total) {
  const outcomes = new Array(total);
  const resolvers = new Array(total);
  const gates = Array.from({ length: total }, (_, i) => new Promise((resolve) => { resolvers[i] = resolve; }));

  let chain = Promise.resolve();
  for (let i = 0; i < total; i++) {
    chain = chain
      .then(() => gates[i])
      .then(async (flushFn) => {
        if (typeof flushFn === 'function') {
          try { outcomes[i] = { flushed: true, value: await flushFn() }; }
          catch (error) { outcomes[i] = { flushed: false, error }; }
        } else {
          outcomes[i] = { flushed: false, empty: true };
        }
      });
  }
  const donePromise = chain.then(() => outcomes);

  return {
    // Resolving an already-resolved promise is a no-op, so double-arrive is safe.
    arrive(index, flushFn) { resolvers[index](flushFn || null); },
    done: () => donePromise,
  };
}

module.exports = { createOrderedRelease };
