// A scanned CARRIER LABEL → the tracking numbers it could name.
//
// THE RULE, and it is the same one `scanPayload.ts` states for products: never
// compare a scanned carrier barcode to a stored tracking number with `=`. A
// carrier's 1D barcode is a RECORD — routing data wrapped around the tracking
// number — and only one carrier of the three prints the bare number we store.
//
// Measured against captured production label ZPL (2026-08-20; example values
// below are synthetic, same shapes):
//
//   USPS   ^FD>;>8420234567890>89200123456789000000013
//          →  AI (420) ship-to ZIP+4 `234567890`, then the 22-digit IMpb
//          →  we store `9200123456789000000013`          ✗ never matched
//   FedEx  ^FD>;9610203040506070809000770011223344
//          →  34-digit "96" form; the tracking is the LAST 12
//          →  we store `770011223344`                    ✗ never matched
//   UPS    bare `1Z999AA10123456784`
//          →  we store `1Z999AA10123456784`              ✓ already worked
//
// USPS is the highest-volume carrier here — tens of thousands of labels over
// the trailing 120 days — and not one of them could be scanned on the Held
// Labels bench. The operator got "Nothing matched", which reads as "this parcel
// is not held", which is the wrong answer to a question about a parcel that is
// sitting right there.
//
// ── THE FNC1 PROBLEM ────────────────────────────────────────────────────────
// A GS1-128 barcode separates its elements with FNC1. zxing only surfaces those
// as `]C1` + ASCII 29 when `DecodeHintType.ASSUME_GS1` is set (see
// `Code128Reader.js`); without it they are silently DROPPED and the USPS label
// arrives as one undelimited run:
//
//   `4202345678909200123456789000000013`
//
// which is ambiguous, because AI (420) takes a 5- OR 9-digit ZIP:
//   ZIP-9 `234567890` → `9200123456789000000013`  (22 digits, IMpb ✓)
//   ZIP-5 `23456`     → `78909200123456789000000013` (26 digits, prefix ✗)
//
// The client now sets ASSUME_GS1 so the separator survives, but a wedge scanner
// with GS Replacement configured, an older cached bundle, or a hand-typed value
// can all still deliver the flat form — so BOTH splits are attempted here and
// each is gated on an IMpb prefix plus its mod-10 check digit. When both branches
// somehow survive, BOTH are offered as candidates rather than one being picked:
// the lookup is an exact match against real rows, so at most one can answer, and
// a caller that gets two answers is required to ask rather than guess (the same
// refusal the order lookup makes elsewhere when two records could answer).
//
// `scanPayload.ts` states the product-side half of this rule — a GS1 payload is
// a record, not a key; this file is the carrier-side implementation.

const GS = '\x1d';

/** Strip the AIM symbology identifier (`]C1`, `]C0`, …) the way scanPayload does. */
function stripSymbologyId(s: string): string {
  return /^\][A-Za-z]\d/.test(s) ? s.slice(3) : s;
}

/**
 * GS1 / USPS mod-10 check digit, computed from the right so it is length-agnostic.
 * Weight 3 on the digit adjacent to the check digit, alternating outward — the
 * same algorithm `scanPayload.isValidGtinCheckDigit` uses, but without that
 * function's 8/12/13/14 length gate, because an IMpb is 20, 22, 26 or 30 digits.
 */
export function isValidMod10(digits: string): boolean {
  if (!/^\d{2,}$/.test(digits)) return false;
  const body = digits.slice(0, -1);
  const check = Number(digits.slice(-1));
  let sum = 0;
  for (let i = body.length - 1, w = 3; i >= 0; i -= 1, w = w === 3 ? 1 : 3) {
    sum += Number(body[i]) * w;
  }
  return (10 - (sum % 10)) % 10 === check;
}

/**
 * Lengths the USPS IMpb takes. 22 is the common one (6-digit Mailer ID); 26 is a
 * 9-digit MID — production data holds both, overwhelmingly the 22-digit form.
 * 20 and 30 are the other two the spec allows; they are accepted but we have
 * never seen one.
 */
const IMPB_LENGTHS = new Set([20, 22, 26, 30]);

/**
 * An IMpb's leading digits are its "channel application identifier" — 92 for the
 * GS1-128 form USPS actually prints, with 91/93/94/95 reserved alongside it.
 * Real data carries only a couple of the 9x prefixes. Requiring this prefix is
 * what stops the ZIP-5 split of an ambiguous payload from being mistaken for a
 * tracking number.
 */
