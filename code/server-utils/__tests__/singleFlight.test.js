// Run: node --import tsx --test __tests__/singleFlight.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeSingleFlight } = require('../singleFlight');

test('concurrent calls with same key run fn once; both get the result', async () => {
  const sf = makeSingleFlight();
  let calls = 0;
  const fn = async () => { calls++; await new Promise(r => setTimeout(r, 10)); return 'v'; };
  const [a, b] = await Promise.all([sf('k', fn), sf('k', fn)]);
  assert.equal(a, 'v'); assert.equal(b, 'v');
  assert.equal(calls, 1);
});

test('key is released after completion so a later call re-runs', async () => {
  const sf = makeSingleFlight();
  let calls = 0;
  const fn = async () => { calls++; return calls; };
  await sf('k', fn);
  await sf('k', fn);
  assert.equal(calls, 2);
});

test('different keys run independently', async () => {
  const sf = makeSingleFlight();
  let calls = 0;
  const fn = async () => { calls++; return calls; };
  await Promise.all([sf('a', fn), sf('b', fn)]);
  assert.equal(calls, 2);
});
