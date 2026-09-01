'use strict';

// Cases mirror real packages scanned on the warehouse bench plus the traps that
// made them unscannable — with every product identifier replaced by a synthetic
// one of the same shape (check digits recomputed). Every one of these shapes
// used to resolve to nothing (or to the wrong key) before scanPayload.ts existed.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseScanPayload,
  bindablePayload,
  bindingKeys,
  canonicalGtin,
  gtinLookupKeys,
  isValidGtinCheckDigit,
} = require('../scanPayload');

// ── GTIN canonicalization ────────────────────────────────────────────────────

test('canonicalGtin collapses UPC-A / EAN-13 / GTIN-14 forms of one number', () => {
  assert.equal(canonicalGtin('633712000015'), '00633712000015');   // UPC-A, retail bag
  assert.equal(canonicalGtin('0633712000015'), '00633712000015');  // EAN-13 form
  assert.equal(canonicalGtin('00633712000015'), '00633712000015'); // GTIN-14 form
});

test('canonicalGtin rejects a bad check digit and a non-GTIN length', () => {
  assert.equal(canonicalGtin('633712000016'), null); // last digit bumped
  assert.equal(canonicalGtin('12345'), null);
  assert.equal(canonicalGtin('SKU-042-0023'), null);
});

test('isValidGtinCheckDigit accepts three retail bag UPCs', () => {
  for (const upc of ['633712000015', '633712000022', '633712000039']) {
    assert.equal(isValidGtinCheckDigit(upc), true, upc);
  }
});

test('gtinLookupKeys only offers shorter forms whose dropped digits are zeros', () => {
  assert.deepEqual(gtinLookupKeys('00633712000015'), ['00633712000015', '0633712000015', '633712000015']);
  // 4001234000008 is 13 digits — there is no 12-digit form of it.
  assert.deepEqual(gtinLookupKeys('04001234000008'), ['04001234000008', '4001234000008']);
});

// ── Plain retail barcodes (a retail-packed accessory bag) ────────────────────

test('a bare UPC-A resolves through every stored length-form', () => {
  const p = parseScanPayload('633712000015');
  assert.equal(p.gs1, null);
  assert.equal(p.gtin, '00633712000015');
  assert.deepEqual(p.lookupKeys, ['633712000015', '00633712000015', '0633712000015']);
});

test('THE FALSE POSITIVE: a UPC-A starting 01 is not GS1', () => {
  // Number system 0 is the most common US UPC prefix. The old parser read
  // "01" as AI (01) and looked up '2345678905'.
  const p = parseScanPayload('012345678905');
  assert.equal(p.gs1, null);
  assert.equal(p.gtin, '00012345678905');
  assert.ok(p.lookupKeys.includes('012345678905'));
});

test('scanner terminators and whitespace never reach the lookup', () => {
  assert.deepEqual(parseScanPayload('  633712000015\r\n').lookupKeys[0], '633712000015');
});

// ── GS1-128 (a serialized electronic-device carton) ──────────────────────────

const SERIALIZED = '010400123400000821S0000001A1'; // (01)04001234000008(21)S0000001A1

test('a serialized GS1-128 carton yields the GTIN, not the serial', () => {
  const p = parseScanPayload(SERIALIZED);
  assert.equal(p.gs1.gtin, '04001234000008');
  assert.equal(p.gs1.serial, 'S0000001A1');
  assert.equal(p.gtin, '04001234000008');
  assert.deepEqual(p.lookupKeys.slice(1), ['04001234000008', '4001234000008']);
});

test('EVERY UNIT OF THE SAME PRODUCT BINDS TO ONE ROW', () => {
  // This is the whole point: two cartons, two serials, one stored payload.
  const a = bindablePayload(parseScanPayload('010400123400000821S0000001A1'));
  const b = bindablePayload(parseScanPayload('010400123400000821S0000002B2'));
  assert.equal(a, b);
  assert.equal(a, '04001234000008');
});

test('the parentheses form printed under the bars parses identically', () => {
  const parens = parseScanPayload('(01)04001234000008(21)S0000001A1');
  assert.equal(parens.gtin, '04001234000008');
  assert.equal(parens.gs1.serial, 'S0000001A1');
});

test('an AIM symbology identifier is stripped', () => {
  assert.equal(parseScanPayload(']C1' + SERIALIZED).gtin, '04001234000008');
  assert.equal(parseScanPayload(']d20105012345000008').gtin, '05012345000008');
});

