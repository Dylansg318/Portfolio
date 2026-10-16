#!/usr/bin/env node
/**
 * Turn live Zen (Claude acting in your own open Zen through the zen MCP's live_* tools)
 * on or off. You run it — it restarts your browser.
 *
 *   node zen-live.mjs on       # restart Zen with remote control on (tabs come back)
 *   node zen-live.mjs off      # restart Zen normally
 *   node zen-live.mjs status
 *
 * Why a restart: this Zen build has no "turn on remote control" button yet (Firefox's
 * strings and banner are there, the button isn't), so remote control comes from the
 * --remote-debugging-port launch flag. Started that way, Firefox treats the browser as
 * a test robot: while it is on, every site sees navigator.webdriver = true, so leave it
 * off when Claude isn't working in Zen.
 *
 * It also writes one line to the profile's user.js, before the first start, that stops
 * Firefox's "recommended automation preferences" — ~110 settings meant for throwaway test
 * browsers (phishing and malware protection off, password saving off, pop-up blocker off,
 * crash recovery off), which would otherwise be applied to your real browser and stick
 * after a crash.
 */

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ZEN_BIN, findZenProfile } from './profile.mjs';

const APP = '/Applications/Zen.app';
const FLAG = '--remote-debugging-port';
const PREF_LINE = 'user_pref("remote.prefs.recommended", false);';
const SELF = fileURLToPath(import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Your everyday Zen (not the headless copies the zen MCP runs on its own profiles). */
function mainZen() {
  const hit = execFileSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' })
    .split('\n')
    .map((l) => l.trim().match(/^(\d+)\s+(.*)$/))
    .filter(Boolean)
    .find(([, , cmd]) => (cmd === ZEN_BIN || cmd.startsWith(`${ZEN_BIN} `)) && !cmd.includes('--headless'));
  return hit ? { pid: Number(hit[1]), remote: hit[2].includes(FLAG) } : null;
}

function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port }, () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.setTimeout(1500, () => { s.destroy(); resolve(false); });
  });
}

function endpointFile(profileDir) {
  try { return JSON.parse(fs.readFileSync(path.join(profileDir, 'WebDriverBiDiServer.json'), 'utf8')); } catch { return null; }
}

function ensurePrefLine(profileDir) {
  const file = path.join(profileDir, 'user.js');
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (current.includes(PREF_LINE)) return false;
  fs.appendFileSync(file, `${current.endsWith('\n') || !current ? '' : '\n'}
// --- Remote control for Claude (live Zen, ${SELF}) ---
// Only matters while Zen runs with remote control on. Stops Firefox applying its
// ~110 test-robot settings to this real profile (phishing/malware protection off,
// password saving off, pop-up blocker off, no crash recovery).
${PREF_LINE}
`);
  return true;
}

async function quitZen(pid) {
  execFileSync('/usr/bin/osascript', ['-e', 'tell application id "app.zen-browser.zen" to quit']);
  for (let i = 0; i < 120; i++) {
    try { process.kill(pid, 0); } catch { return; }
    await sleep(500);
  }
  throw new Error('Zen did not quit within 60s — answer its quit prompt if one is open, then run this again.');
}

async function waitForRemote(profileDir, since) {
  for (let i = 0; i < 60; i++) {
    const info = endpointFile(profileDir);
    let fresh = false;
    try { fresh = fs.statSync(path.join(profileDir, 'WebDriverBiDiServer.json')).mtimeMs >= since; } catch { /* not yet */ }
    if (info && fresh && await portOpen(info.ws_port)) return info.ws_port;
    await sleep(500);
  }
  return null;
}

async function status() {
  const z = mainZen();
  const profileDir = findZenProfile();
  const info = endpointFile(profileDir);
  const listening = z?.remote && info ? await portOpen(info.ws_port) : false;
  if (!z) return 'Zen is not running.';
  if (listening) return `Live Zen is ON (remote control on port ${info.ws_port}; every site sees an automated browser until it is off). Turn off: node "${SELF}" off`;
  return `Live Zen is OFF (Zen is running normally). Turn on: node "${SELF}" on`;
}

async function on() {
  const profileDir = findZenProfile();
  if (ensurePrefLine(profileDir)) console.log(`Added the protective line to ${path.join(profileDir, 'user.js')}.`);
  const z = mainZen();
  if (z?.remote) return status();
  if (z) {
    console.log('Quitting Zen (your tabs come back on restart)…');
    await quitZen(z.pid);
  }
  const since = Date.now() - 1000;
  execFileSync('/usr/bin/open', ['-a', APP, '--args', `${FLAG}=0`]);
  const port = await waitForRemote(profileDir, since);
  if (!port) return 'Zen restarted, but remote control did not come up within 30s. Check Zen, then run status.';
  return `Live Zen is ON (port ${port}). Claude can now use the live_* tools. Turn it off when done: node "${SELF}" off`;
}

async function off() {
  const z = mainZen();
  if (!z?.remote) return 'Live Zen is already off.';
  console.log('Quitting Zen (your tabs come back on restart)…');
  await quitZen(z.pid);
  execFileSync('/usr/bin/open', ['-a', APP]);
  return 'Live Zen is OFF — Zen restarted normally.';
}

const cmd = process.argv[2] ?? 'status';
const run = { on, off, status }[cmd];
if (!run) {
  console.error('Usage: node zen-live.mjs on|off|status');
  process.exit(2);
}
try {
  console.log(await run());
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
