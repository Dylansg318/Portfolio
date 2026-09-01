import {
  VIEW_STATE_IDLE_MS,
  VIEW_STATE_EXPIRED_EVENT,
  EXPIRING_VIEW_STATE_KEYS,
  touchViewState,
  isViewStateIdle,
  expireViewStateIfIdle,
  onViewStateExpired,
  viewStateEpoch,
  installViewStateExpiry,
} from '../viewStateTtl';

const STAMP_KEY = 'app.viewState.lastActivityAt';

// Keys that hold UNSAVED WORK or plain preferences. If a change to the sweep
// ever starts clearing these, someone loses a half-finished ship batch or a
// tracking entry they walked away from — which is exactly what the allow-list
// exists to prevent.
const MUST_SURVIVE = [
  ['session', 'reviewQueue.session'],
  ['session', 'reship.session'],
  ['session', 'reviewQueue.batchScope.v2'],
  ['session', 'shipReceipt.session'],
  ['session', 'priceEdits.draft.v2'],
  ['session', 'mapper.lookupDraft.v1'],
  ['session', 'orders.sort'],
  ['session', 'customers.sort'],
  ['session', 'pipeline.view'],
  ['session', 'shipping-costs.tab'],
  ['session', 'profitability.tab'],
  ['session', 'chunk_reload_attempted_at'],
  // localStorage: real preferences, and one ADDITIVE toggle that defaults off.
  ['local', 'orders.pageSize'],
  ['local', 'orders.columns'],
  ['local', 'lastPickedPrinter'],
  ['local', 'direct-orders.showFinished'],
  ['local', 'buybox.sortMode'],
  ['local', 'app-theme'],
  ['local', 'auth_token'],
];

const storeFor = s => (s === 'local' ? localStorage : sessionStorage);

function stampAgo(ms) {
  sessionStorage.setItem(STAMP_KEY, String(Date.now() - ms));
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  jest.useRealTimers();
});

describe('idle detection', () => {
  it('is not idle right after a touch', () => {
    touchViewState(true);
    expect(isViewStateIdle()).toBe(false);
  });

  // The clock is PINNED for the boundary assertion. stampAgo() reads Date.now()
  // and isViewStateIdle() reads it again a moment later, so "exactly the window"
  // drifts a millisecond past it whenever the machine is loaded — which is
  // exactly when a pre-commit hook runs it alongside a dozen other suites.
  it('is not idle at exactly the window, and is idle past it', () => {
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);

    sessionStorage.setItem(STAMP_KEY, String(now - VIEW_STATE_IDLE_MS));
    expect(isViewStateIdle()).toBe(false);

    sessionStorage.setItem(STAMP_KEY, String(now - VIEW_STATE_IDLE_MS - 1));
    expect(isViewStateIdle()).toBe(true);

    clock.mockRestore();
  });

  it('treats a tab that never stamped as NOT idle', () => {
    // A fresh tab has nothing persisted to expire; reporting it idle would make
    // every first mount run a pointless sweep.
    expect(isViewStateIdle()).toBe(false);
  });

  it('treats a backwards clock (sleep/resume, NTP) as just-now, not expired', () => {
    sessionStorage.setItem(STAMP_KEY, String(Date.now() + 60 * 60 * 1000));
    expect(isViewStateIdle()).toBe(false);
  });
});

describe('expireViewStateIfIdle', () => {
  it('leaves everything alone inside the window', () => {
    sessionStorage.setItem('orders.filters', '{"q":"gauze"}');
    stampAgo(60_000);
    expect(expireViewStateIfIdle()).toBe(false);
    expect(sessionStorage.getItem('orders.filters')).toBe('{"q":"gauze"}');
  });

  it('clears every registered filter/search/page key once idle', () => {
    EXPIRING_VIEW_STATE_KEYS.forEach(({ store, key }) => {
      storeFor(store).setItem(key, '{"q":"gauze"}');
    });
    stampAgo(VIEW_STATE_IDLE_MS + 1);

    expect(expireViewStateIfIdle()).toBe(true);
    EXPIRING_VIEW_STATE_KEYS.forEach(({ store, key }) => {
      expect(storeFor(store).getItem(key)).toBeNull();
    });
  });

  // A `store` typo is silent — the key sits in the list looking covered and
  // never expires, which is the exact bug this file exists to prevent. These two
  // hide rows from localStorage; everything else is per-tab.
  it('registers each key against the store its page actually writes to', () => {
    const local = EXPIRING_VIEW_STATE_KEYS.filter(k => k.store === 'local').map(k => k.key);
    expect(local.sort()).toEqual(['mapping.sold-filter.v1', 'pricing.exclude-oos']);
  });

  it('never touches unsaved work, sort, tab, page-size or printer state', () => {
    MUST_SURVIVE.forEach(([store, key]) => storeFor(store).setItem(key, 'keep-me'));
    stampAgo(VIEW_STATE_IDLE_MS + 1);

    expireViewStateIfIdle();
    MUST_SURVIVE.forEach(([store, key]) => {
      expect(storeFor(store).getItem(key)).toBe('keep-me');
    });
  });

  it('re-stamps so a second checkpoint does not sweep again', () => {
    sessionStorage.setItem('orders.filters', '{"q":"gauze"}');
    stampAgo(VIEW_STATE_IDLE_MS + 1);

    expect(expireViewStateIfIdle()).toBe(true);
    expect(isViewStateIdle()).toBe(false);
    expect(expireViewStateIfIdle()).toBe(false);
  });

  it('reports false when idle but nothing was stored', () => {
    stampAgo(VIEW_STATE_IDLE_MS + 1);
    expect(expireViewStateIfIdle()).toBe(false);
  });

  it('notifies mounted lists asynchronously so they can reset in place', async () => {
    const seen = jest.fn();
    const off = onViewStateExpired(seen);

    sessionStorage.setItem('orders.filters', '{"q":"gauze"}');
    stampAgo(VIEW_STATE_IDLE_MS + 1);
    const before = viewStateEpoch();
    expireViewStateIfIdle();

    // Async on purpose: callers include useState initializers, where a
    // synchronous dispatch would setState on other hooks mid-render.
    expect(seen).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(seen).toHaveBeenCalledTimes(1);
    // The epoch is what lets a list ignore the sweep its OWN mount performed.
    expect(seen).toHaveBeenCalledWith(before + 1);
    expect(viewStateEpoch()).toBe(before + 1);

    off();
    window.dispatchEvent(new CustomEvent(VIEW_STATE_EXPIRED_EVENT));
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when it cleared nothing', async () => {
    const seen = jest.fn();
    onViewStateExpired(seen);
    stampAgo(VIEW_STATE_IDLE_MS + 1);
    expireViewStateIfIdle();
    await Promise.resolve();
    expect(seen).not.toHaveBeenCalled();
  });
});

