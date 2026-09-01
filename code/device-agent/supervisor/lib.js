'use strict';
// Pure helpers for the agent supervisor. No I/O, no process state —
// everything here is unit-tested in __tests__/lib.test.js.

// Parse a dotenv-style file into a plain object.
function parseEnvFile(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

// Replace (or append) a single KEY=value line, preserving every other line.
function rewriteEnvKey(text, keyName, newValue) {
  const lines = String(text).split(/\r?\n/);
  let found = false;
  const re = new RegExp('^\\s*' + keyName + '\\s*=');
  const next = lines.map((line) => {
    if (re.test(line)) { found = true; return keyName + '=' + newValue; }
    return line;
  });
  if (!found) {
    while (next.length && next[next.length - 1] === '') next.pop();
    next.push(keyName + '=' + newValue, '');
  }
  return next.join('\n');
}

// Decide whether to download a new agent version.
function shouldUpdate({ localSha, manifestSha, rejected }) {
  if (!manifestSha || manifestSha === localSha) return false;
  if (Array.isArray(rejected) && rejected.includes(manifestSha)) return false;
  return true;
}

// Probation state machine for a freshly-swapped agent.js.
function probationVerdict({ healthySeen, crashCount, elapsedMs, windowMs = 90000, maxCrashes = 3 }) {
  if (healthySeen) return 'healthy';
  if (crashCount >= maxCrashes) return 'rollback';
  if (elapsedMs >= windowMs) return 'rollback';
  return 'pending';
}

// Endpoints + header/env names for a role.
function deriveEndpoints(role) {
  if (role === 'print') {
    return {
      base: '/api/print-queue/agent',
      headerId: 'X-Printer-Id', headerKey: 'X-Printer-Key',
      envId: 'PRINTER_ID', envKey: 'PRINTER_KEY',
    };
  }
  if (role === 'bridge') {
    return {
      base: '/api/shipping-stations/agent',
      headerId: 'X-Station-Id', headerKey: 'X-Station-Key',
      envId: 'STATION_ID', envKey: 'STATION_KEY',
    };
  }
  throw new Error('deriveEndpoints: unknown role ' + role);
}

// Decide whether a running agent child should be force-restarted because it is
// frozen-but-alive (e.g. stuck in a hung print). heartbeatAgeMs = now minus the
// agent-health.json `healthyAt` (Infinity if the file is missing/unreadable).
// graceMs suppresses a restart right after (re)spawn so a just-started agent
// that hasn't written its first heartbeat yet is not killed.
function watchdogVerdict({ heartbeatAgeMs, childUptimeMs, staleMs = 120000, graceMs = 60000 }) {
  if (childUptimeMs < graceMs) return 'ok';
  if (!Number.isFinite(heartbeatAgeMs)) return 'restart';
  if (heartbeatAgeMs > staleMs) return 'restart';
  return 'ok';
}

module.exports = { parseEnvFile, rewriteEnvKey, shouldUpdate, probationVerdict, deriveEndpoints, watchdogVerdict };
