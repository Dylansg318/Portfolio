'use strict';

/**
 * Parser: the FedEx invoice PDF that FedEx Billing Online EMAILS us.
 *
 * WHY THIS EXISTS: the CSV lane needs a human in a browser. The PDF arrives on its
 * own at the billing mailbox the day the invoice is cut, and carries the same
 * per-shipment detail — tracking, service, zone, both weights, recipient, delivery
 * date, our own order reference, and every charge component. That makes zero-touch
 * FedEx ingestion possible.
 *
 * THE CSV REMAINS AUTHORITATIVE WHERE BOTH EXIST, and this parser is built to lose
 * that argument gracefully:
 *   · the CSV carries structured dimensions, POD fields and ~210 columns; the PDF
 *     states dimensions only in a prose sentence and only when dim weight applied;
 *   · the CSV's account number is real, the PDF's is MASKED — this parser emits
 *     `account_number: null` plus the mask verbatim in `account_masked`, and lets
 *     the ingestion layer resolve it against the known-accounts table (the mask
 *     reveals the account's trailing digits, which makes that lookup
 *     deterministic). Storing the mask AS the account would overwrite a real
 *     number a CSV import already holds and would not join to anything;
 *   · a CSV column cannot drift out of alignment. A PDF column can.
 *
 * HOW THE TEXT ARRIVES. pdf-parse gives no column layout, but the underlying
 * document (OpenText Exstream) emits a run of LABELS followed by a run of VALUES in
 * the same order, per two-column region:
 *
 *     Tracking ID / Service Type / Zone / Packages / Actual Weight
 *     770123456789 / Ppd, Domestic / 8 / 1 / 20.9 lbs
 *
 * The label set VARIES between shipments — the last block of one real invoice omits
 * Actual Weight and lists Rated Weight instead — so labels are read, never assumed.
 *
 * WHAT PROTECTS AGAINST SILENT MISALIGNMENT. Charges arrive the same way: a run of
 * names, then a run of amounts, then `Total ChargeUSD$14.33`. We pair them by
 * position working BACKWARD from that total, and then FOOT EVERY SHIPMENT: the
 * amounts must sum to the shipment's own stated Total Charge. A block that does not
 * foot is not guessed at — it is counted in `stats.unfooted` and skipped, which
 * leaves the invoice total short, which turns the invoice red in the UI. The
 * residual risk this cannot catch is two charge NAMES swapped while their amounts
 * still sum correctly; the amounts, the shipment totals and the invoice total are
 * all verified, the individual name-to-amount attribution is positional.
 */

const defaultRefHelpers = require('./orderReference');

