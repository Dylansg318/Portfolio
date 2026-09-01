// Auto-reload when a lazy-loaded JS chunk fails to fetch.
// Happens after a redeploy: the browser holds the old index.html
// referencing chunk hashes that no longer exist, so import() returns
// HTML and triggers a MIME TypeError.
//
// Triggers ONLY on dynamic-import failures (route navigation, code-splits).
// Does NOT fire while interacting with already-loaded code.
//
// SessionStorage guard prevents reload loops if the reload itself fails.

const RELOAD_KEY = 'chunk_reload_attempted_at';
const RELOAD_COOLDOWN_MS = 30_000;

function looksLikeChunkLoadError(reason: unknown): boolean {
  if (!reason) return false;
  const msg = String((reason as { message?: unknown }).message || reason);
  return (
    msg.includes("'text/html' is not a valid JavaScript MIME type") ||
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('Loading chunk') ||
    /ChunkLoadError/i.test(msg)
  );
}

function attemptReload(): void {
  const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
  if (Date.now() - last < RELOAD_COOLDOWN_MS) return;
  sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  window.location.reload();
}

export function installChunkReloadHandler(): void {
  window.addEventListener('error', (e: ErrorEvent) => {
    if (looksLikeChunkLoadError(e?.error || e?.message)) attemptReload();
  });
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    if (looksLikeChunkLoadError(e?.reason)) attemptReload();
  });
  // Vite-native signal: fires whenever a Vite-managed dynamic import (lazy
  // route / code-split chunk) fails to load — e.g. the chunk hash no longer
  // exists after a redeploy. Message-independent, so it catches cases the
  // string matching above might miss and stays robust across Vite versions
  // (confirmed emitted by the Vite 8 / Rolldown build). Reuses attemptReload(),
  // so the same sessionStorage cooldown guards against reload loops.
  window.addEventListener('vite:preloadError', () => attemptReload());
}
