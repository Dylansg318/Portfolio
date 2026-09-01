'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { customerReference, orderNumberFromReference } = require('../orderReference');

/**
 * All values in this file are SYNTHETIC. The rule being guarded is asymmetric on
 * purpose: one marketplace's channel order ids are 8 bare digits, and so are the
 * base numbers of a few real order numbers (which always carry a storefront
 * suffix). Any heuristic that accepts a bare 8-digit token will eventually stamp
 * a CHANNEL id into an order column, and a wrong join on money data is worse than
 * no join at all.
 */

describe('customerReference', () => {
  test('keeps what the carrier printed, joined the way FedEx prints it', () => {
    assert.equal(customerReference('55443322', '1234567'), '55443322 / 1234567');
    assert.equal(customerReference('55443322 / 1234567'), '55443322 / 1234567');
  });

  test('drops blanks and does not repeat a value UPS wrote into both ref slots', () => {
    assert.equal(customerReference('', '1234567'), '1234567');
    assert.equal(customerReference('1234567', '1234567'), '1234567');
    assert.equal(customerReference(null, undefined, '  '), null);
  });
});

describe('orderNumberFromReference', () => {
  test('takes the trailing token of a FedEx-style reference', () => {
    assert.equal(orderNumberFromReference('55443322 / 1234567'), '1234567');
    // Dash-formatted channel id on the left — still positional, still fine.
    assert.equal(orderNumberFromReference('12-34567-89012 / 1234568'), '1234568');
    // A date-shaped channel id carries a dash and a slash-free tail.
    assert.equal(orderNumberFromReference('07232026-1 / 1234569'), '1234569');
  });

  test('UPS: prefers ref2 (our order number) over ref1 (the channel id)', () => {
    assert.equal(orderNumberFromReference('1234567', '55443322'), '1234567');
  });

  test('REJECTS a bare 8-digit token — that is a channel order id, not an order', () => {
    assert.equal(orderNumberFromReference('55443322'), null);
    assert.equal(orderNumberFromReference('55443311'), null);
    // …but the suffixed marketplace-derived order numbers are real and must pass.
    assert.equal(orderNumberFromReference('51234567-STOREA'), '51234567-STOREA');
    assert.equal(orderNumberFromReference('51234568-STB'), '51234568-STB');
  });

  test('accepts a reship-suffixed order number', () => {
    assert.equal(orderNumberFromReference('1234567-Rabc12def'), '1234567-Rabc12def');
  });

  test('returns null for the references that legitimately carry no order', () => {
    // Seen in the wild on a real FedEx export: inbound vendor freight, duty
    // invoices, account-level fees. These are NOT failures.
    assert.equal(orderNumberFromReference('NO REFERENCE INFORMATION'), null);
    assert.equal(orderNumberFromReference('D12345'), null);
    assert.equal(orderNumberFromReference('D12345 - 5 L3S/3 22M'), null);
    assert.equal(orderNumberFromReference('ABC-0017'), null);
    assert.equal(orderNumberFromReference('123456'), null); // 6 digits — below the 1000001 floor
    assert.equal(orderNumberFromReference(''), null);
    assert.equal(orderNumberFromReference(null, undefined), null);
  });

  test('falls through the candidates in order and stops at the first that qualifies', () => {
    assert.equal(orderNumberFromReference(null, '55443322', '1234567'), '1234567');
  });
});
