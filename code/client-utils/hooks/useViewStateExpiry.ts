import { useEffect, useRef } from 'react';
import { onViewStateExpired, viewStateEpoch } from '../viewStateTtl';

/**
 * Resets a MOUNTED list when the 15-minute idle window lapses (viewStateTtl).
 *
 * Clearing sessionStorage only helps the next mount — a list already on screen
 * in a background tab still holds its filters in React state, which is exactly
 * the tab someone comes back to.
 *
 * The epoch guard is the point of this hook: the sweep usually fires from the
 * list's own mount checkpoint, and that list already read clean storage. Without
 * the guard it resets a second time one tick later, which in tests surfaces as
 * an un-acted state update and in the app as a redundant re-render.
 */
export function useViewStateExpiry(reset: () => void): void {
  // Captured AFTER the mount-time sweep, because hooks run in source order and
  // every caller runs its expiry checkpoint in an earlier hook call.
  const mountEpochRef = useRef(viewStateEpoch());
  const resetRef = useRef(reset);
  resetRef.current = reset;

  useEffect(() => onViewStateExpired((epoch) => {
    if (epoch > mountEpochRef.current) resetRef.current();
  }), []);
}
