import { useState, useCallback } from 'react';

interface SelectableRow {
  id: unknown;
}

/**
 * Generic bulk-selection hook for list views.
 *
 * Two layers of "all selected":
 *   - `allSelectedViaHeader` — user ticked the header checkbox; only the
 *     currently loaded rows are selected (client-side).
 *   - `selectAllActive`      — user then clicked the "Select all N matching"
 *     banner; bulk operations should resolve ids from filters on the server
 *     instead of shipping the loaded-row ids.
 *
 * Returns an object identical in shape to the original page-local
 * implementation, so existing callers can point at this hook with no further
 * changes.
 */
export function useBulkSelection() {
  const [selected, setSelectedState] = useState<Set<unknown>>(() => new Set());
  const [selectAllActive, setSelectAllActive] = useState(false);
  const [allSelectedViaHeader, setAllSelectedViaHeader] = useState(false);

  const setSelected = useCallback((ids: Iterable<unknown> | null | undefined) => {
    setAllSelectedViaHeader(false);
    setSelectedState(new Set(ids));
  }, []);

  const markAllSelectedViaHeader = useCallback((v: boolean) => {
    setAllSelectedViaHeader(v);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedState(new Set());
    setSelectAllActive(false);
    setAllSelectedViaHeader(false);
  }, []);

  const triggerSelectAll = useCallback((loadedRows: SelectableRow[] | null | undefined) => {
    setSelectAllActive(true);
    setSelectedState(new Set((loadedRows || []).map((r) => r.id)));
  }, []);

  const bulkIds = useCallback(
    () => (selectAllActive ? [] : Array.from(selected)),
    [selectAllActive, selected],
  );

  const bulkFilters = useCallback(
    (apiParams: unknown) => (selectAllActive ? apiParams : undefined),
    [selectAllActive],
  );

  return {
    selected, selectAllActive, allSelectedViaHeader,
    setSelected, markAllSelectedViaHeader,
    triggerSelectAll, clearSelection,
    bulkIds, bulkFilters,
  };
}
