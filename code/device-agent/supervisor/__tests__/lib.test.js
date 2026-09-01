'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const lib = require('../lib');

test('parseEnvFile reads KEY=value lines, ignores junk', () => {
  const env = lib.parseEnvFile('APP_URL=https://x\nPRINTER_KEY=abc\n# comment\n\n');
  assert.equal(env.APP_URL, 'https://x');
  assert.equal(env.PRINTER_KEY, 'abc');
});

test('rewriteEnvKey replaces only the target line, preserves the rest', () => {
  const before = 'APP_URL=https://x\nPRINTER_KEY=old\nPOLL_INTERVAL_MS=2000\n';
  const after = lib.rewriteEnvKey(before, 'PRINTER_KEY', 'new');
  assert.ok(after.includes('PRINTER_KEY=new'));
  assert.ok(after.includes('APP_URL=https://x'));
  assert.ok(after.includes('POLL_INTERVAL_MS=2000'));
  assert.ok(!after.includes('PRINTER_KEY=old'));
});

test('rewriteEnvKey appends the key when absent', () => {
  const after = lib.rewriteEnvKey('APP_URL=https://x\n', 'PRINTER_KEY', 'new');
  assert.ok(after.includes('PRINTER_KEY=new'));
  assert.ok(after.includes('APP_URL=https://x'));
});

test('shouldUpdate: true only when manifest differs and is not rejected', () => {
  assert.equal(lib.shouldUpdate({ localSha: 'a', manifestSha: 'b', rejected: [] }), true);
  assert.equal(lib.shouldUpdate({ localSha: 'a', manifestSha: 'a', rejected: [] }), false);
  assert.equal(lib.shouldUpdate({ localSha: 'a', manifestSha: 'b', rejected: ['b'] }), false);
  assert.equal(lib.shouldUpdate({ localSha: 'a', manifestSha: '', rejected: [] }), false);
});

test('probationVerdict: healthy wins; 3 crashes or window elapsed = rollback', () => {
  assert.equal(lib.probationVerdict({ healthySeen: true, crashCount: 9, elapsedMs: 1 }), 'healthy');
  assert.equal(lib.probationVerdict({ healthySeen: false, crashCount: 3, elapsedMs: 1 }), 'rollback');
  assert.equal(lib.probationVerdict({ healthySeen: false, crashCount: 0, elapsedMs: 999999 }), 'rollback');
  assert.equal(lib.probationVerdict({ healthySeen: false, crashCount: 0, elapsedMs: 1 }), 'pending');
});

test('watchdogVerdict: restart only when heartbeat is stale past grace', () => {
  // fresh heartbeat -> ok
  assert.equal(lib.watchdogVerdict({ heartbeatAgeMs: 1000, childUptimeMs: 999999 }), 'ok');
  // stale heartbeat, agent up long enough -> restart
  assert.equal(lib.watchdogVerdict({ heartbeatAgeMs: 200000, childUptimeMs: 999999 }), 'restart');
  // stale heartbeat but child just spawned (within grace) -> ok (give it time)
  assert.equal(lib.watchdogVerdict({ heartbeatAgeMs: 200000, childUptimeMs: 5000 }), 'ok');
  // no heartbeat at all, past grace -> restart
  assert.equal(lib.watchdogVerdict({ heartbeatAgeMs: Infinity, childUptimeMs: 999999 }), 'restart');
});

test('deriveEndpoints maps role to base path + header/env names', () => {
  const p = lib.deriveEndpoints('print');
  assert.equal(p.base, '/api/print-queue/agent');
  assert.equal(p.headerKey, 'X-Printer-Key');
  assert.equal(p.envKey, 'PRINTER_KEY');
  const b = lib.deriveEndpoints('bridge');
  assert.equal(b.base, '/api/shipping-stations/agent');
  assert.equal(b.envKey, 'STATION_KEY');
  assert.throws(() => lib.deriveEndpoints('bogus'), /unknown role/);
});
