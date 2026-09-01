import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * A deep link into a list page DECLARES what should be on screen — it does not
 * add a term to whatever that browser tab was last looking at.
 *
 * Every list page here persists its filters (and usually its sort and page) to
 * sessionStorage so that clicking a row and coming back restores where you were.
 * That is right for the back button and wrong for an inbound link: the pages all
 * shipped a "pre-fill the search box from ?q=" effect, which left the rest of the
 * persisted scope standing. The result was the link's query INTERSECTED with a
 * scope the operator did not set on this trip — and on one page, whose store is
 * merged OVER the URL, the link's query was discarded outright.
 *
 * Reported from the live app: a product page's recent-orders panel linked into
 * the orders list, the tab still held a marketplace-channel filter from an
 * earlier search, and 1,803 matching orders rendered as "No orders found".
 *
 * This hook is the one seam for that. Give it the params your page understands
 * and a callback that REPLACES the page's scope from them (defaults + the URL
 * values, page back to 1, sort back to the page default). It then:
 *
 *   1. applies them once, after mount, so it wins over whatever the page
 *      restored from storage during its own initialisation, and
 *   2. CONSUMES them — strips the keys from the URL with `replace: true`.
 *
 * Consuming matters twice over. Clicking a row unmounts the list page, so a link
 * still sitting in the URL re-applies on the way back and stomps whatever the
 * operator narrowed to after landing (sessionStorage carries the state across
 * that trip instead). And it makes the SAME link work twice in a row — otherwise
 * the second navigation changes nothing, so nothing re-applies.
 *
 * @param keys   URL params this page consumes, e.g. ['q', 'status'].
 * @param apply  Receives only the keys actually present, as strings.
 * @returns A ref that is true once a deep link has been applied — for guarding
 *          any later effect that would re-narrow the scope the link declared.
 */
export function useDeepLinkParams(
  keys: string[],
  apply: (values: Record<string, string>) => void,
): { current: boolean } {
  const [searchParams, setSearchParams] = useSearchParams();
  const consumed = useRef(false);

  // The callback is re-created every render by every caller; keeping it in a ref
  // means the effect can depend on the URL alone. A dep on `apply` would re-run
  // it on every render — re-applying the deep link over the operator's edits.
  const applyRef = useRef(apply);
  applyRef.current = apply;

  // Value-based, not object-based: useSearchParams returns a new instance each
  // render, so depending on it directly would fire the effect forever.
  const present = keys.filter(k => searchParams.get(k) !== null);
  const signature = present.map(k => `${k}=${searchParams.get(k)}`).join('&');

  useEffect(() => {
    if (!signature) return;
    const values: Record<string, string> = {};
    present.forEach(k => { values[k] = searchParams.get(k) as string; });
    consumed.current = true;
    applyRef.current(values);
    const next = new URLSearchParams(searchParams);
    keys.forEach(k => next.delete(k));
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return consumed;
}
