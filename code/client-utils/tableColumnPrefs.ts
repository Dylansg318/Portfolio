import { useCallback, useRef, useState } from 'react';

/**
 * Per-browser persistence for a data table's hidden-column set.
 *
 * The column toggle lived in plain component state, so every table in the app
 * re-showed the columns you had just hidden on the next refresh — and on any
 * navigation that unmounted the page. Opt in by passing a `columnStateKey` to
 * the table component; tables without a key keep the old in-memory behavior,
 * so nothing changes for the ~40 call sites that don't ask for it.
 *
 * localStorage, not a server-backed preferences table: this is one small array
 * per table, and only one page's layout was ever worth a per-USER round trip.
 * Zero network cost here — a hidden-column list is not worth a request.
 *
 * Stored shape is the HIDDEN keys, not the visible ones: a column added later
 * then shows up by default instead of staying invisible behind a stale layout.
 */

function readHiddenCols(storageKey?: string): Set<string> {
  if (!storageKey) return new Set();
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey) as string);
    return Array.isArray(raw) ? new Set(raw.map(String)) : new Set();
  } catch { return new Set(); }
}

type Updater = Set<string> | ((current: Set<string>) => Set<string>);

export function usePersistedHiddenCols(
  storageKey?: string,
): [Set<string>, (updater: Updater) => void] {
  const [hiddenCols, setHiddenColsState] = useState<Set<string>>(() => readHiddenCols(storageKey));

  // Mirrors state so the updater can compute from the current value without
  // running the write inside a state updater — StrictMode double-invokes those.
  const ref = useRef(hiddenCols);
  ref.current = hiddenCols;

  const setHiddenCols = useCallback((updater: Updater) => {
    const next = typeof updater === 'function' ? updater(ref.current) : updater;
    ref.current = next;
    setHiddenColsState(next);
    if (!storageKey) return;
    try { localStorage.setItem(storageKey, JSON.stringify([...next])); } catch { /* quota */ }
  }, [storageKey]);

  return [hiddenCols, setHiddenCols];
}
