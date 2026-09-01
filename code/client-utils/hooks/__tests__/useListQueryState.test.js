import { StrictMode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { useListQueryState } from '../useListQueryState';

const DEFAULT_FILTERS = Object.freeze({ q: '', type: '', rep: '' });

describe('useListQueryState', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('returns initial filters, page 1, and default page size', () => {
    const { result } = renderHook(() => useListQueryState({
      initialFilters: DEFAULT_FILTERS,
      resetKeys: ['q', 'type', 'rep'],
      pageSize: { defaultValue: 50 },
    }));

    expect(result.current.filters).toEqual(DEFAULT_FILTERS);
    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(50);
  });

  test('reads page size from localStorage', () => {
    localStorage.setItem('list-page-size', '100');

    const { result } = renderHook(() => useListQueryState({
      initialFilters: DEFAULT_FILTERS,
      resetKeys: ['q'],
      pageSize: {
        storageKey: 'list-page-size',
        defaultValue: 50,
        storage: 'localStorage',
      },
    }));

    expect(result.current.pageSize).toBe(100);
  });

  test('writes page size to localStorage and resets page to 1', () => {
    const { result } = renderHook(() => useListQueryState({
      initialFilters: DEFAULT_FILTERS,
      resetKeys: ['q'],
      pageSize: {
        storageKey: 'list-page-size',
        defaultValue: 50,
        storage: 'localStorage',
      },
    }));

    act(() => result.current.setPage(3));
    expect(result.current.page).toBe(3);

    act(() => result.current.setPageSize(250));

    expect(result.current.pageSize).toBe(250);
    expect(result.current.page).toBe(1);
    expect(localStorage.getItem('list-page-size')).toBe('250');
  });

  test('supports optional page-size clamp', () => {
    localStorage.setItem('list-page-size', '9999');

    const { result } = renderHook(() => useListQueryState({
      initialFilters: DEFAULT_FILTERS,
      resetKeys: ['q'],
      pageSize: {
        storageKey: 'list-page-size',
        defaultValue: 50,
        storage: 'localStorage',
        clamp: (value) => Math.min(value, 500),
      },
    }));

    expect(result.current.pageSize).toBe(500);

    act(() => result.current.setPageSize(9999));

    expect(result.current.pageSize).toBe(500);
    expect(localStorage.getItem('list-page-size')).toBe('500');
  });

  test('resets page to 1 when configured filter keys change', () => {
    const { result } = renderHook(() => useListQueryState({
      initialFilters: DEFAULT_FILTERS,
      resetKeys: ['q', 'type'],
      pageSize: { defaultValue: 50 },
    }));

    act(() => result.current.setPage(4));
    act(() => result.current.patchFilters({ rep: 'unchanged-page' }));
    expect(result.current.page).toBe(4);

    act(() => result.current.patchFilters({ type: 'clinic' }));
    expect(result.current.page).toBe(1);
  });

  test('supports resetKeys as a function', () => {
    const { result } = renderHook(() => useListQueryState({
      initialFilters: DEFAULT_FILTERS,
      resetKeys: filters => [filters.q, filters.type],
      pageSize: { defaultValue: 50 },
    }));

    act(() => result.current.setPage(4));
    act(() => result.current.patchFilters({ rep: 'rep-1' }));
    expect(result.current.page).toBe(4);

    act(() => result.current.patchFilters({ q: 'acme' }));
    expect(result.current.page).toBe(1);
  });

  test('supports immediate search by writing directly to filters.q', () => {
    const { result } = renderHook(() => useListQueryState({
      initialFilters: DEFAULT_FILTERS,
      resetKeys: ['q'],
      pageSize: { defaultValue: 50 },
      search: { key: 'q', mode: 'immediate' },
    }));

    act(() => result.current.handleSearchChange('acme'));

    expect(result.current.searchDraft).toBe('acme');
    expect(result.current.filters.q).toBe('acme');
  });

  test('resetFilters restores initial filters, resets page, and bumps filterResetKey', () => {
    const { result } = renderHook(() => useListQueryState({
      initialFilters: DEFAULT_FILTERS,
      resetKeys: ['q'],
      pageSize: { defaultValue: 50 },
      search: { key: 'q', mode: 'immediate' },
    }));

    act(() => result.current.setPage(3));
    act(() => result.current.patchFilters({ q: 'acme', rep: 'rep-1' }));
    act(() => result.current.resetFilters());

    expect(result.current.filters).toEqual(DEFAULT_FILTERS);
    expect(result.current.searchDraft).toBe('');
    expect(result.current.page).toBe(1);
    expect(result.current.filterResetKey).toBe(1);
  });

  test('supports debounced search with fake timers', () => {
    jest.useFakeTimers();

    const { result } = renderHook(() => useListQueryState({
      initialFilters: DEFAULT_FILTERS,
      resetKeys: ['q'],
      pageSize: { defaultValue: 50 },
      search: {
        key: 'q',
        mode: 'debounced',
        debounceMs: 350,
      },
    }));

    act(() => result.current.handleSearchChange('acme'));

    expect(result.current.searchDraft).toBe('acme');
    expect(result.current.filters.q).toBe('');

    act(() => jest.advanceTimersByTime(349));
    expect(result.current.filters.q).toBe('');

    act(() => jest.advanceTimersByTime(1));
    expect(result.current.filters.q).toBe('acme');
  });

  test('ignores localStorage and sessionStorage failures', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });

    const { result } = renderHook(() => useListQueryState({
      initialFilters: DEFAULT_FILTERS,
      resetKeys: ['q'],
      page: {
        storageKey: 'list-page',
        storage: 'sessionStorage',
        initial: 2,
      },
      pageSize: {
        storageKey: 'list-page-size',
        defaultValue: 50,
        storage: 'localStorage',
      },
      filtersPersistence: {
        storageKey: 'list-filters',
        storage: 'sessionStorage',
      },
    }));

    expect(result.current.page).toBe(2);
    expect(result.current.pageSize).toBe(50);
    expect(result.current.filters).toEqual(DEFAULT_FILTERS);

    act(() => result.current.setPage(3));
    act(() => result.current.setPageSize(100));
    act(() => result.current.patchFilters({ q: 'acme' }));

    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(100);
    expect(result.current.filters.q).toBe('acme');
  });

  test('supports optional persisted filters and page only when configured', () => {
    localStorage.setItem('list-page', '4');
    localStorage.setItem('list-filters', JSON.stringify({ q: 'stored', rep: '42' }));

    const unpersisted = renderHook(() => useListQueryState({
      initialFilters: DEFAULT_FILTERS,
      resetKeys: ['q'],
      page: { initial: 1 },
      pageSize: { defaultValue: 50 },
    }));

    expect(unpersisted.result.current.page).toBe(1);
    expect(unpersisted.result.current.filters).toEqual(DEFAULT_FILTERS);
    unpersisted.unmount();

    const persisted = renderHook(() => useListQueryState({
      initialFilters: DEFAULT_FILTERS,
      resetKeys: ['q'],
      page: {
        storageKey: 'list-page',
        storage: 'localStorage',
        initial: 1,
        skipInitialReset: true,
      },
      pageSize: { defaultValue: 50 },
      filtersPersistence: {
        storageKey: 'list-filters',
        storage: 'localStorage',
        mergeDefaults: true,
      },
    }));

    expect(persisted.result.current.page).toBe(4);
    expect(persisted.result.current.filters).toEqual({ q: 'stored', type: '', rep: '42' });

    act(() => persisted.result.current.patchFilters({ q: 'changed' }));

    expect(persisted.result.current.page).toBe(1);
    expect(JSON.parse(localStorage.getItem('list-filters'))).toEqual({ q: 'changed', type: '', rep: '42' });
    expect(localStorage.getItem('list-page')).toBe('1');
  });

  // Callers pass `filtersPersistence` as an inline object literal, so the
  // write-through effect used to depend on a value with a fresh identity every
  // render — one synchronous storage write PER RENDER of the list page, not per
  // filter change. Storage writes are main-thread-blocking; the cost is small at
  // these payload sizes but it is paid on every keystroke-driven re-render.
  test('writes filters to storage once per CHANGE, not once per render', () => {
    const setItem = jest.spyOn(Storage.prototype, 'setItem');

    const { result, rerender } = renderHook(() => useListQueryState({
      initialFilters: DEFAULT_FILTERS,
      resetKeys: ['q'],
      pageSize: { defaultValue: 50 },
      filtersPersistence: { storageKey: 'list-filters', storage: 'localStorage' },
    }));

    const countFilterWrites = () =>
      setItem.mock.calls.filter(([key]) => key === 'list-filters').length;

    const afterMount = countFilterWrites();
    rerender(); rerender(); rerender();
    expect(countFilterWrites()).toBe(afterMount);

    act(() => result.current.patchFilters({ q: 'acme' }));
    expect(countFilterWrites()).toBe(afterMount + 1);
  });

  // Reported from a real dev server: a RESTORED page was stomped back to 1 on
  // mount under React.StrictMode, which double-invokes effects. A "have I run
  // before?" ref can't survive that — the second invocation finds the flag
  // already set and treats the mount as a filter change. The app only runs
  // StrictMode in dev, so this never reached production, but it made every
  // restored page look broken while developing. Guarding on the reset
  // signature's VALUE is idempotent under re-invocation.
  test('a restored page survives mount under StrictMode, and filters still reset it', () => {
    sessionStorage.setItem('list-page', '3');

    const { result } = renderHook(() => useListQueryState({
      initialFilters: DEFAULT_FILTERS,
      resetKeys: ['q'],
      page: { storage: 'sessionStorage', storageKey: 'list-page', initial: 1 },
      pageSize: { defaultValue: 50 },
    }), { wrapper: StrictMode });

    expect(result.current.page).toBe(3);
    expect(sessionStorage.getItem('list-page')).toBe('3');

    // The reset must still work — the fix must not simply disable it.
    act(() => result.current.patchFilters({ q: 'acme' }));
    expect(result.current.page).toBe(1);
  });

  // Persisted filters get a 15-minute idle life (viewStateTtl). sessionStorage
  // lives as long as the TAB, and this app is left open for days — a status filter
  // set on Tuesday was still silently subtracting rows on Friday.
  describe('idle expiry', () => {
    const STAMP_KEY = 'app.viewState.lastActivityAt';
    const IDLE_MS = 15 * 60 * 1000;

    function mount() {
      return renderHook(() => useListQueryState({
        initialFilters: DEFAULT_FILTERS,
        resetKeys: ['q'],
        page: { storage: 'sessionStorage', storageKey: 'customers.page', initial: 1 },
        pageSize: { defaultValue: 50 },
        search: { key: 'q' },
        filtersPersistence: { storage: 'sessionStorage', storageKey: 'customers.filters' },
      }));
    }

    test('restores persisted filters when the tab was used recently', () => {
      sessionStorage.setItem('customers.filters', JSON.stringify({ q: 'acme', type: 'lab' }));
      sessionStorage.setItem('customers.page', '4');
      sessionStorage.setItem(STAMP_KEY, String(Date.now() - 60_000));

      const { result } = mount();
      expect(result.current.filters).toEqual({ q: 'acme', type: 'lab', rep: '' });
      expect(result.current.page).toBe(4);
    });

    test('drops persisted filters, page and search draft after 15 idle minutes', () => {
      sessionStorage.setItem('customers.filters', JSON.stringify({ q: 'acme', type: 'lab' }));
      sessionStorage.setItem('customers.page', '4');
      sessionStorage.setItem(STAMP_KEY, String(Date.now() - IDLE_MS - 1_000));

      const { result } = mount();
      expect(result.current.filters).toEqual(DEFAULT_FILTERS);
      expect(result.current.searchDraft).toBe('');
      expect(result.current.page).toBe(1);
    });

    test('a list already mounted when the window lapses resets in place', async () => {
      sessionStorage.setItem(STAMP_KEY, String(Date.now()));
      const { result } = mount();

      act(() => result.current.patchFilters({ q: 'acme' }));
      expect(result.current.filters.q).toBe('acme');

      // The user walked away; the next focus/route-mount checkpoint sweeps.
      sessionStorage.setItem(STAMP_KEY, String(Date.now() - IDLE_MS - 1_000));
      const { expireViewStateIfIdle } = require('../../viewStateTtl');
      await act(async () => {
        expireViewStateIfIdle();
        await Promise.resolve();
      });

      expect(result.current.filters).toEqual(DEFAULT_FILTERS);
      expect(result.current.page).toBe(1);
    });
  });
});
