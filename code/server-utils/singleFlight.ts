/**
 * In-process single-flight: concurrent calls sharing a key collapse to one
 * execution of `fn`; all callers await the same promise. The key is released
 * when `fn` settles. Scope is one Node process (one server replica) — good
 * enough for revalidation de-dup; cross-replica overlap is harmless (worst
 * case two refreshes of the same cache row).
 */
export function makeSingleFlight() {
  const inflight = new Map();
  return function singleFlight(key: any, fn: () => any) {
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => { try { return await fn(); } finally { inflight.delete(key); } })();
    inflight.set(key, p);
    return p;
  };
}
