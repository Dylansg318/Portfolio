/**
 * Shared money formatters.
 *
 *  - formatCents — integer cents → '$12.34' (no separators).
 *  - formatDollars — dollar number → fixed 2dp '$12.30' (null/NaN → '$0.00').
 *
 * Don't hand-roll `$${x.toFixed(2)}` in new code — import one of these.
 * (Template-rendering formatters that pass through '' and non-numeric strings
 * stay local to their module: different contract.)
 */

export function formatCents(cents: number | string | null | undefined): string {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

export function formatDollars(amount: unknown): string {
  return `$${(Number(amount) || 0).toFixed(2)}`;
}

/**
 * Round to 2 decimal places (dollars). Canonical shared definition —
 * byte-identical to the module-local `round2` helpers it replaced.
 * NOTE: variants elsewhere (Number.EPSILON, null-passthrough) have
 * deliberately different semantics; do not swap them to this one.
 */
export function round2(n: unknown): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}
