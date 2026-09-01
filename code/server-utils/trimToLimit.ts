'use strict';

/**
 * Trim `text` to at most `limit` characters, cutting at a WORD boundary.
 *
 * Blind `.slice(0, n)` cuts mid-word and strands the load-bearing tail of a
 * product title ("...20 Disposable Plas"). This cuts at the last space at or
 * before the limit instead. No ellipsis is appended — on a marketplace title
 * a trailing "…" both wastes a character and reads as broken.
 */
function trimToLimit(text, limit) {
  const s = String(text == null ? '' : text);
  if (!(limit > 0)) return '';
  if (s.length <= limit) return s;

  const window = s.slice(0, limit);
  const lastSpace = window.lastIndexOf(' ');
  // No space in range means the first word alone is over-long — hard-cut it.
  if (lastSpace <= 0) return window;
  return window.slice(0, lastSpace).trimEnd();
}

export { trimToLimit };