test('a GTIN that fails its own check digit is offered raw, never length-forged', () => {
  // 05012345000009 is one digit off. We will not invent 12/13-digit variants of
  // a number we cannot verify, but a binding already made on it still resolves.
  const p = parseScanPayload('0105012345000009');
  assert.equal(p.gtin, null);
  assert.equal(p.gs1.gtin, '05012345000009');
  assert.ok(p.lookupKeys.includes('05012345000009'));
  assert.ok(!p.lookupKeys.includes('5012345000009'));
});

// ── GS1 DataMatrix UDI (a UDI-labeled healthcare carton) ─────────────────────

test('a UDI DataMatrix with production date, expiry and lot yields all four', () => {
  // (01) GTIN (11) prod date (17) expiry (10) lot — a common UDI label shape.
  const p = parseScanPayload(']d2' + '01' + '00614141000036' + '11' + '251201' + '17' + '281130' + '10' + '240815');
  assert.equal(p.gtin, '00614141000036');
  assert.equal(p.gs1.exp_date, '2028-11-30');
  assert.equal(p.gs1.lot, '240815');
});

test('a GS-terminated lot followed by another AI keeps parsing', () => {
  const p = parseScanPayload('0105012345000009' + '10' + 'ABC123' + '\x1d' + '17' + '280930');
  assert.equal(p.gs1.lot, 'ABC123');
  assert.equal(p.gs1.exp_date, '2028-09-30');
});

test('a printable GS substitute is treated as a real GS', () => {
  const p = parseScanPayload('0105012345000009' + '10' + 'ABC123' + '{GS}' + '17' + '280930');
  assert.equal(p.gs1.lot, 'ABC123');
  assert.equal(p.gs1.exp_date, '2028-09-30');
});

// ── HIBC (the OTHER healthcare standard) ─────────────────────────────────────

test('a HIBC label binds its PRIMARY, not the lot in its secondary', () => {
  // +EACM401521/$01983+ — labeler EACM, product 40152, UoM 1, lot 01983.
  const p = parseScanPayload('+EACM401521/$01983+');
  assert.equal(p.hibc.primary, '+EACM401521');
  assert.equal(p.hibc.lot, '01983');
  assert.equal(bindablePayload(p), '+EACM401521');
});

test('TWO LOTS OF ONE PRODUCT BIND TO ONE ROW', () => {
  const a = bindablePayload(parseScanPayload('+EACM401521/$01983+'));
  const b = bindablePayload(parseScanPayload('+EACM401521/$07741+'));
  assert.equal(a, b);
});

test('the $$ date+lot form is read as a lot, and the date is NOT guessed', () => {
  // A wrong expiry is worse than no expiry: the $$ date layout is declared by
  // the digits that follow and we do not infer it.
  const p = parseScanPayload('+EDMO502010/$$24010101X');
  assert.equal(p.hibc.primary, '+EDMO502010');
  assert.equal(p.hibc.lot, '24010101');
  assert.equal(p.hibc.exp_date, null);
});

test('a HIBC serial ($$+) is a unit fact and never the binding', () => {
  const p = parseScanPayload('+EACM401521/$$+SER12345X');
  assert.equal(p.hibc.serial, 'SER12345');
  assert.equal(bindablePayload(p), '+EACM401521');
});

test('a primary-only HIBC scan resolves to the same key as a primary+lot scan', () => {
  const withLot = parseScanPayload('+EACM401521/$01983+');
  const primaryOnly = parseScanPayload('+EACM401521');
  assert.ok(withLot.lookupKeys.includes('+EACM401521'));
  assert.equal(bindablePayload(primaryOnly), '+EACM401521');
});

test('a payload that merely starts with + is not mangled into HIBC', () => {
  const p = parseScanPayload('+12/34');
  assert.equal(p.hibc, null);
  assert.deepEqual(p.lookupKeys, ['+12/34']);
});

// ── Things that must NOT become a product key ───────────────────────────────

test('a bare serial barcode carries no GTIN and binds as itself', () => {
  const p = parseScanPayload('S0000001A1');
  assert.equal(p.gtin, null);
  assert.equal(p.gs1, null);
  assert.deepEqual(p.lookupKeys, ['S0000001A1']);
});

test('an internally generated label is passed through untouched', () => {
  const p = parseScanPayload('SKU-042-0023');
  assert.equal(p.cleaned, 'SKU-042-0023');
  assert.equal(p.gtin, null);
  assert.deepEqual(p.lookupKeys, ['SKU-042-0023']);
});

test('an unknown AI stops the walk instead of slicing at a guessed offset', () => {
  // (01) then (8004) — a 4-digit AI this table does not carry.
  const p = parseScanPayload('01040012340000088004SOMETHINGELSE');
  assert.equal(p.gtin, '04001234000008');
  assert.equal(p.gs1.lot, null);
});

