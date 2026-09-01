// What a scanner actually emits → the keys a product lookup can match.
//
// THE RULE: no scan surface may compare a raw scanner payload to a stored
// barcode with `=`. Run it through `parseScanPayload()` and match on
// `lookupKeys`. A raw comparison is wrong in two directions at once:
//
//  1. THE SAME PRODUCT PRINTS DIFFERENT-LENGTH FORMS OF ONE NUMBER. UPC-A is
//     12 digits, EAN-13 is 13, a GS1 AI (01) carries 14 — and they are the same
//     GTIN with leading zeros. The product table stores 12-digit UPC-A for
//     every row that has one; a GS1-128 carton scan of that same item arrives
//     14-digit and misses every one of them.
//
//  2. A GS1 PAYLOAD IS NOT A KEY, IT IS A RECORD. A serialized device carton
//     carries `(01)04001234000008(21)S0000001A1` — GTIN plus a PER-UNIT
//     SERIAL. Bound raw, every physical box is its own barcode row: the first
//     unit "works", the second is unmapped, and pack review fills with one
//     pending row per serial that no reviewer can ever make useful.
//     AI (21)/(10)/(17) are unit facts. Only the GTIN identifies the product.
//
// It also closes a live false positive: the old parser treated ANY payload
// starting with "01", "10" or "17" as GS1, so the ordinary UPC-A
// `012345678905` parsed as AI (01) and looked up `2345678905`. Number system 0
// is the most common US UPC prefix — this was a silent mis-key waiting on the
// first such product. A payload that is exactly 8/12/13/14 digits is a plain
// GTIN, never GS1, and is checked here before any AI parsing runs.
//
// Scanner facts this encodes (a Tera wedge scanner on the warehouse bench):
//   - Code ID prefix is OFF by default, so `]C1`/`]d2`/`]e0` normally do not
//     arrive — but they do the moment someone scans the Code-ID config barcode,
//     and stripping them costs nothing.
//   - GS (0x1D) arrives raw unless GS Replacement is configured, so the AI
//     terminator is handled as both 0x1D and the printable substitutes.

const GS = '\x1d';

/**
 * Value lengths fixed by the GS1 General Specifications ("predefined length"
 * AIs). Only AIs that actually exist — an unassigned AI in this table would let
 * a non-GS1 payload walk a fixed number of characters and report a GS1 record
 * with all-null fields into the pack audit row.
 */
const FIXED_AI_LENGTH: Record<string, number> = {
  '00': 18, // SSCC
  '01': 14, // GTIN
  '02': 14, // GTIN of contained trade items
  '11': 6,  // production date
  '12': 6,  // due date
  '13': 6,  // packaging date
  '15': 6,  // best before
  '16': 6,  // sell by
  '17': 6,  // expiry
  '20': 2,  // variant
};

/** Predefined-length 3- and 4-digit AIs, matched by pattern. */
function patternedAiLength(s: string, i: number): { ai: string; length: number } | null {
  const four = s.substr(i, 4);
  // 31nn–36nn: trade measures. Always a 6-digit value; the last digit is the
  // decimal point position, not part of the value.
  if (/^3[1-6]\d\d$/.test(four)) return { ai: four, length: 6 };
  const three = s.substr(i, 3);
  // 410–417: party GLNs, always 13 digits.
  if (/^41[0-7]$/.test(three)) return { ai: three, length: 13 };
  return null;
}

/**
 * Variable-length 2-digit AIs we are willing to walk past. Anything outside
 * both tables stops the parse — better to keep the AIs already read than to
 * guess a length and slice the payload at the wrong offset.
 */
const VARIABLE_AI = new Set(['10', '21', '22', '30', '37', '90', '91', '92', '93', '94', '95', '96', '97', '98', '99']);

/** Characters a scanner may substitute for the raw GS byte (GS Replacement). */
const GS_SUBSTITUTES = [GS, '␝', '{GS}'];

export interface Gs1Fields {
  gtin: string | null;      // as printed in AI (01), before canonicalization
  lot: string | null;       // AI (10)
  exp_date: string | null;  // AI (17), ISO yyyy-mm-dd
  serial: string | null;    // AI (21) — a UNIT fact, never a product key
}

