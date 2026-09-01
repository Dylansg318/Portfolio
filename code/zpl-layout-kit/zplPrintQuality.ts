'use strict';

/**
 * Print SPEED + DARKNESS for every document this app renders.
 *
 * `^PR` (print rate) and `^MD` (media darkness) are PRINTER-configuration
 * commands — the front-panel settings — not format geometry like `^PW`/`^LL`.
 * They are NOT re-scoped by the next `^XA`: once a format sets them they hold
 * for every subsequent format until something else sets them or the printer is
 * power-cycled. A document that omits them inherits whatever the last document
 * on that printer left behind.
 *
 * That is not hypothetical. **FedEx label ZPL opens `^PR12^MD30`** — maximum
 * speed and maximum darkness, their own bytes, on 3,535 of 3,540 FedEx jobs
 * measured over 30 days on production. USPS (8,168 jobs) and UPS (3,427) send
 * neither. So before this module existed, the first FedEx label of the day
 * left that Zebra at max speed + max darkness for EVERYTHING that followed it:
 * packing slips, pick lists, and the next carrier's label.
 *
 * The visible symptom was the opposite of "too bold". `^PR12` gives each dot
 * less dwell time under the head, so the slip's small type (`^A0N` 19-22) and
 * its 2-dot `^GB` rules washed out; FedEx's `^MD30` compensates for THEIR big
 * barcodes, not for our dense slip. It also made slip appearance
 * nondeterministic — the same bytes printed differently depending on which
 * carrier happened to print before them.
 *
 * This is the same bug class as a `^PO` orientation leak we also hit (a slip
 * printed FLIPPED when it followed a label and UNFLIPPED when standalone). The
 * remedy is the same: state it explicitly.
 *
 * VALUES ARE MEASURED, NOT GUESSED. Printed on a real Zebra 6x4 as a three-way
 * card at the slip's own font sizes and rule weights — A `^PR12^MD30` (the
 * inherited state), B `^PR4^MD0` (panel default), C `^PR4^MD10`. The operator
 * picked C off the paper. The three read close to identical, which is the other
 * half of the result: dropping the inherited max darkness does NOT make slips
 * fade, so this change carries no legibility regression.
 *
 * Do NOT strip `^PR12^MD30` from the FedEx label itself — that tuning is for
 * their hub scanners. This only governs documents WE render. Because our slip is
 * the last block of the merged payload on nearly every FedEx job, stating it
 * here also leaves the printer in a known state for whatever prints next, which
 * is what stops the leak into UPS/USPS labels.
 */

// ips. The 4x6 desktop Zebras top out at 5-6; 4 keeps dwell time up, which is
// what fixes the washed-out small type.
const ZPL_PRINT_SPEED = 4;

// Offset from the printer's own configured darkness (`~SD`/front panel), NOT an
// absolute. 0 would mean "whatever this printer is set to" and would therefore
// still differ across a fleet of Zebras; 10 is the measured pick.
const ZPL_PRINT_DARKNESS = 10;

// Emit directly after `^XA` (and after `^PO`, which must precede the field data
// it orients) and before the geometry commands.
const ZPL_PRINT_QUALITY = `^PR${ZPL_PRINT_SPEED}^MD${ZPL_PRINT_DARKNESS}`;

export { ZPL_PRINT_SPEED, ZPL_PRINT_DARKNESS, ZPL_PRINT_QUALITY };
