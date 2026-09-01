/**
 * Idle expiry for persisted LIST VIEW STATE (search boxes, filter chips, page
 * number, date ranges).
 *
 * Every list page persists those to `sessionStorage` so that list → detail →
 * Back doesn't dump you on page 1 of an unfiltered table. That is correct for a
 * round trip measured in seconds. The problem is the lifetime: `sessionStorage`
 * lives as long as the TAB, this app is left open for days, and browsers that
 * restore the previous session (Zen, Safari, Chrome "continue where you left
 * off") carry it across restarts too. The result is a filter set on Tuesday
 * still silently subtracting rows on Friday — a search term or a status filter
 * you no longer remember typing, which reads as "the order isn't there".
 *
 * So: the state gets a 15-minute IDLE life. Any interaction re-stamps the clock;
 * come back after 15 minutes away and the next checkpoint (page load, tab
 * refocus, route mount) drops it and the lists open clean.
 *
 * DELIBERATELY NOT EXPIRED — this only clears state that changes WHICH ROWS YOU
 * SEE, because that is the state whose staleness is invisible and misleading:
 *   - sort order, tab/layout choice — visible on screen, hides nothing.
 *   - page size, column visibility, printer picks — real preferences, not
 *     "where I was".
 *   - toggles that ADD rows rather than hide them and default to off, e.g.
 *     a "show finished" toggle. A stale one shows you more than you expected,
 *     which nobody mistakes for a missing order.
 *   - anything holding unsaved work — an in-progress shipping batch, a
 *     half-typed tracking entry, price-edit drafts, mapping drafts. Walking
 *     away from a half-finished form for 15 minutes must never destroy it,
 *     which is why this is an explicit allow-list and never a "sweep
 *     sessionStorage" pass.
 *
 * The store matters as much as the key. Most list filters are per-tab
 * (sessionStorage), but two hide rows from localStorage and would otherwise sit
 * in the list below looking covered while never expiring — which is exactly the
 * bug this file exists to prevent, in this file.
 *
 * Adding a new list page? Add its filter/search/page key below WITH the store it
 * writes to, or its filters simply keep today's forever-lifetime. Pages whose
 * filters live in plain React state need nothing — they already reset when you
 * navigate away.
 */

export const VIEW_STATE_IDLE_MS = 15 * 60 * 1000;

/** Fired (async) when a sweep actually cleared something, so MOUNTED pages can
 *  reset their in-memory copy — clearing storage alone only helps the next mount.
 *  `detail.epoch` is the sweep counter below. */
export const VIEW_STATE_EXPIRED_EVENT = 'app:view-state-expired';

const STAMP_KEY = 'app.viewState.lastActivityAt';

export interface ViewStateKey {
  /** Which store the page actually wrote it to. Getting this wrong is silent:
   *  the key sits in the list looking covered and never expires. */
  store: 'session' | 'local';
  key: string;
}

/** Every persisted key holding row-narrowing state. See the header note. */
export const EXPIRING_VIEW_STATE_KEYS: readonly ViewStateKey[] = [
  // Orders
  { store: 'session', key: 'orders.filters' },
  { store: 'session', key: 'orders.page' },
  // Products
  { store: 'session', key: 'products.filterState.v1' },
  // Customers
  { store: 'session', key: 'customers.filters' },
  { store: 'session', key: 'customers.page' },
  // Sales pipeline
  { store: 'session', key: 'pipeline.filters' },
  { store: 'session', key: 'pipeline.page' },
  // Shipping costs — shipments + adjustments tabs, and the page-level date range
  { store: 'session', key: 'shipping-costs.filters' },
  { store: 'session', key: 'shipping-costs.page' },
  { store: 'session', key: 'shipping-costs.range' },
  { store: 'session', key: 'shipping-adjustments.filters' },
  { store: 'session', key: 'shipping-adjustments.page' },
  // Profitability — `preset` is the date window, not a layout choice
  { store: 'session', key: 'profitability.filters' },
  { store: 'session', key: 'profitability.preset' },
  // Mapping work queue — `view` carries the rail search + rail page. The sold
  // filter is localStorage: it defaults ON with an end date of "today", so a
  // stale copy pins the queue to a window that stopped moving weeks ago.
  { store: 'local',   key: 'mapping.sold-filter.v1' },
  { store: 'session', key: 'mapping.view.v1' },
  // Pricing products — "exclude out of stock" hides rows and defaults OFF
  { store: 'local',   key: 'pricing.exclude-oos' },
];

// Writing a timestamp on every mousemove would be a synchronous storage write
// per frame. One write per 30s is enough resolution for a 15-minute window.
const STAMP_THROTTLE_MS = 30_000;
let lastStampWrite = 0;

