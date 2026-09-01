'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createOrderedRelease } = require('../orderedRelease');

const tick = () => new Promise((r) => setImmediate(r));

test('flushes strictly in index order even when arrivals are out of order', async () => {
  const release = createOrderedRelease(3);
  const flushed = [];
  // Arrive 2, then 1, then 0 — flushes must still run 0, 1, 2.
  release.arrive(2, async () => { flushed.push(2); return 'c'; });
  release.arrive(1, async () => { flushed.push(1); return 'b'; });
  await tick();
  assert.deepEqual(flushed, [], 'nothing flushes before slot 0 arrives');
  release.arrive(0, async () => { flushed.push(0); return 'a'; });
  const outcomes = await release.done();
  assert.deepEqual(flushed, [0, 1, 2]);
  assert.deepEqual(outcomes.map(o => o.flushed), [true, true, true]);
  assert.deepEqual(outcomes.map(o => o.value), ['a', 'b', 'c']);
});

test('a null arrival (failed buy) releases its slot immediately', async () => {
  const release = createOrderedRelease(3);
  const flushed = [];
  release.arrive(1, null);                                  // failed buy
  release.arrive(2, async () => { flushed.push(2); });
  release.arrive(0, async () => { flushed.push(0); });
  const outcomes = await release.done();
  assert.deepEqual(flushed, [0, 2]);
  assert.deepEqual(outcomes[1], { flushed: false, empty: true });
});

test('a throwing flushFn is contained and does not stall later slots', async () => {
  const release = createOrderedRelease(2);
  const flushed = [];
  release.arrive(0, async () => { throw new Error('printer exploded'); });
  release.arrive(1, async () => { flushed.push(1); });
  const outcomes = await release.done();
  assert.equal(outcomes[0].flushed, false);
  assert.equal(outcomes[0].error.message, 'printer exploded');
  assert.deepEqual(flushed, [1]);
});

test('total of 0 resolves immediately', async () => {
  const release = createOrderedRelease(0);
  assert.deepEqual(await release.done(), []);
});

test('double arrive on the same slot is a no-op', async () => {
  const release = createOrderedRelease(1);
  let calls = 0;
  release.arrive(0, async () => { calls += 1; });
  release.arrive(0, async () => { calls += 100; });
  await release.done();
  assert.equal(calls, 1);
});
