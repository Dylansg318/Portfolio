'use strict';
// Run: node --import tsx --test __tests__/businessDays.test.js
// (the module under test is businessDays.ts; tsx transpiles it on require.)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { addBusinessDays } = require('../businessDays');

test('adds business days within the same week', () => {
  // Wed 2026-05-13 + 2 -> Fri 2026-05-15
  const d = addBusinessDays(new Date('2026-05-13T12:00:00Z'), 2);
  assert.equal(d.toISOString().slice(0, 10), '2026-05-15');
});

test('skips the weekend', () => {
  // Thu 2026-05-14 + 2 -> Mon 2026-05-18 (Sat/Sun skipped)
  const d = addBusinessDays(new Date('2026-05-14T12:00:00Z'), 2);
  assert.equal(d.toISOString().slice(0, 10), '2026-05-18');
});

test('Friday + 2 business days lands on Tuesday', () => {
  // Fri 2026-05-15 + 2 -> Tue 2026-05-19
  const d = addBusinessDays(new Date('2026-05-15T12:00:00Z'), 2);
  assert.equal(d.toISOString().slice(0, 10), '2026-05-19');
});

test('starting on a Saturday, first business day is Monday', () => {
  // Sat 2026-05-16 + 2 -> Tue 2026-05-19
  const d = addBusinessDays(new Date('2026-05-16T12:00:00Z'), 2);
  assert.equal(d.toISOString().slice(0, 10), '2026-05-19');
});

test('does not mutate the input date', () => {
  const input = new Date('2026-05-13T12:00:00Z');
  addBusinessDays(input, 2);
  assert.equal(input.toISOString(), '2026-05-13T12:00:00.000Z');
});
