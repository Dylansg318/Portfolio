'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { trackingCandidates, isValidMod10 } = require('../trackingScan');

// Fixtures mirror the SHAPE of real carrier output captured from production
// label ZPL — the ^FD structure, the AI layout, the lengths — but every number
// here is SYNTHETIC, with valid check digits recomputed so the gates under test
// still gate. If a carrier changes its barcode, re-capture a real label's ^FD
// (and re-sanitize it) rather than editing these to match new code — the point
// of the fixture is that it is the carrier's output shape.

const GS = '\x1d';

// ── USPS — the carrier this whole file exists for ────────────────────────────

test('USPS: GS1-128 with separators intact yields the stored IMpb', () => {
  // What zxing emits with ASSUME_GS1 on: symbology id, AI (420) ZIP+4, GS, IMpb.
  const scanned = `]C1420234567890${GS}9200123456789000000013`;
  const keys = trackingCandidates(scanned);
  assert.ok(keys.includes('9200123456789000000013'), keys.join(','));
});

test('USPS: the flattened form (FNC1 dropped) still resolves, via ZIP-9', () => {
  // What zxing emits WITHOUT ASSUME_GS1 — one undelimited 34-digit run.
  const keys = trackingCandidates('4202345678909200123456789000000013');
  assert.ok(keys.includes('9200123456789000000013'), keys.join(','));
  // The ZIP-5 split of this same payload is 26 digits — a LEGAL IMpb length —
  // and is rejected only because its prefix is 7890, not 9x. That is the guard
  // doing the work; if it is ever relaxed, this assertion is what fails.
  assert.ok(!keys.includes('78909200123456789000000013'), keys.join(','));
});

test('USPS: a label scanned off the bench resolves', () => {
  // (420)543210987(92)00987654321000000006 — the AI-92 element is the tail of a
  // 22-digit IMpb whose first two digits ARE the "92", not a separate AI value.
  const keys = trackingCandidates('4205432109879200987654321000000006');
  assert.ok(keys.includes('9200987654321000000006'), keys.join(','));
});

test('USPS: a bare 22- or 26-digit IMpb passes through untouched', () => {
  assert.ok(trackingCandidates('9200123456789000000013').includes('9200123456789000000013'));
  // 26-digit form (9-digit Mailer ID) — rare in the data, but real.
  assert.ok(trackingCandidates('92001500000000000000001239').includes('92001500000000000000001239'));
});

// ── FedEx ────────────────────────────────────────────────────────────────────

test('FedEx: the 34-digit "96" barcode yields its trailing 12-digit tracking', () => {
  const keys = trackingCandidates('9610203040506070809000770011223344');
  assert.ok(keys.includes('770011223344'), keys.join(','));
  // Two-piece shipment off the same ZPL — the sibling piece must NOT appear.
  assert.ok(!keys.includes('770011223355'), keys.join(','));
});

test('FedEx: a bare 12-digit number is offered literally', () => {
  assert.deepEqual(trackingCandidates('770011223344'), ['770011223344']);
});

// ── UPS — already worked; these lock it so a refactor cannot break it ────────

test('UPS: a bare 1Z number is the literal candidate', () => {
  assert.deepEqual(trackingCandidates('1Z999AA10123456784'), ['1Z999AA10123456784']);
});

test('UPS: a 1Z embedded in a longer message is extracted', () => {
  const keys = trackingCandidates('000012345678901[)>\x1e01\x1d961Z999AA10123456784');
  assert.ok(keys.includes('1Z999AA10123456784'), keys.join(','));
});

test('UPS: lowercase input is normalised to the stored casing', () => {
  assert.ok(trackingCandidates('1z999aa10123456784').includes('1Z999AA10123456784'));
});

// ── The refusals: what must NOT be derived ───────────────────────────────────

test('a packing-slip order barcode derives nothing but itself', () => {
  // The marketplace order number our own packing slip prints. If this ever
  // grows a second candidate, some rule below has started guessing.
  assert.deepEqual(trackingCandidates('12345678'), ['12345678']);
});

test('an ordinary UPC-A donates no suffix to FedEx', () => {
  assert.deepEqual(trackingCandidates('012345678905'), ['012345678905']);
});

test('a long numeric payload that is not a 96-form keeps its digits', () => {
  // 34 digits, but starting 12 rather than 96 — no trailing-12 extraction.
  const keys = trackingCandidates('1210203040506070809000770011223344');
  assert.deepEqual(keys, ['1210203040506070809000770011223344']);
});

test('an IMpb-shaped payload with a broken check digit is refused', () => {
  // Same 22-digit label with the last digit walked one. A mis-decoded frame is
  // exactly this shape, and it must not become a lookup key.
  const keys = trackingCandidates('9200123456789000000014');
  assert.deepEqual(keys, ['9200123456789000000014']); // literal only, not re-derived
});

test('empty and junk input never throw', () => {
  assert.deepEqual(trackingCandidates(''), []);
  assert.deepEqual(trackingCandidates(null), []);
  assert.deepEqual(trackingCandidates(undefined), []);
  assert.deepEqual(trackingCandidates('   '), []);
});

// ── The check digit itself ───────────────────────────────────────────────────

test('isValidMod10 is length-agnostic across the IMpb lengths', () => {
  assert.equal(isValidMod10('9200123456789000000013'), true);      // 22
  assert.equal(isValidMod10('9200987654321000000006'), true);      // 22
  assert.equal(isValidMod10('92001500000000000000001239'), true);  // 26
  assert.equal(isValidMod10('9200123456789000000014'), false);     // walked
  assert.equal(isValidMod10('abc'), false);
  assert.equal(isValidMod10(''), false);
});


// ── The ZIP-5 / ZIP-9 ambiguity, pinned ─────────────────────────────────────
// Measured on real data: 60 of 10,000 ZIP+4 add-ons (0.60%) make the WRONG
// split pass both the IMpb prefix and the mod-10 check. That is not rare enough
// to wave away, so what this pins is the two properties that make it harmless —
// the real tracking is still produced, and it is produced FIRST.
test('when both ZIP splits survive, the real IMpb is still offered and ranks first', () => {
  // zip9 = 100009010; the ZIP-5 split 90109200123456789000000013 is 26 digits,
  // starts 90, and passes mod-10 — it survives every gate this module has.
  const keys = trackingCandidates('4201000090109200123456789000000013');
  const real = keys.indexOf('9200123456789000000013');
  const spurious = keys.indexOf('90109200123456789000000013');
  assert.ok(real > -1, 'the real IMpb must be a candidate');
  assert.ok(spurious > -1, 'the ambiguous split is deliberately offered too, not silently dropped');
  assert.ok(real < spurious,
    `ZIP-9 is tried first so the real tracking outranks the ambiguous one (real@${real}, spurious@${spurious})`);
  // …and the literal scan still leads, per the lookupKeys doctrine.
  assert.equal(keys[0], '4201000090109200123456789000000013');
});
