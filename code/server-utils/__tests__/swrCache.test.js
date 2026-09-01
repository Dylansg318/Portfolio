'use strict';
// Run: node --import tsx --test __tests__/swrCache.test.js
// (module under test is swrCache.ts — needs the tsx loader)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSwrCache } = require('../swrCache');

const tick = () => new Promise(r => setImmediate(r));

test('concurrent first calls share a single compute', async () => {
  let calls = 0;
  const cache = createSwrCache({ ttlMs: 1000 });
  const compute = async () => { calls++; await tick(); return { n: calls }; };
  const [a, b, c] = await Promise.all([
    cache.get('u1', compute), cache.get('u1', compute), cache.get('u1', compute),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(a, { n: 1 });
  assert.deepEqual(b, { n: 1 });
  assert.deepEqual(c, { n: 1 });
});

test('within TTL returns cached value without recompute', async () => {
  let calls = 0;
  let t = 0;
  const cache = createSwrCache({ ttlMs: 1000, now: () => t });
  const compute = async () => { calls++; return calls; };
  assert.equal(await cache.get('k', compute), 1);
  t = 999;
  assert.equal(await cache.get('k', compute), 1);
  assert.equal(calls, 1);
});

test('after TTL serves stale immediately and refreshes in background', async () => {
  let calls = 0;
  let t = 0;
  const cache = createSwrCache({ ttlMs: 1000, now: () => t });
  const compute = async () => { calls++; const n = calls; await tick(); await tick(); return n; };
  assert.equal(await cache.get('k', compute), 1);
  t = 2000;
  // Stale hit: instant old value, one background recompute kicked off.
  assert.equal(await cache.get('k', compute), 1);
  assert.equal(await cache.get('k', compute), 1); // second stale hit doesn't double-refresh
  await tick(); await tick();
  assert.equal(calls, 2);
  assert.equal(await cache.get('k', compute), 2); // refreshed value now served
});

test('background refresh failure keeps the stale value', async () => {
  let calls = 0;
  let t = 0;
  const cache = createSwrCache({ ttlMs: 1000, now: () => t });
  const compute = async () => {
    calls++;
    if (calls > 1) throw new Error('upstream down');
    return 'good';
  };
  assert.equal(await cache.get('k', compute), 'good');
  t = 2000;
  assert.equal(await cache.get('k', compute), 'good');
  await tick(); await tick();
  assert.equal(await cache.get('k', compute), 'good'); // still serving stale, no throw
  assert.ok(calls >= 2);
});

test('first-call failure rejects and does not poison the cache', async () => {
  let calls = 0;
  const cache = createSwrCache({ ttlMs: 1000 });
  const compute = async () => {
    calls++;
    if (calls === 1) throw new Error('boom');
    return 'ok';
  };
  await assert.rejects(() => cache.get('k', compute), /boom/);
  assert.equal(await cache.get('k', compute), 'ok');
  assert.equal(calls, 2);
});

test('keys are independent and maxEntries evicts oldest', async () => {
  const cache = createSwrCache({ ttlMs: 1000, maxEntries: 2 });
  assert.equal(await cache.get('a', async () => 'A'), 'A');
  assert.equal(await cache.get('b', async () => 'B'), 'B');
  assert.equal(await cache.get('c', async () => 'C'), 'C'); // evicts 'a'
  let recomputed = 0;
  assert.equal(await cache.get('a', async () => { recomputed++; return 'A2'; }), 'A2');
  assert.equal(recomputed, 1);
});
