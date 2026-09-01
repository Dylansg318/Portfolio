// Run: node --import tsx --test __tests__/pMapLimit.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pMapLimit } = require('../pMapLimit');

test('preserves order and caps concurrency', async () => {
  let inFlight = 0, maxInFlight = 0;
  const fn = async (x) => {
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise(r => setTimeout(r, 5));
    inFlight--;
    return x * 2;
  };
  const out = await pMapLimit([1,2,3,4,5,6,7,8,9,10], 3, fn);
  assert.deepEqual(out, [2,4,6,8,10,12,14,16,18,20]);
  assert.ok(maxInFlight <= 3);
});

test('empty input returns empty array', async () => {
  assert.deepEqual(await pMapLimit([], 4, async () => 1), []);
});

test('rejects on first error (Promise.all semantics)', async () => {
  await assert.rejects(pMapLimit([1,2,3], 2, async (x) => {
    if (x === 2) throw new Error('boom');
    return x;
  }), /boom/);
});