/**
 * HIBC — the OTHER healthcare barcode standard, and the one on the cartons GS1
 * does not cover. Same trap as GS1, different syntax: the string is
 * `+<primary>/<secondary><check>`, where the PRIMARY (labeler code + product
 * number + unit of measure) identifies the product and the SECONDARY carries
 * the LOT, expiry and serial — i.e. facts about the box in your hand.
 *
 *   +EACM401521/$01983+    →  primary +EACM401521, lot 01983
 *   +EDMO502010/$$24010101X → primary +EDMO502010, date+lot
 *
 * Bound whole, the next box of the same product is a stranger, exactly as a
 * serialized GS1 payload would be.
 */
export interface HibcFields {
  primary: string;          // '+' + labeler + product code + UoM — the product key
  lot: string | null;
  exp_date: string | null;
  serial: string | null;
}

export interface ParsedScan {
  raw: string;
  /** Symbology identifier and terminators removed; parentheses form flattened. */
  cleaned: string;
  gs1: Gs1Fields | null;
  hibc: HibcFields | null;
  /** Canonical 14-digit GTIN when the payload carries a valid one. */
  gtin: string | null;
  /** Ordered, de-duplicated candidate keys for a barcode/product lookup. */
  lookupKeys: string[];
}

/** GS1 mod-10 check digit, computed from the right so it is length-agnostic. */
export function isValidGtinCheckDigit(digits: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(digits)) return false;
  const body = digits.slice(0, -1);
  const check = Number(digits.slice(-1));
  let sum = 0;
  // Weight 3 on the digit adjacent to the check digit, alternating outward.
  for (let i = body.length - 1, w = 3; i >= 0; i -= 1, w = w === 3 ? 1 : 3) {
    sum += Number(body[i]) * w;
  }
  return (10 - (sum % 10)) % 10 === check;
}

/**
 * Canonical 14-digit GTIN, or null when the value is not a GTIN at all.
 * Leading zeros carry no information — UPC-A 633712000015, EAN-13
 * 0633712000015 and GTIN-14 00633712000015 are one number.
 */
export function canonicalGtin(value: unknown): string | null {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (![8, 12, 13, 14].includes(digits.length)) return null;
  if (!isValidGtinCheckDigit(digits)) return null;
  return digits.padStart(14, '0');
}

/**
 * Every stored form one GTIN can legitimately have been written as, longest
 * first. `00633712000015` → ['00633712000015','0633712000015','633712000015'].
 * A shorter form is only offered when the digits it drops are all zeros.
 */
export function gtinLookupKeys(canonical14: string | null): string[] {
  if (!canonical14 || canonical14.length !== 14) return [];
  const keys: string[] = [];
  for (const len of [14, 13, 12, 8]) {
    const prefix = canonical14.slice(0, 14 - len);
    if (/^0*$/.test(prefix)) keys.push(canonical14.slice(14 - len));
  }
  return keys;
}

/** Strip the AIM symbology identifier (`]C1`, `]d2`, `]e0`, `]Q3`, …). */
function stripSymbologyId(s: string): string {
  return /^\][A-Za-z]\d/.test(s) ? s.slice(3) : s;
}

/**
 * Flatten the human-readable parentheses form some scanners and every printed
 * label use: `(01)04001234000008(21)S0000001A1` → the same string without the
 * parens, with a GS inserted after each variable-length value so the AI walker
 * still knows where a value ends.
 */
