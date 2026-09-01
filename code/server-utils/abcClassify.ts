// ABC classification — the rule, extracted pure so it can be tested without
// standing up the whole nightly intelligence job.
//
// THE BUG THIS ENCODES A FIX FOR. The classifier used to rank the entire
// sellable catalog. With 27,215 sellable products and a 20% A bucket, that
// made the A slice (5,443) LARGER than the whole demand-carrying population
// (3,721) — so every product that actually sells came out class A:
// 1,979 A / 2 B / 3 C among products with demand. Two consumers were silently
// broken by that:
//
//   - the replenishment suggestion SQL — service level (Z score) pinned at
//     1.96 for everything, and the suggested-quantity rounding always
//     rounding UP.
//   - the cycle-count scheduler — "count the A items" pointed at 5,443
//     products, 3,700+ of which have never sold.
//
// Ranking only the products with demand yields a real Pareto instead:
// A = 745 products carrying 89.0% of 30-day revenue, B = 1,117 (9.5%),
// C = 1,859 (1.6%).
//
// Everything with no revenue in the lookback floors to 'C' — deliberately NOT
// null. Null would empty the C bucket cycle-count schedules filter on, and
// would route the fallback branch of the service-level SQL to the B service
// level (1.65), i.e. a LARGER safety cushion for products with no demand at all.

export interface AbcInput {
  id: string;
  current_class?: string | null;
  revenue_velocity?: number | string | null;
}

export interface AbcUpdate {
  id: string;
  newClass: 'A' | 'B' | 'C';
  currentClass: string | null;
  /** Did this product carry demand in the lookback? Only these are worth
   *  raising an `abc_reclassification` insight for. */
  ranked: boolean;
}

/**
 * Assign A/B/C over the products that actually sell.
 *
 * Sorts internally by revenue descending, so it does not depend on the caller's
 * ORDER BY, and resolves each product's class by id rather than by index into
 * the unsorted input — a negative-revenue row (a credit line sorting below the
 * zeros) therefore cannot shift the class boundaries.
 */
export function assignAbcClasses(
  products: AbcInput[],
  opts: { aPct: number; bPct: number },
): AbcUpdate[] {
  const rev = (p: AbcInput) => {
    const n = Number(p.revenue_velocity);
    return Number.isFinite(n) ? n : 0;
  };

  const ranked = products
    .filter((p) => rev(p) > 0)
    .sort((a, b) => rev(b) - rev(a));

  const total = ranked.length;
  const aCount = Math.ceil((total * opts.aPct) / 100);
  const bCount = Math.ceil((total * opts.bPct) / 100);

  const classById = new Map<string, 'A' | 'B' | 'C'>(
    ranked.map((p, i) => [p.id, i < aCount ? 'A' : i < aCount + bCount ? 'B' : 'C']),
  );

  return products.map((p) => ({
    id: p.id,
    newClass: classById.get(p.id) ?? 'C',
    currentClass: p.current_class ?? null,
    ranked: classById.has(p.id),
  }));
}
