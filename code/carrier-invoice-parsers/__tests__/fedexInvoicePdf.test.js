'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseFedexInvoicePdf, detect } = require('../fedexInvoicePdf');

/**
 * These fixtures are the SHAPE pdf-parse actually returns for a FedEx invoice PDF —
 * a run of LABELS followed by a run of VALUES — with every identifier, name, and
 * address replaced by synthetic values. The real-world validation behind the shape:
 * a 35-page production invoice parsed by this code was verified line-for-line
 * against the same invoice's CSV export (197/197 shipments identical).
 *
 * What is being guarded is not the happy path. It is that a positional pairing
 * REFUSES rather than guesses: a shipment whose charges do not sum to its own
 * printed total must be dropped and counted, so the invoice foots short and turns
 * red, instead of quietly recording a plausible wrong number.
 */

const shipment = ({ ref = '55443322 / 1234567', tracking = '770123456789', charges = [['Transportation Charge', '44.86'], ['Discount', '-26.02'], ['Grace Discount', '-5.83'], ['Fuel Surcharge', '1.32']], total = '14.33', extraTracking = null } = {}) => [
  `Ship Date: Jul 24, 2026`,
  `Payor: Shipper`,
  `Cust. Ref.: ${ref}`,
  `Dept.#: `,
  `P.O.#: `,
  `Tracking ID`,
  `Service Type`,
  `Zone`,
  `Packages`,
  `Actual Weight`,
  tracking,
  `Ppd, Domestic`,
  `8`,
  `1`,
  `20.9 lbs`,
  `Sender    `,
  `SHIPPING DEPARTMENT`,
  `ANYTOWN VA 20100-1234-56`,
  `Recipient`,
  `JANE SAMPLE`,
  `SPRINGFIELD IL 62701-1234-56`,
  ...(extraTracking ? [extraTracking] : []),
  ...charges.map(c => c[0]),
  ...charges.map(c => c[1]),
  `Total ChargeUSD$${total}`,
  `Rated Weight`,
  `Delivered`,
  `21 lbs`,
  `Aug 04, 2026`,
].join('\n');

const invoice = (body) => [
  ``,
  `Invoice Number`,
  `1-234-56789`,
  `Account Number`,
  `XXXX-X678-9`,
  `Invoice Date`,
  `Aug 07, 2026`,
  `Page`,
  `1 of 35`,
  `Payments not received by Aug 22, 2026 are subject to a late fee. `,
  `Invoice Summary`,
  `Total ChargesUSD$14.33`,
  `TOTAL THIS INVOICEUSD$14.33`,
  body,
].join('\n');

test('detect claims the emailed PDF but never the FedEx CSV export', () => {
  const pdfText = invoice(shipment());
  assert.equal(detect(pdfText), true);

  // The CSV lane's header row must never be claimed by the PDF parser.
  const csvHeader = '"Invoice Number","Bill to Account Number","Express or Ground Tracking ID","Net Charge Amount"\n"123456789","123456789","770123456789","14.33"';
  assert.equal(detect(csvHeader), false);
});

test('the hyphenated PDF invoice number is normalised to the CSV form', () => {
  // "1-234-56789" and "123456789" are the same bill. The invoices table is unique
  // on (carrier, invoice_number), so failing to normalise files it twice and
  // doubles every total built on top of it.
  const { invoices } = parseFedexInvoicePdf(invoice(shipment()), { fileName: 'x.pdf' });
  assert.equal(invoices[0].invoice_number, '123456789');
  assert.equal(invoices[0].invoice_date, '2026-08-07');
  assert.equal(invoices[0].due_date, '2026-08-22');
  assert.equal(invoices[0].stated_total, 14.33);
});

