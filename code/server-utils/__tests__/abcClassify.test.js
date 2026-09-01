'use strict';
// Run: node --import tsx --test __tests__/abcClassify.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { assignAbcClasses } = require('../abcClassify');

const P = (id, revenue_velocity, current_class = null) => ({ id, revenue_velocity, current_class });
const classOf = (updates, id) => updates.find((u) => u.id === id).newClass;
const counts = (updates) => updates.reduce((acc, u) => {
  acc[u.newClass] = (acc[u.newClass] || 0) + 1; return acc;
}, {});

test('splits the demand set 20/30/50 by rank', () => {
  const products = Array.from({ length: 10 }, (_, i) => P(`p${i}`, 100 - i));
  const out = assignAbcClasses(products, { aPct: 20, bPct: 30 });
  assert.deepEqual(counts(out), { A: 2, B: 3, C: 5 });
  assert.equal(classOf(out, 'p0'), 'A');   // highest revenue
  assert.equal(classOf(out, 'p9'), 'C');   // lowest
});

// THE REGRESSION. Before the fix the percentile ran over the whole sellable
// catalog, so a 20% A bucket over 27,215 products (5,443 slots) was wider than
// the 3,721 products that carry demand — and every seller came out A.
test('zero-revenue products do not consume A/B slots', () => {
  const sellers = Array.from({ length: 10 }, (_, i) => P(`sell${i}`, 100 - i));
  const dead = Array.from({ length: 90 }, (_, i) => P(`dead${i}`, 0));
  const out = assignAbcClasses([...sellers, ...dead], { aPct: 20, bPct: 30 });

  // 20% of 10 sellers = 2 A, not 20% of 100 rows = 20 A.
  assert.equal(out.filter((u) => u.newClass === 'A').length, 2);
  assert.equal(out.filter((u) => u.newClass === 'B').length, 3);
  for (const d of dead) assert.equal(classOf(out, d.id), 'C');
});

test('a dead catalog cannot make every seller class A', () => {
  // The shape of the real catalog: 3,721 sellers among 27,215 sellable rows.
  const sellers = Array.from({ length: 3721 }, (_, i) => P(`s${i}`, 3721 - i));
  const dead = Array.from({ length: 23494 }, (_, i) => P(`d${i}`, 0));
  const out = assignAbcClasses([...sellers, ...dead], { aPct: 20, bPct: 30 });
  const c = counts(out);
  assert.equal(c.A, 745);                       // ceil(3721 * 0.20)
  assert.equal(c.B, 1117);                      // ceil(3721 * 0.30)
  assert.equal(c.C, 3721 - 745 - 1117 + 23494); // the rest, plus the dead
  // The whole point: A is a small slice, not "everything that sells".
  assert.ok(c.A < sellers.length / 4);
});

test('zero-revenue products floor to C, never null and never B', () => {
  const out = assignAbcClasses([P('a', 10), P('z', 0)], { aPct: 20, bPct: 30 });
  assert.equal(classOf(out, 'z'), 'C');
  assert.notEqual(classOf(out, 'z'), null);
});

test('only products with demand are flagged for reclassification review', () => {
  const out = assignAbcClasses([P('a', 10), P('z', 0)], { aPct: 20, bPct: 30 });
  assert.equal(out.find((u) => u.id === 'a').ranked, true);
  assert.equal(out.find((u) => u.id === 'z').ranked, false);
});

test('negative revenue is treated as no demand, not as top rank', () => {
  const out = assignAbcClasses(
    [P('credit', -500), P('real', 10), P('zero', 0)],
    { aPct: 20, bPct: 30 },
  );
  assert.equal(classOf(out, 'credit'), 'C');
  assert.equal(out.find((u) => u.id === 'credit').ranked, false);
  assert.equal(classOf(out, 'real'), 'A');
});

test('does not depend on the caller ordering its input', () => {
  const asc = [P('lo', 1), P('mid', 50), P('hi', 100)];
  // 33/33 over 3 products = ceil(0.99) = one slot each.
  const out = assignAbcClasses(asc, { aPct: 33, bPct: 33 });
  assert.equal(classOf(out, 'hi'), 'A');
  assert.equal(classOf(out, 'mid'), 'B');
  assert.equal(classOf(out, 'lo'), 'C');
});

test('numeric strings from pg numeric columns rank correctly', () => {
  const out = assignAbcClasses(
    [P('a', '9.50'), P('b', '100.00'), P('c', '0')],
    { aPct: 50, bPct: 50 },
  );
  assert.equal(classOf(out, 'b'), 'A');
  assert.equal(classOf(out, 'a'), 'B');
  assert.equal(classOf(out, 'c'), 'C');
});

test('null / undefined / NaN revenue is no demand', () => {
  const out = assignAbcClasses(
    [P('n', null), P('u', undefined), P('x', 'not-a-number'), P('real', 5)],
    { aPct: 20, bPct: 30 },
  );
  for (const id of ['n', 'u', 'x']) {
    assert.equal(classOf(out, id), 'C');
    assert.equal(out.find((u) => u.id === id).ranked, false);
  }
  assert.equal(classOf(out, 'real'), 'A');
});

test('a catalog with no demand at all classifies everything C without throwing', () => {
  const out = assignAbcClasses([P('a', 0), P('b', 0)], { aPct: 20, bPct: 30 });
  assert.deepEqual(counts(out), { C: 2 });
});

test('empty input returns empty', () => {
  assert.deepEqual(assignAbcClasses([], { aPct: 20, bPct: 30 }), []);
});

test('carries the current class through for the reclassification diff', () => {
  const out = assignAbcClasses([P('a', 10, 'B'), P('z', 0, null)], { aPct: 20, bPct: 30 });
  assert.equal(out.find((u) => u.id === 'a').currentClass, 'B');
  assert.equal(out.find((u) => u.id === 'z').currentClass, null);
});

test('every product in the input gets exactly one class back', () => {
  const products = Array.from({ length: 50 }, (_, i) => P(`p${i}`, i % 3 === 0 ? 0 : i));
  const out = assignAbcClasses(products, { aPct: 20, bPct: 30 });
  assert.equal(out.length, products.length);
  assert.equal(new Set(out.map((u) => u.id)).size, products.length);
  for (const u of out) assert.ok(['A', 'B', 'C'].includes(u.newClass));
});
