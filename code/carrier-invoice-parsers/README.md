# Carrier Invoice Parsers

> Extracted from a private production ERP; identifiers, endpoints and fixtures have been sanitized.

Pure parsers — `(text) → { invoices, lines, stats }` — for the two billing feeds a small e-commerce operation actually receives from its parcel carriers. They exist to answer one question continuously: **did the carrier bill what we were quoted at label-buy time?** Both emit the same output shape so a downstream ingestion layer can persist a PDF exactly like a CSV. No database code is included here (the ingestion layer was deliberately left behind in the extraction); the parsers are side-effect-free and unit-testable.

```
carrier-invoice-parsers/
├── upsBillingDataFile.js   UPS Billing Data File v2.1 (the headerless 250-field "CSV")
├── fedexInvoicePdf.js      the FedEx invoice PDF that Billing Online emails
├── orderReference.js       order-number extraction from the shipper-reference field
└── __tests__/              node:test suites with fully synthetic fixtures
```

Run the tests: `npm test` (`node --test`, no install needed for the tested modules; `csv-parse` is required only by the UPS parser itself).

## UPS Billing Data File v2.1 — `upsBillingDataFile.js`

What UPS Billing Center exports as a "CSV" is nothing of the sort: **headerless, exactly 250 RFC4180 fields per row**, with quoted fields containing commas. A naive `split(',')` yields 250–254 columns and silently corrupts rows, so the parser uses a real RFC4180 parser and **rejects any row that is not exactly 250 fields wide** rather than guessing at alignment.

**The column indices were derived empirically, not read from a spec.** With no header row, which of 250 anonymous fields is the billed amount? The derivation: sum every numeric column per invoice number and compare each sum against the invoice's *own stated total*, across ten real invoices. **Field 52 was the only column that matched all ten invoices to the penny.** The file's comments instruct future maintainers to re-derive the same way if UPS ever changes the layout — an empirical match against the carrier's own totals beats trusting a published spec that may not describe the export you actually receive.

Other shapes it handles: one shipment produces many rows (freight, fuel, and each accessorial separately, repeated per piece), so reconciliation must roll up to the shipment; rows whose "tracking id" is not a `1Z` number are account-level fees (weekly printer rental) and are stored with tracking `NULL` so they never appear as mystery unmatched labels.

## FedEx invoice PDF — `fedexInvoicePdf.js`

The CSV lane needs a human in a browser; the PDF arrives by email on its own the day the invoice is cut, carrying the same per-shipment detail — which makes zero-touch ingestion possible. The parser exploits how the document generator (OpenText Exstream) linearizes its two-column regions: **a run of LABELS followed by a run of VALUES in the same order**. Labels are read, never assumed — the label set genuinely varies between shipments on one invoice.

Two design decisions worth stealing:

- **Foot every shipment.** Charges are paired positionally (names run, then amounts run, working backward from the printed `Total Charge`). Positional pairing is only safe because every block is then *footed*: the amounts must sum to the shipment's own stated total. A block that does not foot is counted and skipped — the invoice then foots short and turns red in the UI, instead of quietly recording a plausible wrong number. Multi-piece blocks are likewise skipped rather than guessed at.
- **A masked account number is not an account number.** The PDF masks the account; the CSV's is real and authoritative. The parser deliberately emits `account_number: null` and carries the mask verbatim in a separate `account_masked` field, so it *cannot* clobber the real number a CSV import already stored (the mask's trailing digits let the ingestion layer resolve it against known accounts deterministically). The same discipline applies to weights: absent is `null`, never `0` — a zero-pound billed weight silently reads as "billed lighter than entered" in every downstream comparison.

It also normalizes the invoice number (hyphenated in the PDF, bare in the CSV — same bill, and a uniqueness key downstream), and treats the CSV as authoritative wherever both exist.

## Order-reference extraction — `orderReference.js`

Both carriers echo back what was handed to them at label-buy time: channel order id first, our order number last. The helper takes the **trailing** token and accepts it only in a shape a bare channel id cannot have — because one marketplace's channel ids are 8 bare digits, any "looks like an order number" digit-count heuristic would eventually stamp a channel id into an order column, and a wrong join on money data is worse than no join.

These patterns encode one business's numbering scheme, so both parsers accept a **caller-supplied replacement** via their `refHelpers` option (`{ customerReference, orderNumberFromReference }`); the included module is just the default.

## Fixtures

No real invoice files are included. The test fixtures reproduce the *structure* pdf-parse emits (label run / value run / charge run / total) with every name, address, tracking number, account mask, and reference synthesized.