test('the masked account is emitted as null plus the mask, never as the account', () => {
  // Storing the mask as account_number would overwrite the real account a CSV
  // import already put there and would join to nothing. The mask still has to
  // travel: the ingestion layer resolves it against the known-accounts table by
  // its trailing digits — and before that existed, the null hit a NOT NULL
  // constraint and every emailed invoice was silently dropped.
  const { invoices } = parseFedexInvoicePdf(invoice(shipment()), {});
  assert.equal(invoices[0].account_number, null);
  assert.equal(invoices[0].account_masked, 'XXXX-X678-9');
});

test('a footing shipment yields one line per charge, with our order number', () => {
  const { lines, stats } = parseFedexInvoicePdf(invoice(shipment()), {});
  assert.equal(stats.shipments, 1);
  assert.equal(lines.length, 4);
  assert.deepEqual(lines.map(l => l.charge_description),
    ['Transportation Charge', 'Discount', 'Grace Discount', 'Fuel Surcharge']);
  assert.deepEqual(lines.map(l => l.net_amount), [44.86, -26.02, -5.83, 1.32]);
  assert.equal(lines[0].tracking_number, '770123456789');
  assert.equal(lines[0].reference_order_number, '1234567');
  assert.equal(lines[0].customer_reference, '55443322 / 1234567');
  assert.equal(lines[0].ship_date, '2026-07-24');
  assert.equal(lines[0].entered_weight, 20.9);
  assert.equal(lines[0].billed_weight, 21);
  assert.equal(lines[0].raw.delivered, '2026-08-04');
});

test('a shipment whose charges do NOT sum to its printed total is DROPPED and counted', () => {
  // The whole safety net. A silent 1-position slip in the pairing would otherwise
  // attribute real money to the wrong charge name and still look fine.
  const bad = shipment({ total: '99.99' }); // charges sum to 14.33, not 99.99
  const { lines, stats } = parseFedexInvoicePdf(invoice(bad), {});
  assert.equal(lines.length, 0);
  assert.equal(stats.unfooted, 1);
  assert.equal(stats.shipments, 0);
});

test('a multi-piece block is skipped rather than guessed at', () => {
  const multi = shipment({ extraTracking: '770123456790' });
  const { lines, stats } = parseFedexInvoicePdf(invoice(multi), {});
  assert.equal(lines.length, 0);
  assert.equal(stats.multiPieceSkipped, 1);
});

test('a reference with no order token still yields the charge lines', () => {
  // Inbound vendor freight and duty invoices legitimately carry no order.
  const { lines, stats } = parseFedexInvoicePdf(invoice(shipment({ ref: 'NO REFERENCE INFORMATION' })), {});
  assert.equal(stats.shipments, 1);
  assert.equal(lines[0].reference_order_number, null);
  assert.equal(lines[0].customer_reference, 'NO REFERENCE INFORMATION');
});

test('label sets vary between shipments — Rated Weight only, no Actual Weight', () => {
  // Real invoices do this: the final block of the validated production invoice
  // lists Rated Weight in the label run and omits Actual Weight entirely.
  const block = [
    'Ship Date: Aug 03, 2026',
    'Payor: Shipper',
    'Cust. Ref.: 55443399 / 1234599',
    'Tracking ID', 'Service Type', 'Zone', 'Packages', 'Rated Weight',
    '770987654321', 'Home Delivery Ppd', '8', '1', '3 lbs',
    'Recipient', 'ALEX EXAMPLE', 'CENTERVILLE AZ 85300-1234-56',
    'Transportation Charge', 'Discount', 'Fuel Surcharge', 'Residential Delivery',
    '19.11', '-10.62', '1.12', '2.39',
    'Total ChargeUSD$12.00',
    'DeliveredAug 04, 2026',
  ].join('\n');

  const { lines, stats } = parseFedexInvoicePdf(invoice(block), {});
  assert.equal(stats.shipments, 1);
  assert.equal(lines.length, 4);
  assert.equal(lines[0].billed_weight, 3);
  assert.equal(lines[0].entered_weight, null);
  assert.equal(lines[0].reference_order_number, '1234599');
  assert.equal(lines[0].raw.delivered, '2026-08-04');
});
