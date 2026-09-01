/**
 * In-memory ring buffer for recent server logs. Exposed through a diagnostics
 * endpoint to give an LLM debugging agent grep-able access to console output
 * without needing to redeploy with temp debug branches.
 *
 * Buffer is per-process — redeploys reset it. That's by design; this is a
 * live-debugging tool, not log retention. For longer history use the deploy
 * platform's own log viewer.
 *
 * Captures `console.log/info/warn/error/debug`. Structured (pino-style) logs
 * go through a separate stream and are NOT captured here — most ad-hoc
 * diagnostic logging in this codebase is raw console.*, which is the
 * intended target.
 */

const RING_SIZE = 5000;
const buffer = new Array(RING_SIZE);
let head = 0;
let count = 0;

function record(level: string, args: any[]): void {
  let line;
  try {
    line = args
      .map(a => typeof a === 'string' ? a : (a instanceof Error ? a.stack || a.message : JSON.stringify(a)))
      .join(' ');
  } catch {
    line = '[logCapture serialize error]';
  }
  buffer[head] = { ts: Date.now(), level, line: line.slice(0, 4000) };
  head = (head + 1) % RING_SIZE;
  if (count < RING_SIZE) count++;
}

export function snapshot({ since = 0, grep = '', limit = 500, level = '' }: { since?: number; grep?: string; limit?: number; level?: string } = {}): any[] {
  const out = [];
  const start = count < RING_SIZE ? 0 : head;
  let needle = null;
  if (grep) {
    try { needle = new RegExp(grep, 'i'); } catch { needle = null; }
  }
  const wantLevel = level && level !== 'all' ? level : '';
  for (let i = 0; i < count; i++) {
    const idx = (start + i) % RING_SIZE;
    const e = buffer[idx];
    if (!e) continue;
    if (since && e.ts < since) continue;
    if (wantLevel && e.level !== wantLevel) continue;
    if (needle && !needle.test(e.line)) continue;
    if (!needle && grep && !e.line.includes(grep)) continue;
    out.push(e);
  }
  return out.slice(-limit).reverse();
}

let installed = false;
export function install(): void {
  if (installed) return;
  installed = true;
  const levels = ['log', 'info', 'warn', 'error', 'debug'];
  for (const lvl of levels) {
    const orig = console[lvl].bind(console);
    console[lvl] = function patched(...args: any[]) {
      try { record(lvl, args); } catch { /* never block console */ }
      return orig(...args);
    };
  }
}

export function stats(): any {
  return { ring_size: RING_SIZE, count, oldest_ts: count > 0 ? buffer[count < RING_SIZE ? 0 : head]?.ts : null };
}