// installViewStateExpiry() is the only thing the entrypoint calls, so the
// boot sweep and the return-to-tab checkpoints are covered here rather than by
// booting the app.
describe('installViewStateExpiry', () => {
  const installed = [];

  afterEach(() => {
    installed.splice(0).forEach(off => off());
  });

  function install() {
    // Track listeners so repeated installs across tests don't stack up.
    const added = [];
    const wrap = (target, orig) => (type, fn, opts) => {
      added.push(() => target.removeEventListener(type, fn, opts));
      return orig.call(target, type, fn, opts);
    };
    const winOrig = window.addEventListener;
    const docOrig = document.addEventListener;
    window.addEventListener = wrap(window, winOrig);
    document.addEventListener = wrap(document, docOrig);
    try {
      installViewStateExpiry();
    } finally {
      window.addEventListener = winOrig;
      document.addEventListener = docOrig;
    }
    installed.push(() => added.forEach(off => off()));
  }

  it('clears stale filters at boot, before anything renders', () => {
    sessionStorage.setItem('orders.filters', '{"q":"gauze"}');
    stampAgo(VIEW_STATE_IDLE_MS + 1);

    install();

    expect(sessionStorage.getItem('orders.filters')).toBeNull();
    // Re-stamped, so the freshly loaded tab is not immediately idle again.
    expect(isViewStateIdle()).toBe(false);
  });

  it('keeps filters at boot when the tab was used recently', () => {
    sessionStorage.setItem('orders.filters', '{"q":"gauze"}');
    stampAgo(60_000);

    install();

    expect(sessionStorage.getItem('orders.filters')).toBe('{"q":"gauze"}');
  });

  it('sweeps on return to the tab, not on a timer', () => {
    install();
    sessionStorage.setItem('orders.filters', '{"q":"gauze"}');

    // Still here, just not clicking: a filtered list must NOT be yanked away
    // from someone reading it.
    stampAgo(VIEW_STATE_IDLE_MS + 1);
    expect(sessionStorage.getItem('orders.filters')).toBe('{"q":"gauze"}');

    // Came back to the tab — now it goes.
    window.dispatchEvent(new Event('focus'));
    expect(sessionStorage.getItem('orders.filters')).toBeNull();
  });

  it('starts the idle clock when the tab is hidden, not at the last click', () => {
    install();
    stampAgo(10 * 60 * 1000); // last click 10 minutes ago

    // Switching away stamps: the 15 minutes should count from LEAVING, so
    // returning 6 minutes later keeps the filters rather than a 16-minute total
    // expiring them.
    document.dispatchEvent(new Event('visibilitychange'));
    expect(isViewStateIdle()).toBe(false);
    expect(Number(sessionStorage.getItem(STAMP_KEY))).toBeGreaterThan(
      Date.now() - 10 * 60 * 1000,
    );
  });

  it('re-stamps on interaction, at most once per 30s', () => {
    install();
    const t0 = Date.now();
    const clock = jest.spyOn(Date, 'now');

    // Ten minutes of reading, then a keystroke: the window restarts from there.
    clock.mockReturnValue(t0 + 10 * 60 * 1000);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(Number(sessionStorage.getItem(STAMP_KEY))).toBe(t0 + 10 * 60 * 1000);

    // The next keystroke a second later is throttled away — one storage write
    // per 30s, not one per keystroke/scroll frame.
    clock.mockReturnValue(t0 + 10 * 60 * 1000 + 1_000);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b' }));
    expect(Number(sessionStorage.getItem(STAMP_KEY))).toBe(t0 + 10 * 60 * 1000);

    clock.mockRestore();
  });
});
