# Barcode payload parsers

Two zero-dependency TypeScript modules that turn what a barcode scanner *actually emits* into keys a database lookup can safely match — one for product barcodes, one for carrier shipping labels.

- **`scanPayload.ts`** — raw scanner payload → normalized product lookup keys. Handles plain GTINs (UPC-A / EAN-13 / GTIN-14 / GTIN-8), GS1-128 / GS1 DataMatrix element strings (full fixed-length AI table, patterned 3–4 digit AIs, variable AIs), and HIBC (the other healthcare labeling standard).
- **`trackingScan.ts`** — scanned carrier label barcode → candidate tracking numbers. Handles USPS IMpb (AI 420 ZIP then a 20/22/26/30-digit number), FedEx's 34-digit "96" form (tracking = last 12 digits), and UPS 1Z.

## The problem

A warehouse scan surface that compares the scanned string to a stored barcode with `=` is wrong in ways that only show up in production:

1. **One number, many printed lengths.** UPC-A is 12 digits, EAN-13 is 13, GS1 AI (01) carries 14 — all the same GTIN with leading zeros. The retail bag scans fine; the GS1-128 carton of the identical product misses every stored row.
2. **A GS1 payload is a record, not a key.** A serialized carton carries `(01)<GTIN>(21)<serial>` — GTIN plus a *per-unit* serial. Bound raw, every physical box becomes its own barcode row: the first unit "works", the second is unmapped, and review queues fill with one pending row per serial that no human can resolve. AI (21)/(10)/(17) are facts about the box in your hand; only the GTIN identifies the product. (HIBC has the identical trap with different syntax: the primary identifies the product, the secondary carries lot/expiry/serial.)
3. **Carrier barcodes wrap the tracking number in routing data.** Of the three major US carriers, only UPS prints the bare number a system stores. A USPS label's GS1-128 is `(420)<ZIP>` + the IMpb; FedEx's "96" barcode is 34 digits ending in the 12-digit tracking. Compared with `=`, tens of thousands of USPS labels produced "Nothing matched" — which an operator reads as "this parcel isn't in the system", the wrong answer about a parcel sitting right there.

## Design points worth reading

- **False-positive discipline.** An ordinary UPC-A starting `01` must not be parsed as AI (01) — number system 0 is the most common US UPC prefix. Bare 8/12/13/14-digit payloads short-circuit to plain-GTIN *before* any AI parsing runs. The same class of bug hit twice: internal SKUs starting `106-` were being read as AI (10) batch/lot, fabricating a lot number on screens people act on. The fix is an *anchoring* rule — a payload is only walked as GS1 when the scanner declared the symbology (`]C1`/`]d2`/`]e0`), a GS separator (0x1D) is present, or it opens with a predefined-length AI.
- **Refuse to guess.** An unknown AI stops the walk rather than slicing at a guessed offset; a GTIN failing its check digit is offered verbatim but never "canonicalized" into length-forms of a number that can't be verified; the HIBC `$$` date layout is not inferred (a wrong expiry is worse than no expiry). Every degradation lands on "literal-only lookup" — a miss, never a wrong product.
- **The FNC1 ambiguity, handled instead of assumed away.** Without `ASSUME_GS1`, decoders silently drop FNC1 separators, so a USPS label arrives as one undelimited digit run — ambiguous because AI (420) takes a 5- *or* 9-digit ZIP. Both splits are attempted, each gated on the IMpb prefix (`9[0-5]`) plus its mod-10 check digit. Measured against all 10,000 possible ZIP+4 add-ons, 0.6% of wrong splits survive both gates — so instead of picking one, *both* are offered as ordered candidates, with the structural argument for why the spurious one cannot collide with a real stored number documented in the code.
- **Ordering is part of the contract.** `lookupKeys` is literal-first: a row bound to exactly what the operator scanned always outranks anything derived. Callers match with `= ANY($keys)` and rank with `array_position($keys, …)` — never `LIMIT 1` on an unordered `ANY`.
- **Leading-zero folding without invention.** `gtinLookupKeys` only offers a shorter form when the digits it drops are all zeros — a 13-digit EAN with a nonzero first digit has no 12-digit form, and none is manufactured.
- **Scanner realities encoded.** AIM symbology-ID prefixes appear only after someone scans the wrong config barcode (stripped anyway, costs nothing); the GS byte may arrive raw or as a printable substitute (`{GS}`, `␝`) depending on wedge configuration; `String.trim()` does not remove 0x1D, and a control byte left on a stored binding can never be equaled by the wedge form of the same label.

## Tests

`__tests__/` contains the behavioral suites (Node's built-in `node:test` runner). In the source project they run under its test harness against the compiled TypeScript; they're included here as executable documentation of every trap above. All barcode values, GTINs, serials, lots, and tracking numbers in the fixtures are synthetic, with check digits recomputed so the validation gates under test still gate.

---

Extracted from a private production ERP; identifiers and fixtures have been sanitized.
