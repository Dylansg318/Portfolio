import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { expireViewStateIfIdle } from '../viewStateTtl';
import { useViewStateExpiry } from './useViewStateExpiry';

type Filters = Record<string, unknown>;
type ClampFn = (value: number) => number;

interface PageConfig {
  storage?: string;
  storageKey?: string;
  initial?: number | string;
}
interface PageSizeConfig {
  storage?: string;
  storageKey?: string;
  defaultValue?: number | string;
  clamp?: ClampFn;
}
interface SearchConfig {
  key: string;
  mode?: 'immediate' | 'debounced';
  debounceMs?: number;
  trim?: boolean;
}
interface FiltersPersistence {
  storage: string;
  storageKey: string;
  mergeDefaults?: boolean;
}
type ResetKeys = ((filters: Filters) => unknown[]) | string[] | undefined;

interface UseListQueryStateOptions {
  initialFilters: Filters;
  resetKeys?: ResetKeys;
  page?: PageConfig;
  pageSize?: PageSizeConfig;
  search?: false | SearchConfig;
  filtersPersistence?: false | FiltersPersistence;
}

function getStorage(storageName?: string | null): Storage | null {
  if (!storageName || storageName === 'none') return null;
  try {
    return ((globalThis as Record<string, unknown>)?.[storageName] as Storage | undefined) || null;
  } catch {
    return null;
  }
}