// Counts sweeps in this tab. A list that swept during its OWN mount already read
// clean storage, so it must ignore that sweep's notification — without this it
// resets itself a second time, one tick after mounting.
let epoch = 0;
export function viewStateEpoch(): number {
  return epoch;
}

function storage(store: 'session' | 'local' = 'session'): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return store === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null; // private mode / blocked storage
  }
}

/** Marks the app as in-use. Throttled; call it freely. */
export function touchViewState(force = false): void {
  const now = Date.now();
  if (!force && now - lastStampWrite < STAMP_THROTTLE_MS) return;
  const s = storage();
  if (!s) return;
  try {
    s.setItem(STAMP_KEY, String(now));
    lastStampWrite = now;
  } catch { /* quota — the app works fine without a memory */ }
}

/** ms since the last interaction, or null when this tab has never stamped one. */
export function idleMs(now: number = Date.now()): number | null {
  const s = storage();
  if (!s) return null;
  let raw: string | null = null;
  try { raw = s.getItem(STAMP_KEY); } catch { return null; }
  const last = Number(raw);
  if (!raw || !Number.isFinite(last) || last <= 0) return null;
  // A clock that moved backwards (sleep/resume, NTP) reads as negative idle;
  // treat it as "just now" rather than expiring or never-expiring at random.
  return Math.max(0, now - last);
}

export function isViewStateIdle(now: number = Date.now()): boolean {
  const idle = idleMs(now);
  return idle !== null && idle > VIEW_STATE_IDLE_MS;
}

/**
 * The checkpoint. Cheap (one clock compare in the common case) and idempotent,
 * so it is safe to call from a `useState` initializer or an event handler.
 *
 * @returns true when it actually cleared state.
 */
export function expireViewStateIfIdle(): boolean {
  if (!isViewStateIdle()) return false;

  let cleared = false;
  for (const { store, key } of EXPIRING_VIEW_STATE_KEYS) {
    // The idle clock is per-TAB (sessionStorage) but a `local` key is shared by
    // every tab. That is fine: the checkpoints all run in the tab the user is
    // actually returning to, and these keys are filters that should be forgotten
    // anyway — the cost is a background tab losing a filter it also shouldn't keep.
    const s = storage(store);
    if (!s) continue;
    try {
      if (s.getItem(key) === null) continue;
      s.removeItem(key);
      cleared = true;
    } catch { /* ignore */ }
  }

  // Re-stamp unconditionally, even when nothing was stored: otherwise every
  // subsequent checkpoint re-runs the sweep for the rest of the tab's life.
  touchViewState(true);

  if (cleared) {
    epoch += 1;
    if (typeof window !== 'undefined') {
      const swept = epoch;
      // ASYNC on purpose: callers include useState initializers, and a synchronous
      // dispatch there would setState on other mounted hooks during render.
      queueMicrotask(() => {
        window.dispatchEvent(
          new CustomEvent(VIEW_STATE_EXPIRED_EVENT, { detail: { epoch: swept } }),
        );
      });
    }
  }
  return cleared;
}

/** Subscribe a mounted list hook to the reset. Returns an unsubscribe fn. */
export function onViewStateExpired(handler: (epoch: number) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (e: Event) => {
    handler(Number((e as CustomEvent<{ epoch?: number }>).detail?.epoch ?? epoch));
  };
  window.addEventListener(VIEW_STATE_EXPIRED_EVENT, listener);
  return () => window.removeEventListener(VIEW_STATE_EXPIRED_EVENT, listener);
}

/**
 * Wire the clock up. Called once from the entrypoint, before React mounts.
 *
 * The expiry checkpoints are: boot, tab refocus, and route mount (the list hooks
 * call `expireViewStateIfIdle()` in their initializers). Deliberately NOT a
 * timer — a tab sitting open and focused on a filtered list should keep it;
 * yanking the filters out from under someone mid-read is the opposite of the fix.
 */
export function installViewStateExpiry(): void {
  if (typeof window === 'undefined') return;

  // Boot: nothing is mounted yet, so clearing storage is the whole job.
  expireViewStateIfIdle();
  touchViewState(true);

  const stamp = () => touchViewState();
  window.addEventListener('pointerdown', stamp, { passive: true, capture: true });
  window.addEventListener('keydown', stamp, { passive: true, capture: true });
  window.addEventListener('scroll', stamp, { passive: true, capture: true });

  const checkOnReturn = () => {
    if (document.visibilityState === 'hidden') {
      // Leaving is the last moment we know they were here — stamp it so the
      // idle window starts when they left, not when they last clicked.
      touchViewState(true);
      return;
    }
    expireViewStateIfIdle();
    touchViewState(true);
  };
  document.addEventListener('visibilitychange', checkOnReturn);
  window.addEventListener('focus', checkOnReturn);
}
