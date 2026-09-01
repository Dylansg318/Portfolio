import { useState, useCallback, useEffect } from 'react';

const storageKey = (templateKey: string) => `docs:lastPreview:${templateKey}`;

function read(templateKey: string): string {
  try {
    return localStorage.getItem(storageKey(templateKey)) || '';
  } catch {
    return '';
  }
}

/**
 * Remembers the last preview record (order id / SKU) chosen for a document
 * template, persisted per template under `docs:lastPreview:<templateKey>`.
 * Returns a [value, setValue] pair like useState.
 */
export function usePreviewRecord(templateKey: string): [string, (v: string) => void] {
  const [value, setValue] = useState<string>(() => read(templateKey));

  // Re-read when the templateKey changes (editor switched templates).
  useEffect(() => {
    setValue(read(templateKey));
  }, [templateKey]);

  const set = useCallback(
    (v: string) => {
      setValue(v);
      try {
        localStorage.setItem(storageKey(templateKey), v);
      } catch {
        /* private mode / quota — keep in-memory value */
      }
    },
    [templateKey],
  );

  return [value, set];
}
