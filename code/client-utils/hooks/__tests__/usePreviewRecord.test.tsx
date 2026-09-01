import { renderHook, act } from '@testing-library/react';
import { usePreviewRecord } from '../usePreviewRecord';

beforeEach(() => localStorage.clear());

test('defaults to empty string when nothing stored', () => {
  const { result } = renderHook(() => usePreviewRecord('invoice'));
  expect(result.current[0]).toBe('');
});

test('persists the set value under docs:lastPreview:<key>', () => {
  const { result } = renderHook(() => usePreviewRecord('invoice'));
  act(() => result.current[1]('ORD-10293'));
  expect(result.current[0]).toBe('ORD-10293');
  expect(localStorage.getItem('docs:lastPreview:invoice')).toBe('ORD-10293');
});

test('rehydrates a previously stored value on mount', () => {
  localStorage.setItem('docs:lastPreview:quote', 'ORD-555');
  const { result } = renderHook(() => usePreviewRecord('quote'));
  expect(result.current[0]).toBe('ORD-555');
});

test('switching templateKey reads that key independently', () => {
  localStorage.setItem('docs:lastPreview:a', 'A1');
  localStorage.setItem('docs:lastPreview:b', 'B1');
  const { result, rerender } = renderHook(({ k }) => usePreviewRecord(k), { initialProps: { k: 'a' } });
  expect(result.current[0]).toBe('A1');
  rerender({ k: 'b' });
  expect(result.current[0]).toBe('B1');
});
