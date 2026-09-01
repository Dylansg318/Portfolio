import { renderHook, act } from '@testing-library/react';
import { usePersistedHiddenCols } from '../tableColumnPrefs';

const KEY = 'customers.columns';

describe('usePersistedHiddenCols', () => {
  beforeEach(() => localStorage.clear());

  test('without a key it stays in memory — the old behavior for every table that did not opt in', () => {
    const { result } = renderHook(() => usePersistedHiddenCols());
    act(() => result.current[1](new Set(['revenue'])));
    expect([...result.current[0]]).toEqual(['revenue']);
    expect(localStorage.length).toBe(0);
  });

  test('hidden columns survive a remount when a key is given', () => {
    const first = renderHook(() => usePersistedHiddenCols(KEY));
    act(() => first.result.current[1](s => new Set([...s, 'revenue'])));
    act(() => first.result.current[1](s => new Set([...s, 'zip'])));
    first.unmount();

    const again = renderHook(() => usePersistedHiddenCols(KEY));
    expect([...again.result.current[0]].sort()).toEqual(['revenue', 'zip']);
  });

  test('re-showing a column clears it from storage', () => {
    const first = renderHook(() => usePersistedHiddenCols(KEY));
    act(() => first.result.current[1](new Set(['revenue'])));
    act(() => first.result.current[1](new Set()));
    first.unmount();

    const again = renderHook(() => usePersistedHiddenCols(KEY));
    expect([...again.result.current[0]]).toEqual([]);
  });

  test('a corrupt stored value shows every column rather than breaking the table', () => {
    localStorage.setItem(KEY, '{not json');
    const { result } = renderHook(() => usePersistedHiddenCols(KEY));
    expect([...result.current[0]]).toEqual([]);
  });
});
