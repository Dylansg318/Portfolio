'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');

process.env.LOG_PATH = path.join(os.tmpdir(), 'agent-test.log');
const lib = require('../agent');

const FAKE = path.join(__dirname, 'fake-bidi-serve.js');
const mk = (scenario, timeoutMs = 2000) =>
  lib.createBidiChannel({ cmd: process.execPath, args: [FAKE, scenario], timeoutMs, onLog: () => {} });

test('BidiChannel answers queries over one persistent serve child, in order', async () => {
  const ch = mk('ok');
  try {
    const r1 = await ch.query('hs');
    assert.equal(r1.ok, true);
    assert.equal(r1.hs.formatsInBuffer, 0);
    const r2 = await ch.query('sgd:odometer.total_print_length');
    assert.equal(r2.ok, true);
    assert.equal(r2.odometerInches, 1234);
    assert.equal(ch.serveSupported(), true);
  } finally { ch.dispose(); }
});

test('BidiChannel serializes concurrent queries (FIFO, one in flight)', async () => {
  const ch = mk('ok');
  try {
    const [a, b, c] = await Promise.all([ch.query('hs'), ch.query('sgd:odometer.total_print_length'), ch.query('hs')]);
    assert.equal(a.cmd, 'hs');
    assert.equal(b.odometerInches, 1234);
    assert.equal(c.cmd, 'hs');
  } finally { ch.dispose(); }
});

test('BidiChannel sniffs an old exe once and reports serve unsupported forever', async () => {
  const ch = mk('oldexe');
  try {
    const r = await ch.query('hs');
    assert.equal(r.ok, false);
    assert.equal(ch.serveSupported(), false);
    const r2 = await ch.query('hs');            // no respawn storm — immediate refusal
    assert.equal(r2.ok, false);
    assert.equal(ch.serveSupported(), false);
  } finally { ch.dispose(); }
});

test('BidiChannel times out a hung child, recycles it, and recovers on the next query', async () => {
  const ch = mk('hang', 300);
  try {
    const r = await ch.query('hs');
    assert.equal(r.ok, false);
    assert.match(String(r.error), /died|timeout|timed out/i);
    // channel stays usable: next query respawns (still the hang fake, so it
    // sniffs ok again — supported stays true — then times out again)
    const r2 = await ch.query('hs');
    assert.equal(r2.ok, false);
    assert.equal(ch.serveSupported(), true);
  } finally { ch.dispose(); }
});