function readStorage(storageName?: string | null, key?: string | null): string | null {
  const storage = getStorage(storageName);
  if (!storage || !key) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(storageName: string | undefined, key: string | undefined, value: string): void {
  const storage = getStorage(storageName);
  if (!storage || !key) return;
  try {
    storage.setItem(key, value);
  } catch {
    // Ignore quota / privacy-mode failures to match existing list hooks.
  }
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const n = Number.parseInt(value as string, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function applyClamp(value: number, clamp?: ClampFn): number {
  return typeof clamp === 'function' ? clamp(value) : value;
}

function readInitialPage(config: PageConfig): number {
  const initial = parsePositiveInt(config.initial, 1);
  const stored = readStorage(config.storage, config.storageKey);
  return parsePositiveInt(stored, initial);
}

function readInitialPageSize(config: PageSizeConfig): number {
  const fallback = parsePositiveInt(config.defaultValue, 50);
  const stored = readStorage(config.storage, config.storageKey);
  const value = parsePositiveInt(stored, fallback);
  return applyClamp(value, config.clamp);
}

function readInitialFilters(initialFilters: Filters, persistence: false | FiltersPersistence): Filters {
  if (!persistence) return initialFilters;

  const raw = readStorage(persistence.storage, persistence.storageKey);
  if (!raw) return initialFilters;

  try {
    const stored = JSON.parse(raw);
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
      return initialFilters;
    }
    if (persistence.mergeDefaults === false) return stored;
    return { ...initialFilters, ...stored };
  } catch {
    return initialFilters;
  }
}

function getResetValues(resetKeys: ResetKeys, filters: Filters): unknown[] {
  if (typeof resetKeys === 'function') return resetKeys(filters);
  if (Array.isArray(resetKeys)) return resetKeys.map(key => filters?.[key]);
  return Object.keys(filters || {}).map(key => filters[key]);
}

function signatureFor(values: unknown): string {
  try {
    return JSON.stringify(values);
  } catch {
    return String(values);
  }
}

export function useListQueryState({
  initialFilters,
  resetKeys,
  page = {},
  pageSize = {},
  search = false,
  filtersPersistence = false,
}: UseListQueryStateOptions) {
  const initialFiltersRef = useRef(initialFilters);
  const pageStorage = page.storage || 'none';
  const pageSizeStorage = pageSize.storage || 'none';
  const filtersStorage = filtersPersistence ? filtersPersistence.storage : 'none';
  // Primitive, deliberately: callers pass `filtersPersistence` as an inline
  // object literal, so depending on the OBJECT made the write-through effect
  // below fire on every render — a synchronous storage write per render instead
  // of one per filter change.
  const filtersStorageKey = filtersPersistence ? filtersPersistence.storageKey : null;
  const searchKey = search ? search.key : null;
  const searchMode = search ? search.mode || 'immediate' : null;
  const searchDebounceMs = search ? search.debounceMs ?? 350 : 0;
  const trimSearch = Boolean(search && search.trim);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The reset-to-page-1 effect must fire when the filters CHANGE, and never on
  // mount — a page restored from storage would otherwise be stomped back to 1.
  // This holds the last signature ACTED ON rather than a "have I run yet?" flag,
  // because React.StrictMode (dev) double-invokes effects: a flag is already set
  // on the second invocation, which then reads the mount as a filter change and
  // resets the restored page. Comparing values is idempotent under re-invocation.
  const lastResetSignatureRef = useRef(null);

  const [filters, setFiltersState] = useState<Filters>(() => {
    // Route mount is an expiry checkpoint: drop persisted filters/page that have
    // outlived their 15-minute idle window BEFORE reading them back.
    expireViewStateIfIdle();
    return readInitialFilters(initialFiltersRef.current, filtersPersistence);
  });
  const [pageValue, setPageValue] = useState(() => readInitialPage(page));
  const [pageSizeValue, setPageSizeValue] = useState(() => readInitialPageSize(pageSize));
  const [searchDraft, setSearchDraft] = useState(() => (
    searchKey ? (filters?.[searchKey] || '') : ''
  ));
  const [filterResetKey, setFilterResetKey] = useState(0);

  const resetSignature = useMemo(
    () => signatureFor(getResetValues(resetKeys, filters)),
    [filters, resetKeys],
  );

  const persistPage = useCallback((nextPage: number) => {
    writeStorage(pageStorage, page.storageKey, String(nextPage));
  }, [page.storageKey, pageStorage]);

  const setPage = useCallback((updater: number | ((prev: number) => number)) => {
    setPageValue(prev => {
      const rawNext = typeof updater === 'function' ? updater(prev) : updater;
      const next = parsePositiveInt(rawNext, prev);
      persistPage(next);
      return next;
    });
  }, [persistPage]);

  const setFilters = useCallback((updater: Filters | ((prev: Filters) => Filters)) => {
    setFiltersState(prev => (typeof updater === 'function' ? updater(prev) : updater));
  }, []);

  const patchFilters = useCallback((patch: Filters) => {
    setFiltersState(prev => ({ ...prev, ...patch }));
  }, []);

  const resetFilters = useCallback(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    setFiltersState(initialFiltersRef.current);
    setSearchDraft(searchKey ? (initialFiltersRef.current?.[searchKey] || '') : '');
    setPage(1);
    setFilterResetKey(v => v + 1);
  }, [searchKey, setPage]);

  const setPageSize = useCallback((value: unknown) => {
    const next = applyClamp(parsePositiveInt(value, pageSizeValue), pageSize.clamp);
    setPageSizeValue(next);
    writeStorage(pageSizeStorage, pageSize.storageKey, String(next));
    setPage(1);
  }, [pageSize.clamp, pageSize.storageKey, pageSizeStorage, pageSizeValue, setPage]);

  const handleSearchChange = useCallback((value: string) => {
    setSearchDraft(value);
    if (!searchKey) return;

    const nextValue = trimSearch ? String(value).trim() : value;
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    if (searchMode === 'debounced') {
      searchTimerRef.current = setTimeout(() => {
        setFiltersState(prev => ({ ...prev, [searchKey]: nextValue }));
      }, searchDebounceMs);
      return;
    }

    setFiltersState(prev => ({ ...prev, [searchKey]: nextValue }));
  }, [searchDebounceMs, searchKey, searchMode, trimSearch]);

  useEffect(() => () => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
  }, []);

  useEffect(() => {
    if (!filtersStorageKey) return;
    writeStorage(filtersStorage, filtersStorageKey, JSON.stringify(filters));
  }, [filters, filtersStorage, filtersStorageKey]);

  // A list left open in a background tab still holds its filters in memory —
  // reset those too, not just the persisted copy.
  useViewStateExpiry(resetFilters);

  useEffect(() => {
    if (lastResetSignatureRef.current === resetSignature) return;
    const isMount = lastResetSignatureRef.current === null;
    lastResetSignatureRef.current = resetSignature;
    if (isMount) return;
    setPage(1);
  }, [resetSignature, setPage]);

  return {
    filters,
    setFilters,
    patchFilters,
    resetFilters,
    page: pageValue,
    setPage,
    pageSize: pageSizeValue,
    setPageSize,
    searchDraft,
    setSearchDraft,
    handleSearchChange,
    filterResetKey,
  };
}
