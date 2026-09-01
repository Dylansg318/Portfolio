'use strict';
// Stale-while-revalidate cache for per-key async computations whose freshness
// tolerance is high (nav badges, status chips) but whose compute is expensive
// (live upstream API fan-out — per-account message counts from external mail
// and marketplace APIs take multiple seconds per account). Semantics:
//   - first call per key: runs compute; concurrent callers share the promise
//   - within ttlMs: cached value returned instantly, no recompute
//   - after ttlMs: cached value STILL returned instantly, ONE background
//     recompute refreshes the entry (a failed refresh keeps the stale value)
// In-memory and per-process by design — callers are polling endpoints where a
// briefly stale answer is strictly better than a multi-second blocking one.

type Entry<T> = {
  value: T;
  fetchedAt: number;
  refreshing: boolean;
};

export function createSwrCache<T = unknown>({
  ttlMs,
  maxEntries = 1000,
  now = Date.now,
}: {
  ttlMs: number;
  maxEntries?: number;
  now?: () => number;
}) {
  const entries = new Map<string, Entry<T>>();
  const inflight = new Map<string, Promise<T>>();

  function setEntry(key: string, value: T) {
    // Map iteration order is insertion order; delete-then-set keeps the most
    // recently written entries at the tail so eviction drops the oldest.
    entries.delete(key);
    entries.set(key, { value, fetchedAt: now(), refreshing: false });
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  }

  async function get(key: string, compute: () => Promise<T>): Promise<T> {
    const hit = entries.get(key);
    if (hit) {
      if (now() - hit.fetchedAt >= ttlMs && !hit.refreshing) {
        hit.refreshing = true;
        compute()
          .then(value => setEntry(key, value))
          .catch(() => { hit.refreshing = false; }); // keep serving stale
      }
      return hit.value;
    }
    const pending = inflight.get(key);
    if (pending) return pending;
    const p = compute()
      .then(value => { setEntry(key, value); return value; })
      .finally(() => { inflight.delete(key); });
    inflight.set(key, p);
    return p;
  }

  return {
    get,
    invalidate(key: string) { entries.delete(key); },
    get size() { return entries.size; },
  };
}