function flattenParenForm(s: string): string {
  if (!/^\(\d{2,4}\)/.test(s)) return s;
  const parts = s.match(/\(\d{2,4}\)[^(]*/g);
  if (!parts) return s;
  return parts
    .map((part) => {
      const ai = part.slice(1, part.indexOf(')'));
      const value = part.slice(part.indexOf(')') + 1);
      return FIXED_AI_LENGTH[ai] ? ai + value : ai + value + GS;
    })
    .join('');
}

function stripTrailingGs(s: string): string {
  let end = s.length;
  while (end > 0 && s[end - 1] === GS) end -= 1;
  return s.slice(0, end);
}

function normalizeGsBytes(s: string): string {
  let out = s;
  for (const sub of GS_SUBSTITUTES) {
    if (sub !== GS) out = out.split(sub).join(GS);
  }
  return out;
}

function blankGs1(): Gs1Fields {
  return { gtin: null, lot: null, exp_date: null, serial: null };
}

/** Fold one (AI, value) pair into the fields we care about. */
function applyAi(out: Gs1Fields, ai: string, value: string): void {
  if (ai === '01' || ai === '02') out.gtin = value;
  else if (ai === '10') out.lot = value;
  else if (ai === '21') out.serial = value;
  else if (ai === '17' && /^\d{6}$/.test(value)) {
    out.exp_date = `20${value.slice(0, 2)}-${value.slice(2, 4)}-${value.slice(4, 6)}`;
  }
}

/**
 * Is this payload GS1 AI-encoded at all, or just a product code that happens to
 * begin with two digits an AI table also uses?
 *
 * This is the SECOND time that question has bitten. The first was `012345678905`
 * — an ordinary UPC-A read as AI (01), fixed by short-circuiting bare
 * 8/12/13/14-digit numbers to a plain GTIN (see the header). That guard only
 * covers all-digit payloads, so it never saw the one the warehouse actually
 * scans: our own rack labels print the internal SKU under the bars, every item
 * code starts `106-`, and `10` is AI (10) BATCH/LOT — a variable-length AI, so
 * it swallowed the rest and reported `106-1283` as "lot 6-1283". Fabricated, and
 * shown on the Scan page's no-match panel and the barcode-capture preview.
 *
 * A payload is treated as GS1 only when something ANCHORS it:
 *   · the scanner declared the symbology (`]C1`/`]e0`/`]d2`), or
 *   · it contains a GS separator, so it is a real multi-element string, or
 *   · it opens with a PREDEFINED-LENGTH AI, whose value length the spec fixes.
 *
 * What that gives up is a single-element variable-AI label with no separator and
 * no symbology id — a lot-only or serial-only barcode. That string is character
 * for character indistinguishable from a plain product code, so reading it as
 * GS1 is a guess either way, and guessing "product code" is the safe direction:
 * lookup already keys off the literal payload first, so nothing about which
 * product a scan resolves to changes here — only whether we invent a lot.
 */
function looksLikeGs1Element(s: string, hadSymbologyId: boolean): boolean {
  if (hadSymbologyId) return true;
  if (s.includes(GS)) return true;
  if (FIXED_AI_LENGTH[s.substr(0, 2)] !== undefined) return true;
  return patternedAiLength(s, 0) !== null;
}

function parseAis(s: string): Gs1Fields | null {
  const out = blankGs1();
  let i = 0;
  let read = 0;

  while (i < s.length) {
    if (s[i] === GS) { i += 1; continue; }
    const two = s.substr(i, 2);
    const fixed = FIXED_AI_LENGTH[two];
    const patterned = fixed ? null : patternedAiLength(s, i);
    let ai: string;
    let value: string;

    if (fixed) {
      ai = two;
      value = s.substr(i + 2, fixed);
      if (value.length < fixed) break; // truncated payload — keep what we have
      i += 2 + fixed;
    } else if (patterned) {
      ai = patterned.ai;
      value = s.substr(i + ai.length, patterned.length);
      if (value.length < patterned.length) break;
      i += ai.length + patterned.length;
    } else if (VARIABLE_AI.has(two)) {
      ai = two;
      const end = s.indexOf(GS, i + 2);
      value = s.substring(i + 2, end === -1 ? s.length : end);
      i = end === -1 ? s.length : end + 1;
    } else {
      // Unknown AI. STOP rather than slice at a guessed offset — the payload
      // degrades to a literal-only lookup (a miss), never a wrong product.
      break;
    }

    read += 1;
    applyAi(out, ai, value);
  }

  return read > 0 ? out : null;
}

/**
 * The parenthesised form carries its own AI boundaries, so parse it from the
 * captured groups instead of flattening and re-walking. This is the ONLY path
 * that handles an arbitrary 3- or 4-digit AI correctly, because the label told
 * us where each one ends.
 */
function parseParenForm(s: string): Gs1Fields | null {
  if (!/^\(\d{2,4}\)/.test(s)) return null;
  const parts = s.match(/\(\d{2,4}\)[^(]*/g);
  if (!parts) return null;
  const out = blankGs1();
  for (const part of parts) {
    const close = part.indexOf(')');
    applyAi(out, part.slice(1, close), part.slice(close + 1));
  }
  return out;
}

/**
 * HIBC needs a primary AND a secondary to be splittable. `+` then a 4-character
 * labeler code is the standard's own signature; requiring it keeps an ordinary
 * payload that merely starts with '+' out of this branch.
 */
const HIBC_RE = /^\+[A-Za-z0-9]{4}[A-Za-z0-9]+$/;

function parseHibc(s: string): HibcFields | null {
  const slash = s.indexOf('/');
  if (slash === -1) return null;
  const primary = s.slice(0, slash);
  if (!HIBC_RE.test(primary)) return null;

  // Secondary, minus the trailing check character. Data identifiers:
  //   $$+serial · $$ date+lot · $ lot · + serial (no date)
  const secondary = s.slice(slash + 1, s.length - 1);
  const out: HibcFields = { primary, lot: null, exp_date: null, serial: null };

  if (secondary.startsWith('$$+')) {
    out.serial = secondary.slice(3) || null;
  } else if (secondary.startsWith('$$')) {
    // $$ may be followed by a date whose format is declared by the next digits.
    // We do NOT guess the date layout — misreading it would put a wrong expiry
    // on a lot. The lot is what follows; the date stays null until a real label
    // tells us its format.
    out.lot = secondary.slice(2) || null;
  } else if (secondary.startsWith('$')) {
    out.lot = secondary.slice(1) || null;
  } else if (secondary.startsWith('+')) {
    out.serial = secondary.slice(1) || null;
  }
  return out;
}

/**
 * The one entry point every scan surface uses.
 *
 * `lookupKeys` is ordered: the literal scanned string first (so a row bound to
 * exactly what the operator scanned always wins), then the GTIN forms longest
 * to shortest. Match with `payload = ANY($keys)` and rank with
 * `array_position($keys, payload)` — never `LIMIT 1` on an unordered ANY.
 */
export function parseScanPayload(raw: unknown): ParsedScan {
  const rawStr = String(raw ?? '');
  const trimmed = rawStr.trim().replace(/[\r\n]+$/, '');
  const withoutId = stripSymbologyId(trimmed);
  // A GS may be the last character (flattenParenForm terminates every
  // variable-length value with one). `String.trim()` does NOT remove 0x1D — it
  // is not JS whitespace — and a control byte left on the end would be stored
  // as part of a binding that the wedge form of the same label can never equal.
  const cleaned = stripTrailingGs(normalizeGsBytes(flattenParenForm(withoutId)).trim());

  if (!cleaned) {
    return { raw: rawStr, cleaned: '', gs1: null, hibc: null, gtin: null, lookupKeys: [] };
  }

  // A bare 8/12/13/14-digit number is a plain GTIN, never GS1. Checked BEFORE
  // AI parsing so `012345678905` is not read as AI (01).
  const bareGtin = /^\d+$/.test(cleaned) ? canonicalGtin(cleaned) : null;

  const hibc = bareGtin ? null : parseHibc(cleaned);
  // The parenthesised form knows its own AI boundaries; prefer it. The bare form
  // is only walked when something anchors it as GS1 — see looksLikeGs1Element.
  const gs1 = (bareGtin || hibc)
    ? null
    : (parseParenForm(withoutId)
       || (looksLikeGs1Element(cleaned, withoutId !== trimmed) ? parseAis(cleaned) : null));
  const gtin = bareGtin || canonicalGtin(gs1?.gtin);

  const keys: string[] = [];
  const push = (k: string | null | undefined) => {
    if (k && !keys.includes(k)) keys.push(k);
  };
  push(cleaned);
  for (const k of gtinLookupKeys(gtin)) push(k);
  // The HIBC primary is offered as a key so a binding made on the product code
  // answers a scan of ANY box of it, whatever lot the secondary carries.
  push(hibc?.primary);
  // An AI (01) value that fails its check digit is NOT canonicalized — we will
  // not manufacture length-forms of a number we cannot verify — but it is still
  // offered verbatim so a binding made from an earlier scan of the same
  // mis-printed label keeps resolving.
  if (!gtin && gs1?.gtin) push(gs1.gtin);
  push(trimmed);

  return { raw: rawStr, cleaned, gs1, hibc, gtin, lookupKeys: keys };
}

/**
 * What a capture path should STORE when an operator binds a package to a
 * product: the canonical GTIN, else the HIBC primary, else the cleaned payload.
 * Never the raw string when it carries lot/serial — see the header note.
 */
export function bindablePayload(parsed: ParsedScan): string {
  return parsed.gtin || parsed.hibc?.primary || parsed.cleaned;
}

/**
 * Keys a CAPTURE path must check before inserting: everything a lookup would
 * match, plus the form we are about to store. Literal-first, same order as
 * `lookupKeys`, so a capture ranks rows the way resolution does — putting the
 * canonical form first instead would return a different row id than the scan
 * that follows it resolves to.
 */
export function bindingKeys(parsed: ParsedScan): string[] {
  const stored = bindablePayload(parsed);
  const keys = [...parsed.lookupKeys];
  if (stored && !keys.includes(stored)) keys.push(stored);
  return keys;
}
