'use strict';

/**
 * Parser: UPS Billing Data File v2.1 (what UPS Billing Center calls a "CSV").
 *
 * It is NOT a spreadsheet — headerless, exactly 250 comma-separated fields per
 * row, with quoted fields. A naive split(',') yields 250-254 columns and silently
 * corrupts rows, so this uses a real RFC4180 parser and drops anything that is not
 * exactly 250 wide rather than guessing at it.
 *
 * COLUMN INDICES WERE DERIVED, NOT REMEMBERED. Every numeric column was summed per
 * invoice number and compared against the invoice's own stated total; field 52 is
 * the only one that matched all ten invoices of a four-week pull to the penny. If
 * UPS ever changes the layout, re-derive the same way — do not "fix" these from a
 * published spec.
 *
 * One shipment produces MANY rows: freight, fuel, and each accessorial is its own
 * row, repeated per piece on a multi-piece shipment. That is why the reconciliation
 * view rolls up to the shipment before comparing to what we quoted.
 */

const { parse } = require('csv-parse/sync');
const defaultRefHelpers = require('./orderReference');

// 0-based indices into the 250-field row.
const F = {
  version: 0, account: 1, accountCountry: 3, invoiceDate: 4, invoiceNumber: 5,
  currency: 9, invoiceAmount: 10, shipDate: 11,
  leadShipmentNumber: 13, shipmentRef1: 15, shipmentRef2: 16, billOption: 17,
  packageQty: 18, tracking: 20, packageRef1: 21, packageRef2: 22,
  enteredWeight: 26, enteredWeightUnit: 27, billedWeight: 28, billedWeightUnit: 29,
  containerType: 30, enteredDims: 32, zone: 33,
  detailClass: 34, detailSubClass: 35,
  chargeCategory: 43, chargeCode: 44, chargeDescription: 45,
  publishedCharge: 48, incentive: 51, netAmount: 52, dueDate: 62,
  senderName: 67,
  recipientAttention: 74, recipientName: 75, recipientAddr1: 76, recipientAddr2: 77,
  recipientCity: 78, recipientState: 79, recipientZip: 80,
  adjustmentReason1: 174, adjustmentReason2: 175, adjustmentReason3: 176,
};
const EXPECTED_FIELDS = 250;

const clean = v => { const s = String(v == null ? '' : v).trim(); return s === '' ? null : s; };
const num = v => { const n = Number(String(v == null ? '' : v).replace(/[$,]/g, '')); return Number.isFinite(n) ? n : null; };
// UPS dates are already ISO (2026-08-01) in this export.
const date = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim()) ? String(v).trim() : null);

function detect(text) {
  const first = String(text).split('\n', 1)[0] || '';
  return /^"?2\.1"?,/.test(first);
}

/**
 * @param {string} text — the raw billing data file contents.
 * @param {object} [opts]
 * @param {string} [opts.fileName] — recorded on each invoice for provenance.
 * @param {object} [opts.refHelpers] — { customerReference, orderNumberFromReference };
 *   defaults to ./orderReference. Supply your own to match your order-number scheme.
 * @returns {{invoices: Array, lines: Array, stats: object}}
 *   invoices: one per distinct invoice number in the file
 *   lines:    every charge row, carrying invoiceNumber so ingestion can attach it
 */
function parseUpsBillingDataFile(text, { fileName = null, refHelpers = defaultRefHelpers } = {}) {
  const { customerReference, orderNumberFromReference } = refHelpers;
  const rows = parse(text, { relax_column_count: true, skip_empty_lines: true, bom: true });
  const stats = { rows: 0, malformed: 0, lines: 0 };
  const invoices = new Map();
  const lines = [];

  for (const row of rows) {
    stats.rows++;
    if (row.length !== EXPECTED_FIELDS) { stats.malformed++; continue; }
    const invoiceNumber = clean(row[F.invoiceNumber]);
    if (!invoiceNumber) { stats.malformed++; continue; }

    if (!invoices.has(invoiceNumber)) {
      invoices.set(invoiceNumber, {
        carrier: 'UPS',
        account_number: clean(row[F.account]),
        invoice_number: invoiceNumber,
        invoice_date: date(row[F.invoiceDate]),
        due_date: date(row[F.dueDate]),
        currency: clean(row[F.currency]) || 'USD',
        stated_total: num(row[F.invoiceAmount]),
        source_file: fileName,
      });
    }

    const tracking = clean(row[F.tracking]);
    const lead = clean(row[F.leadShipmentNumber]);
    // A row whose "tracking id" is not a 1Z is an account-level fee (the weekly
    // printer rental bills as one). Storing it with tracking NULL keeps it out of
    // the shipment comparison instead of showing up as a mystery unmatched label.
    const isShipment = tracking != null && /^1Z/i.test(tracking);

    lines.push({
      invoice_number: invoiceNumber,
      carrier: 'UPS',
      account_number: clean(row[F.account]),
      tracking_number: isShipment ? tracking : null,
      master_tracking_number: isShipment && lead && lead !== tracking ? lead : null,
      charge_category: clean(row[F.chargeCategory]),
      charge_code: clean(row[F.chargeCode]),
      // A blank description still has to be a description — the column is NOT NULL
      // and a nameless charge is a real thing on these files (5 rows / $299.70).
      charge_description: clean(row[F.chargeDescription])
        || clean(row[F.adjustmentReason1]) || '(unnamed charge)',
      net_amount: num(row[F.netAmount]) ?? 0,
      ship_date: date(row[F.shipDate]),
      service: clean(row[F.chargeDescription]),
      zone: clean(row[F.zone]),
      entered_weight: num(row[F.enteredWeight]),
      entered_weight_unit: clean(row[F.enteredWeightUnit]),
      billed_weight: num(row[F.billedWeight]),
      billed_weight_unit: clean(row[F.billedWeightUnit]),
      recipient_name: clean(row[F.recipientName]),
      recipient_company: clean(row[F.recipientAttention]),
      recipient_addr1: clean(row[F.recipientAddr1]),
      recipient_addr2: clean(row[F.recipientAddr2]),
      recipient_city: clean(row[F.recipientCity]),
      recipient_state: clean(row[F.recipientState]),
      recipient_zip: clean(row[F.recipientZip]),
      payor: clean(row[F.billOption]),
      // Our own order identity, as UPS recorded it at label-buy time. ref1 is the
      // channel order id, ref2 our order number; the package-level pair repeats the
      // shipment-level one on single-piece shipments and is the only one populated
      // on some multi-piece rows, so both are offered.
      customer_reference: customerReference(
        clean(row[F.shipmentRef1]) || clean(row[F.packageRef1]),
        clean(row[F.shipmentRef2]) || clean(row[F.packageRef2])
      ),
      reference_order_number: orderNumberFromReference(
        clean(row[F.shipmentRef2]), clean(row[F.packageRef2]),
        clean(row[F.shipmentRef1]), clean(row[F.packageRef1])
      ),
      raw: row,
    });
    stats.lines++;
  }
  return { invoices: [...invoices.values()], lines, stats };
}

module.exports = { parseUpsBillingDataFile, detect, _internals: { F, EXPECTED_FIELDS } };
