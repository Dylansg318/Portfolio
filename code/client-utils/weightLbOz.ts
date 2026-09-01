// Whole-ounce scale-style weight helpers. A shipping scale reads WHOLE ounces,
// and operators asked to stop seeing tenths like "1.6 oz" on the ship station —
// so every lb/oz split here rounds ounces to a whole number. The canonical
// storage stays a decimal (weight_lbs) or a total-ounce count (weight_oz);
// these only convert between that and the two scale-style inputs the operator
// types into.

// Split total OUNCES → { lbs, oz } display strings, oz rounded to a whole number.
// An empty/zero/invalid weight yields blank fields so an "auto" placeholder can
// show through. Ounce-overflow (e.g. 15.9 → 16) carries into the pound.
export function splitOz(totalOz: number | null | undefined): { lbs: string; oz: string } {
  const oz = Number(totalOz);
  if (!Number.isFinite(oz) || oz <= 0) return { lbs: '', oz: '' };
  const whole = Math.round(oz);          // whole ounces
  const lb = Math.floor(whole / 16);
  const rem = whole - lb * 16;
  return { lbs: lb ? String(lb) : '', oz: rem ? String(rem) : '' };
}

// Split a decimal-LBS value → { lbs, oz } display strings (oz whole).
export function splitLbs(weightLbs: number | string | null | undefined): { lbs: string; oz: string } {
  return splitOz(Number(weightLbs) * 16);
}

// Combine the two scale-style inputs → canonical TOTAL OUNCES (whole number).
export function combineToOz(lbsStr: string | number, ozStr: string | number): number {
  const lbs = Number(lbsStr) || 0;
  const oz = Number(ozStr) || 0;
  return Math.round(lbs * 16 + oz);
}

// Combine the two scale-style inputs → canonical DECIMAL-LBS string. Both fields
// blank (or a non-positive total) → '' so callers fall back to an auto/master
// weight and unpin any manual override.
export function combineToLbs(lbsStr: string, ozStr: string): string {
  const lbsBlank = lbsStr === '' || lbsStr == null;
  const ozBlank = ozStr === '' || ozStr == null;
  if (lbsBlank && ozBlank) return '';
  const totalOz = combineToOz(lbsStr, ozStr);
  if (!(totalOz > 0)) return '';
  return String(Math.round((totalOz / 16) * 1000) / 1000);
}

// Quantize a decimal-lbs weight to the nearest WHOLE OUNCE, returned as a
// decimal-lbs string ('' when non-positive). A shipping box is displayed two
// ways at once on the ship station — the editable lb/oz field (splitOz) and the
// read-only "auto" caption — and BOTH snap to whole ounces. Seeding the stored
// box weight to 0.1-lb precision (the old `.toFixed(1)`, a 1.6-oz step) made
// those two disagree by up to ~1 oz on a fresh, untouched box. Rounding the
// auto-derived weight to whole ounces keeps field and caption equal, and reuses
// combineToLbs's exact rounding so an auto-seeded weight and a hand-typed one
// serialize byte-identically (stable === comparisons in the box resync). An
// operator's direct override is stored verbatim and never routed here.
export function quantizeLbsToWholeOz(lbs: number | string | null | undefined): string {
  const oz = Math.round((Number(lbs) || 0) * 16);
  if (!(oz > 0)) return '';
  return String(Math.round((oz / 16) * 1000) / 1000);
}