test('predefined-length 3- and 4-digit AIs do not abort the walk', () => {
  // (01) GTIN (3103) net weight kg (10) lot — a logistics-label shape.
  const p = parseScanPayload('01' + '04001234000008' + '3103' + '001250' + '10' + 'LOT9');
  assert.equal(p.gtin, '04001234000008');
  assert.equal(p.gs1.lot, 'LOT9');
});

test('the paren form uses the LABEL\'s own AI boundaries, so any AI length works', () => {
  // (8004) is 4-digit and variable — unwalkable as a raw stream, unambiguous here.
  const p = parseScanPayload('(01)04001234000008(8004)ABC123(21)S0000001A1');
  assert.equal(p.gtin, '04001234000008');
  assert.equal(p.gs1.serial, 'S0000001A1');
});

test('an unassigned AI is not in the fixed table — a non-GS1 payload is not read as a GS1 record', () => {
  // 03 and 04 are unassigned; treating them as fixed-length made a payload like
  // this report a GS1 record with every field null.
  const p = parseScanPayload('03ABCDEFGHIJKLMN');
  assert.equal(p.gs1, null);
  assert.deepEqual(p.lookupKeys, ['03ABCDEFGHIJKLMN']);
});

test('no control byte survives into a stored binding', () => {
  const p = parseScanPayload('(01)04001234000008(21)S0000001A1');
  assert.ok(!p.cleaned.includes('\x1d'));
  for (const key of p.lookupKeys) assert.ok(!key.includes('\x1d'), key);
});

test('bindingKeys is literal-first and carries the form that will be stored', () => {
  const parsed = parseScanPayload('633712000015');
  assert.deepEqual(bindingKeys(parsed), ['633712000015', '00633712000015', '0633712000015']);

  const gs1 = parseScanPayload('010400123400000821S0000001A1');
  const keys = bindingKeys(gs1);
  assert.equal(keys[0], '010400123400000821S0000001A1'); // exactly what was scanned
  assert.ok(keys.includes(bindablePayload(gs1)));        // and the form we store
});

test('empty input yields no keys rather than an empty-string key', () => {
  assert.deepEqual(parseScanPayload('').lookupKeys, []);
  assert.deepEqual(parseScanPayload(null).lookupKeys, []);
  assert.deepEqual(parseScanPayload('   ').lookupKeys, []);
});

// ── Our own rack label is not a GS1 element string ───────────────────────────
//
// The label renderer prints the internal SKU verbatim under the bars, so the
// payload the warehouse scans is `106-1283`. Every item code starts `106-`, and
// `10` is AI (10) BATCH/LOT — variable length, so the walker swallowed the rest
// and reported a lot of `6-1283`. Nothing writes that value, but it was rendered
// on the Scan page's no-match panel and the barcode-capture preview: a
// fabricated lot number on a screen someone acts on.
//
// This is the same class as the `012345678905` UPC-A false positive in the
// header — a product code whose first two digits collide with an AI. The guard
// there only covered all-digit payloads.
test('our rack-label item code is a product code, not AI (10) batch/lot', () => {
  const p = parseScanPayload('106-1283');
  assert.equal(p.gs1, null);
  assert.equal(p.cleaned, '106-1283');
  assert.equal(p.gtin, null);
  // Still resolvable: lookup keys off the literal payload, which is the sku.
  assert.ok(p.lookupKeys.includes('106-1283'));
});

test('a variable-length AI still parses when something ANCHORS it as GS1', () => {
  // 1. the scanner declared the symbology
  assert.equal(parseScanPayload(']C1' + '10' + 'ABC123').gs1.lot, 'ABC123');
  // 2. a real multi-element string, separated
  assert.equal(parseScanPayload('10' + 'ABC123' + '\x1d' + '17' + '280930').gs1.lot, 'ABC123');
  // 3. the printed parenthesised form declares its own boundaries
  assert.equal(parseScanPayload('(10)ABC123').gs1.lot, 'ABC123');
  // 4. opening with a predefined-length AI, the ordinary carton shape
  assert.equal(parseScanPayload('0105012345000009' + '10' + 'ABC123').gs1.lot, 'ABC123');
});

test('refusing to read a bare variable-AI payload as GS1 changes no lookup key', () => {
  // The literal is what resolves a product; only the invented lot goes away.
  const p = parseScanPayload('21SERIAL9');
  assert.equal(p.gs1, null);
  assert.deepEqual(p.lookupKeys, ['21SERIAL9']);
});
