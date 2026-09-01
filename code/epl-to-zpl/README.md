# EPL2 → ZPL II converter

A single-file, zero-dependency TypeScript module that converts EPL2 line-mode printer output to ZPL II.

## The problem

The warehouse thermal printers (Zebra ZP 450 / ZP 500) are installed under the **ZPL** Windows driver. An upstream label system sometimes emits packing slips in EPL2 line-mode instead — its "use ZPL" toggle is off, or a carrier-specific path bypasses it. The print agent forwards those bytes raw through the Win32 spooler, the printer can't decode EPL while in ZPL mode, and the slip comes out **blank**. The failure is silent: the job "prints" successfully everywhere except on paper.

Converting at ingest — the moment a print job enters the queue — keeps the printer and the print agent language-agnostic and the queue homogeneous (always ZPL), instead of pushing per-job language detection down to every consumer.

## What it supports

The subset of EPL2 the upstream system actually emits, observed from a live capture stream:

| EPL2 | Meaning | ZPL II |
|---|---|---|
| `Q<h>,<g>` | label height + gap | `^LL<h>` |
| `R<x>,<y>` | reference point / origin | `^LH<x>,<y>` |
| `A…,"text"` | ASCII text (font, scale, rotation, reverse) | `^FO ^A0 ^FD ^FS` (+`^FR`) |
| `B…,"data"` | barcode (Code 128 / Code 39 / I2of5) | `^FO ^BY ^BC`/`^B3`/`^B2` |
| `LO` / `LE` | solid / XOR line-box | `^FO ^GB ^FS` |
| `P<n>` | end of page, n copies | `^PQ<n>,0,1,Y ^XZ` |
| `JF`, `N`, `S`, `D`, … | line-mode preamble | dropped (driver settings own speed/density) |

## Design points worth reading

- **Unknowns degrade visibly, not fatally.** An unhandled command becomes a ZPL `^FX` comment in the output — the slip still prints, and the regression is greppable in the stored payload instead of invisible. An unknown barcode type falls back to Code 128 so *something* scans, and logs itself the same way.
- **Quoted text is parsed tail-first.** EPL argument lists end in a quoted string that may itself contain commas (`"SPRINGFIELD, IL 62701"`), so the quoted tail is split off before the prefix is tokenized on commas.
- **Field data is escaped defensively.** ZPL terminates field data on `^`/`~` and treats `\` as an escape lead-in; all three are hex-escaped (`\5E` style) so a stray caret in an address line can't cut a slip in half.
- **Sticky state matches EPL semantics.** `Q` and `R` arrive before the first drawable command and apply to the next label frame opened; multi-page streams produce one `^XA…^XZ` frame per `P`, and a stream that ends without a trailing `P` still closes its open label.
- **Font metrics are empirical.** EPL font sizes are mapped to `^A0` dot dimensions at 203 dpi with linear h/v multipliers, matching what the physical printers render.

## Tests

`__tests__/eplToZpl.test.js` (Node's built-in `node:test` runner) covers each command mapping, the comma-in-quotes case, escaping, multi-page framing, and a full captured-slip fixture round-trip. In the source project the suite runs under its test harness against the compiled TypeScript. The capture fixture's order number, barcode value, customer name, and total are synthetic.

---

Extracted from a private production ERP; identifiers and fixtures have been sanitized.
