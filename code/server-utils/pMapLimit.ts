/**
 * Run async `fn` over `items` with at most `limit` concurrent calls.
 * Preserves input order in the result array. Rejects on the first error
 * (Promise.all semantics); callers wanting best-effort should make `fn`
 * swallow its own errors and return a sentinel.
 */
export async function pMapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R> | R,
): Promise<R[]> {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const n = Math.min(Math.max(1, limit), items.length || 1);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}
