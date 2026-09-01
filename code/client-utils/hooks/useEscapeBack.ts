import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { isTypingContext } from '../keyboard';

/**
 * Escape on a detail page returns to its list (which restores page/scroll/
 * filters via the list-persistence layer). Modals win: while any dialog or
 * drawer is open, isTypingContext() is true and this hook stays quiet.
 *
 * Non-modal inline-edit surfaces (edit panels/forms rendered in-page, not in
 * a dialog) must consume Escape themselves — onKeyDown with e.preventDefault()
 * before their cancel action — so isTypingContext() sees defaultPrevented and
 * this hook doesn't navigate away mid-edit.
 */
export function useEscapeBack(fallback: string) {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || isTypingContext(e)) return;
      e.preventDefault();
      navigate((location.state as any)?.from || fallback);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navigate, fallback, location.state]);
}
