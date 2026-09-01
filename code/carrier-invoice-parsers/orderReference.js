'use strict';

/**
 * Pull OUR order identity off a carrier's shipper-reference field.
 *
 * Both carriers print what we handed them at label-buy time, in the same order —
 * marketplace/channel order id first, our own order number last:
 *   · FedEx `Original Customer Reference` → "55443322 / 1234567"
 *   · UPS   ref1 (field 15/21) = "55443322", ref2 (field 16/22) = "1234567"
 *
 * MEASURED on a real FedEx export (~2,000 rows) and a real UPS billing data file:
 * 98% of FedEx rows carry an order token; an evenly-spaced sample of 150 distinct
 * candidates resolved 150/150 against the orders table, across three sales
 * channels. The rows without one are legitimate — inbound vendor shipments,
 * customs-duty invoices, account-level fees like the weekly printer rental.
 *
 * WHY POSITIONAL AND NOT "the token that looks like an order number": one
 * marketplace's channel order ids are 8 bare digits, and so are the base numbers
 * of a handful of real order numbers (a few migrated orders carry an 8-digit base
 * plus a storefront suffix). Any digit-count heuristic that accepts a bare
 * 8-digit token will eventually stamp a CHANNEL id into an order column, and a
 * wrong join on money data is worse than no join. So: take the trailing token,
 * and accept it only in a shape a bare channel id cannot have.
 *
 * This module is the DEFAULT implementation. Both parsers accept a caller-supplied
 * replacement via their `refHelpers` option, because these patterns encode one
 * business's numbering scheme — swap in your own.
 */

// Real order numbers are 7 digits (1000001 upward — >99.9% of rows), plus a small
// suffixed tail: reship suffixes (1234567-Rabc12def) and the few migrated
// marketplace-derived ones (51234567-STOREA). A BARE 8-digit token is never an
// order number; it is a channel id. That asymmetry is the whole rule.
const ORDER_NUMBER_RE = /^(?:\d{7}(?:-[A-Za-z0-9]{1,12})?|\d{8}-[A-Za-z0-9]{1,12})$/;

const trim = v => String(v == null ? '' : v).trim();

/** The reference exactly as the carrier printed it. Parts join the way FedEx prints them. */
function customerReference(...parts) {
  const seen = [];
  for (const p of parts) {
    const s = trim(p);
    if (s && !seen.includes(s)) seen.push(s);
  }
  return seen.length ? seen.join(' / ') : null;
}

/**
 * @param {...string} candidates — most-likely-first (UPS: ref2 then ref1).
 *   A "/"-joined reference is split and only its LAST token considered, because
 *   that is the position our own label-buy writes the order number into.
 * @returns {string|null} the order number the CARRIER recorded, or null.
 */
function orderNumberFromReference(...candidates) {
  for (const c of candidates) {
    const s = trim(c);
    if (!s) continue;
    const tail = trim(s.split('/').pop());
    if (ORDER_NUMBER_RE.test(tail)) return tail;
  }
  return null;
}

module.exports = { customerReference, orderNumberFromReference, ORDER_NUMBER_RE };