const clean = v => { const s = String(v == null ? '' : v).trim(); return s === '' ? null : s; };
const money = v => {
  const n = Number(String(v == null ? '' : v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

const MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
/** "Aug 04, 2026" → "2026-08-04" */
function date(v) {
  const m = /([A-Z][a-z]{2})\s+(\d{1,2}),\s*(\d{4})/.exec(String(v || ''));
  return m && MONTHS[m[1]] ? `${m[3]}-${MONTHS[m[1]]}-${String(m[2]).padStart(2, '0')}` : null;
}

// A bare number, possibly negative, possibly with thousands separators: an amount.
const AMOUNT_RE = /^-?[\d,]+\.\d{2}$/;
const TRACKING_RE = /^\d{12,}$/;

/**
 * THE INVOICE NUMBER IS HYPHENATED IN THE PDF AND NOT IN THE CSV — "1-234-56789"
 * vs "123456789". They are the same invoice, and the invoices table is unique on
 * (carrier, invoice_number), so failing to normalise would file the same bill twice
 * under two numbers and double every total built on top of it.
 */
const normalizeInvoiceNumber = s => String(s || '').replace(/[^0-9]/g, '') || null;

function detect(text) {
  const t = String(text);
  // Deliberately narrow: this must not claim a FedEx Billing Online CSV export,
  // which is identified by its own header row and handled by a separate parser.
  return /Invoice Number/.test(t) && /Cust\. Ref\.:/.test(t) && /Total Charge\s*USD/.test(t);
}

/**
 * Pair a run of labels with the run of values that follows it.
 * @returns {Object} label → value, only for labels that got a value.
 */
function zipLabels(labels, values) {
  const out = {};
  for (let i = 0; i < labels.length && i < values.length; i++) out[labels[i]] = values[i];
  return out;
}

/** Everything between one `Ship Date:` and the next is one shipment. */
function splitShipmentBlocks(lines) {
  const starts = [];
  lines.forEach((l, i) => { if (/^Ship Date:/.test(l)) starts.push(i); });
  return starts.map((s, i) => lines.slice(s, i + 1 < starts.length ? starts[i + 1] : lines.length));
}

function parseShipmentBlock(block, stats, refHelpers) {
  const { customerReference, orderNumberFromReference } = refHelpers;
  const text = block.join('\n');

  const shipDate = date((/^Ship Date:\s*(.+)$/m.exec(text) || [])[1]);
  const ref = clean((/Cust\. Ref\.:\s*(.*)$/m.exec(text) || [])[1]);
  const payor = clean((/^Payor:\s*(.+)$/m.exec(text) || [])[1]);
  // Two renderings in the same document: "DeliveredAug 04, 2026" glued on one line,
  // or "Delivered" as a label whose value sits further down its own value run. The
  // label form is resolved below, once the runs are zipped; this catches the glued one.
  const deliveredGlued = date((/Delivered\s*([A-Z][a-z]{2}\s+\d{1,2},\s*\d{4})/.exec(text) || [])[1]);

  // ── the Tracking ID label/value region ──────────────────────────────────────
  const tIdx = block.findIndex(l => l === 'Tracking ID');
  if (tIdx === -1) return null;
  const labels = [];
  let i = tIdx;
  for (; i < block.length; i++) {
    const l = block[i];
    if (TRACKING_RE.test(l)) break;          // first value — the label run is over
    if (l) labels.push(l);
  }
  const values = block.slice(i, i + labels.length);
  const f = zipLabels(labels, values);

  // A SECOND label/value run trails the charge block on most shipments:
  //     Total ChargeUSD$14.33 / Rated Weight / Delivered / 21 lbs / Aug 04, 2026
  // Without this, Rated Weight is simply absent — and an absent billed weight that
  // reads as 0 is a NULL-rate trap: in an earlier audit, NULL rates coalesced to
  // $0 turned a true +1.34% carrier variance into a fake +6.46%.
  const totalLine = block.findIndex(l => /^Total Charge\s*USD/.test(l));
  if (totalLine !== -1) {
    const tail = block.slice(totalLine + 1).filter(Boolean);
    const split = tail.findIndex(l => /^[\d$-]/.test(l));
    if (split > 0) Object.assign(f, zipLabels(tail.slice(0, split), tail.slice(split)));
  }

  const tracking = clean(f['Tracking ID']);
  if (!tracking || !TRACKING_RE.test(tracking)) return null;

  // A multi-piece block lists more than one tracking id. We do NOT guess at how its
  // charges divide — it is reported and skipped so the invoice foots short and goes
  // red, rather than silently attributing a whole shipment's cost to one piece.
  const extraTracking = block.slice(i + labels.length).filter(l => TRACKING_RE.test(l) && l !== tracking);
  if (extraTracking.length) { stats.multiPieceSkipped++; return null; }

  // ABSENT MUST BE null, NOT 0. money('') is 0, and a weight of zero pounds silently
  // becomes "billed lighter than entered" in every downstream comparison.
  const weight = (k) => {
    const raw = clean(f[k]);
    return raw == null ? null : money(raw.replace(/lbs?/i, ''));
  };
  const recipientIdx = block.findIndex(l => /^Recipient\s*$/.test(l));
  const recipient = recipientIdx === -1 ? [] : block.slice(recipientIdx + 1, recipientIdx + 3).map(clean);

  // ── charges: work BACKWARD from the shipment's own stated total ──────────────
  const totalIdx = block.findIndex(l => /^Total Charge\s*USD/.test(l));
  if (totalIdx === -1) { stats.noTotal++; return null; }
  const statedTotal = money((/Total Charge\s*USD\s*\$?(-?[\d,]+\.\d{2})/.exec(block[totalIdx]) || [])[1]);

  const amounts = [];
  let a = totalIdx - 1;
  for (; a >= 0 && AMOUNT_RE.test(block[a]); a--) amounts.unshift(money(block[a]));
  const names = block.slice(a - amounts.length + 1, a + 1).map(clean);

  if (!amounts.length || names.length !== amounts.length || names.some(n => !n || AMOUNT_RE.test(n))) {
    stats.unpairable++;
    return null;
  }
  // FOOT THE SHIPMENT. This is the check that makes a positional pairing safe to
  // store: if the pairing slipped, the sum almost never survives.
  if (statedTotal == null || Math.abs(round2(amounts.reduce((x, y) => x + y, 0)) - statedTotal) >= 0.005) {
    stats.unfooted++;
    return null;
  }

  return {
    tracking_number: tracking,
    ship_date: shipDate,
    delivered: date(f['Delivered']) || deliveredGlued,
    service: clean(f['Service Type']),
    zone: clean(f['Zone']),
    entered_weight: weight('Actual Weight'),
    billed_weight: weight('Rated Weight'),
    recipient_name: recipient[0] || null,
    recipient_city_state_zip: recipient[1] || null,
    payor,
    customer_reference: customerReference(ref),
    reference_order_number: orderNumberFromReference(ref),
    charges: names.map((n, k) => ({ description: n, amount: amounts[k] })),
    stated_total: statedTotal,
  };
}

/**
 * @param {string} text — the PDF's extracted text (e.g. pdf-parse output).
 * @param {object} [opts]
 * @param {string} [opts.fileName] — recorded on the invoice for provenance.
 * @param {object} [opts.refHelpers] — { customerReference, orderNumberFromReference };
 *   defaults to ./orderReference. Supply your own to match your order-number scheme.
 * @returns {{invoices: Array, lines: Array, stats: object}} — the same shape the CSV
 *   parsers return, so the ingestion layer persists a PDF exactly like a CSV.
 */
function parseFedexInvoicePdf(text, { fileName = null, refHelpers = defaultRefHelpers } = {}) {
  const lines = String(text).split('\n').map(l => l.trim());
  const stats = { shipments: 0, lines: 0, multiPieceSkipped: 0, unfooted: 0, unpairable: 0, noTotal: 0 };

  const invoiceNumber = normalizeInvoiceNumber((/Invoice Number\s*\n\s*([\d-]+)/.exec(text) || [])[1]);
  if (!invoiceNumber) return { invoices: [], lines: [], stats };

  const invoiceDate = date((/Invoice Date\s*\n\s*([A-Z][a-z]{2}\s+\d{1,2},\s*\d{4})/.exec(text) || [])[1]);
  const statedTotal = money((/TOTAL THIS INVOICE\s*USD\s*\$?(-?[\d,]+\.\d{2})/.exec(text) || [])[1]);
  // "Payments not received by Aug 22, 2026 are subject to a late fee."
  const dueDate = date((/Payments not received by\s*([A-Z][a-z]{2}\s+\d{1,2},\s*\d{4})/.exec(text) || [])[1]);
  // The PDF masks the account number. Emitting the mask AS the account would
  // overwrite the real number a CSV import stored and would join to nothing — so
  // `account_number` stays null and the mask is carried separately for the ingestion
  // layer to resolve against the known-accounts table. The mask reveals the account's
  // TRAILING digits (e.g. 123456789 → XXXX-X678-9), which is what makes that lookup
  // deterministic.
  const account = null;
  // Accept `*` and lowercase masks too: the capture, not the resolver, is the limiter
  // here — a mask shape this regex misses lands the invoice with a NULL account even
  // though the downstream resolver would have handled the string fine.
  const accountMasked = clean((/Account Number\s*\n\s*([Xx*][\dXx*-]*\d)/.exec(text) || [])[1]);

  const invoice = {
    carrier: 'FedEx',
    account_number: account,
    account_masked: accountMasked,
    invoice_number: invoiceNumber,
    invoice_date: invoiceDate,
    due_date: dueDate,
    currency: 'USD',
    stated_total: statedTotal,
    source_file: fileName,
  };

  const out = [];
  for (const block of splitShipmentBlocks(lines)) {
    const s = parseShipmentBlock(block, stats, refHelpers);
    if (!s) continue;
    stats.shipments++;
    for (const c of s.charges) {
      out.push({
        invoice_number: invoiceNumber,
        carrier: 'FedEx',
        account_number: account,
        tracking_number: s.tracking_number,
        master_tracking_number: null,
        charge_category: null,
        charge_code: null,
        charge_description: c.description,
        net_amount: c.amount,
        ship_date: s.ship_date,
        service: s.service,
        zone: s.zone,
        entered_weight: s.entered_weight,
        entered_weight_unit: s.entered_weight == null ? null : 'LBS',
        billed_weight: s.billed_weight,
        billed_weight_unit: s.billed_weight == null ? null : 'LBS',
        recipient_name: s.recipient_name,
        recipient_company: null,
        recipient_addr1: null,
        recipient_addr2: null,
        recipient_city: null,
        recipient_state: null,
        recipient_zip: null,
        payor: s.payor,
        customer_reference: s.customer_reference,
        reference_order_number: s.reference_order_number,
        // The PDF has no source ROW to keep, so keep the derived shipment facts the
        // columns above cannot hold — delivery date, the raw recipient line.
        raw: {
          source: 'fedex_invoice_pdf',
          delivered: s.delivered,
          recipient_line: s.recipient_city_state_zip,
          shipment_total: s.stated_total,
        },
      });
      stats.lines++;
    }
  }

  return { invoices: [invoice], lines: out, stats };
}

module.exports = { parseFedexInvoicePdf, detect, _internals: { normalizeInvoiceNumber, parseShipmentBlock, splitShipmentBlocks } };
