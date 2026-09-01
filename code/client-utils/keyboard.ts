/**
 * Shared guard for global keyboard shortcuts. Returns true when a key event
 * must NOT be treated as a shortcut: the user is typing, another handler
 * already consumed it, or a modal/drawer owns the screen.
 */
export function isTypingContext(
  e: { defaultPrevented?: boolean; target?: EventTarget | null },
): boolean {
  if (e.defaultPrevented) return true;
  const t = e.target as HTMLElement | null;
  if (t && typeof t.tagName === 'string') {
    const tag = t.tagName.toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if ((t as HTMLElement).isContentEditable || t.getAttribute?.('contenteditable') === 'true') return true;
  }
  // Modal / drawer / confirm own the keyboard while open (their own Esc wins).
  if (document.querySelector('[role="dialog"], .modal-overlay, .drawer-overlay')) return true;
  return false;
}
