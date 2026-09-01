'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { trimToLimit } = require('../trimToLimit');

test('returns short text unchanged', () => {
  assert.equal(trimToLimit('GAUZE 2x2', 80), 'GAUZE 2x2');
});

test('cuts at a word boundary, never mid-word', () => {
  assert.equal(trimToLimit('ALPHA BRAVO CHARLIE DELTA', 16), 'ALPHA BRAVO');
});

test('does not leave trailing whitespace', () => {
  assert.equal(trimToLimit('ALPHA BRAVO   CHARLIE', 13), 'ALPHA BRAVO');
});

test('hard-cuts when the first word alone exceeds the limit', () => {
  assert.equal(trimToLimit('SUPERCALIFRAGILISTIC', 5), 'SUPER');
});

test('appends no ellipsis', () => {
  assert.ok(!trimToLimit('ALPHA BRAVO CHARLIE', 11).includes('…'));
});

test('handles nullish and non-string input', () => {
  assert.equal(trimToLimit(null, 10), '');
  assert.equal(trimToLimit(undefined, 10), '');
});

test('respects an exact-length fit', () => {
  assert.equal(trimToLimit('ABCDE', 5), 'ABCDE');
});
