// Resolve a post-login redirect target from an untrusted ?next= value.
// The auth interceptor sets ?next= to the page the user was on when their
// session dropped. Guard against open redirects: only same-origin absolute
// paths are allowed (never protocol-relative '//evil.example' or a full URL),
// and never bounce back to /login. Anything else falls back to the default
// landing page.
export function safeNextPath(next: unknown, fallback: string = '/orders'): string {
  if (
    typeof next === 'string' &&
    next.startsWith('/') &&
    !next.startsWith('//') &&
    !next.includes('\\') && // browsers normalize '\' -> '/', so '/\evil.example' escapes origin
    !next.startsWith('/login')
  ) {
    return next;
  }
  return fallback;
}