function looksLikeImpb(s: string): boolean {
  return IMPB_LENGTHS.has(s.length) && /^9[0-5]/.test(s) && isValidMod10(s);
}

/** UPS is the easy one: the barcode carries exactly what we store. */
const UPS_RE = /1Z[0-9A-Z]{16}/i;

/**
 * FedEx's "96" barcode is 34 digits and ends in the 12-digit tracking number.
 * Verified against a real two-piece shipment's label ZPL (numbers sanitized).
 * Bounded to the shapes FedEx actually prints rather than "any long digit run",
 * so an unrelated numeric payload cannot donate its last 12 digits.
 */
const FEDEX_96_RE = /^96\d{18,32}$/;

function pushUnique(out: string[], value: string | null | undefined): void {
  const v = String(value ?? '').trim().toUpperCase();
  if (v && !out.includes(v)) out.push(v);
}

/**
 * Every tracking number a scanned payload could legitimately name, most literal
 * first.
 *
 * Literal-first matches the ordering doctrine `scanPayload.lookupKeys` sets: a
 * row that stores exactly what the operator scanned must win over anything this
 * function derives. Callers match with `= ANY($keys)` and rank with
 * `array_position($keys, …)` — never `LIMIT 1` on an unordered `ANY`.
 *
 * Returns [] for empty input. Never throws: an unparseable payload degrades to
 * "the literal string only", which is a miss, never a wrong parcel.
 */
export function trackingCandidates(raw: unknown): string[] {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return [];
  const withoutId = stripSymbologyId(trimmed);
  const out: string[] = [];

  // 1. What was actually scanned. Covers UPS outright, plus a bare IMpb, a bare
  //    12-digit FedEx number, and anything a human typed into the box.
  pushUnique(out, withoutId);

  // 2. UPS anywhere in the payload — a 1Z number embedded in a MaxiCode message
  //    or carrying a stray prefix still names the parcel.
  const ups = withoutId.match(UPS_RE);
  if (ups) pushUnique(out, ups[0]);

  // 3. GS1-128 with its separators intact (ASSUME_GS1, or a wedge that emits the
  //    raw GS byte). Walk the elements and take the one that is an IMpb. The AI
  //    (420)/(421) ZIP element is deliberately NOT length-parsed here — we just
  //    look at every element, which is immune to how long the ZIP was.
  if (withoutId.includes(GS)) {
    for (const element of withoutId.split(GS)) {
      const digits = element.replace(/\D/g, '');
      if (looksLikeImpb(digits)) pushUnique(out, digits);
    }
  }

  // 4. The flattened form: `420` + ZIP(5|9) + IMpb, no separator left. Try both
  //    ZIP lengths and keep every split that passes the prefix + check digit.
  //
  //    BOTH SPLITS SURVIVING IS NOT RARE — measured 2026-08-20 by walking all
  //    10,000 ZIP+4 add-ons against a real label: 60 of them (0.60%) produce a
  //    ZIP-5 split that passes the prefix AND the check digit. What makes that
  //    harmless is not the odds, it is the SHAPE. The spurious candidate is
  //    always `last4(ZIP9) + IMpb22`, so for it to name a real order, some
  //    stored 26-digit IMpb would have to carry a complete valid IMpb22 in its
  //    own digits 5–26 — i.e. read `92…` starting at position 5. A real IMpb26
  //    reads `92` at position 1 and its service-type/Mailer-ID digits at 5;
  //    the 26-digit trackings in the data at hand read other digits there. The
  //    collision is structurally unavailable, not merely improbable.
  //
  //    The correct candidate also OUTRANKS the spurious one (ZIP-9 is tried
  //    first), and the caller sorts by `array_position`, so even in the 0.6%
  //    case the real tracking wins the ordering before the lookup runs.
  const flat = withoutId.replace(/\D/g, '');
  if (/^42[01]/.test(flat)) {
    for (const zipLen of [9, 5]) {
      const rest = flat.slice(3 + zipLen);
      if (looksLikeImpb(rest)) pushUnique(out, rest);
    }
  }

  // 5. A bare IMpb that arrived with something else glued to its front (a Code-ID
  //    a scanner added, a stray digit from a partial read of the ZIP element).
  if (!/^42[01]/.test(flat) && looksLikeImpb(flat)) pushUnique(out, flat);

  // 6. FedEx's 96 form → the trailing 12. Gated on the 96 prefix and the whole
  //    payload being digits, so no other numeric barcode donates a suffix.
  if (FEDEX_96_RE.test(flat)) pushUnique(out, flat.slice(-12));

  return out;
}

export default { trackingCandidates, isValidMod10 };
