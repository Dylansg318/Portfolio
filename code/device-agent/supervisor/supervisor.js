#!/usr/bin/env node
// Agent Supervisor
// Runs on the Windows host (launched by the scheduled task). Spawns the role's
// agent.js as a child, keeps it alive, auto-updates agent.js from the server
// (probation + rollback + circuit breaker), and auto-rotates the API key.
// NEVER updates itself — it is the rollback executor.
'use strict';

const fs     = require('fs');
const path   = require('path');
const http   = require('http');
const https  = require('https');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');
const lib = require('./lib');

// --- constant paths (pure — safe at module load) ---------------------------
const DIR         = __dirname;
const ENV_PATH    = path.join(DIR, '.env');
const AGENT_PATH  = path.join(DIR, 'agent.js');
const PREV_PATH   = path.join(DIR, 'agent.prev.js');
const NEXT_PATH   = path.join(DIR, 'agent.next.js');
const STATE_PATH  = path.join(DIR, 'agent-state.json');
const HEALTH_PATH = path.join(DIR, 'agent-health.json');
const LOG_PATH    = path.join(DIR, 'supervisor.log');

// --- module-scoped runtime state (populated by init()) ---------------------
let logFd = null;
let env, ROLE, APP_URL, ep, API_KEY, ENTITY_ID, CHECK_INTERVAL_MS;
let state = { rejected: [], lastGood: null };
let child = null;
let childSpawnedAt = 0;
let watchdogKillAt = 0; // when the watchdog last issued a kill (0 = none pending)
let probation = null; // { version, startedAt, crashCount }
let killIntent = false; // true while a supervisor-initiated child.kill() is pending

function log(...a) {
  const line = new Date().toISOString() + ' [supervisor] ' + a.map(String).join(' ') + '\n';
  if (logFd !== null) { try { fs.writeSync(logFd, line); } catch {} }
  process.stdout.write(line);
}

function fileSha(p) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
  catch { return null; }
}
function selfSha() { return fileSha(__filename); }
function currentAgentVersion() { return fileSha(AGENT_PATH); }

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); }
  catch { return { rejected: [], lastGood: null }; }
}
function saveState() { try { fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2)); } catch {} }

function init() {
  try { logFd = fs.openSync(LOG_PATH, 'a'); } catch {}
  env = lib.parseEnvFile(fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '');
  ROLE = env.AGENT_ROLE || 'print';
  APP_URL = (env.APP_URL || '').replace(/\/+$/, '');
  ep = lib.deriveEndpoints(ROLE);
  API_KEY = env[ep.envKey] || '';
  ENTITY_ID = env[ep.envId] || '';
  CHECK_INTERVAL_MS = 3 * 60 * 1000 + Math.floor(Math.random() * 60 * 1000); // ~3min jittered
  state = loadState();
  if (!APP_URL || !ENTITY_ID || !API_KEY) {
    throw new Error('missing APP_URL / ' + ep.envId + ' / ' + ep.envKey + ' in .env');
  }
}

// --- HTTP ------------------------------------------------------------------
function request(method, urlPath, { body = null, raw = false } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(APP_URL + urlPath);
    const httpLib = u.protocol === 'https:' ? https : http;
    const headers = { [ep.headerId]: ENTITY_ID, [ep.headerKey]: API_KEY };
    if (body) headers['Content-Type'] = 'application/json';
    const r = httpLib.request({
      method, hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search, headers, timeout: 10000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (raw) return resolve({ status: res.statusCode, buf });
        let parsed = null; const t = buf.toString('utf8');
        if (t) { try { parsed = JSON.parse(t); } catch {} }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(new Error('request timeout')); });
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

// --- agent child management ------------------------------------------------
function spawnAgent(version) {
  child = spawn(process.execPath, [AGENT_PATH], {
    cwd: DIR,
    env: { ...process.env, AGENT_VERSION: version || 'unknown' },
    stdio: 'ignore',
    windowsHide: true,
  });
  childSpawnedAt = Date.now();
  log('spawned agent pid=' + child.pid + ' version=' + String(version).slice(0, 12));
  child.on('exit', (code) => {
    log('agent exited code=' + code);
    if (probation && !killIntent) probation.crashCount++;
    killIntent = false;
    watchdogKillAt = 0;
    child = null;
    setTimeout(superviseChild, 2000);
  });
}
function superviseChild() {
  if (child) return;
  spawnAgent(currentAgentVersion());
}

// Never kill the agent MID-PRINT for a planned restart: the agent writes
// agent-busy.json while it is processing a job (claim -> print -> verify ->
// report). An update/rotation kill inside that window leaves a claimed job in
// limbo (reaper reprint risk). Wait for the flag to clear first. A flag older
// than 5 minutes is stale (crashed agent) and ignored; agents that predate the
// flag never create it, so this waits 0 ms for them. The liveness watchdog
// deliberately does NOT wait — a frozen agent's busy flag is part of the freeze.
const BUSY_PATH = path.join(DIR, 'agent-busy.json');
function agentBusy() {
  try {
    const st = fs.statSync(BUSY_PATH);
    return (Date.now() - st.mtimeMs) < 5 * 60 * 1000;
  } catch { return false; }
}
async function waitForAgentIdle(maxMs) {
  const t0 = Date.now();
  while (agentBusy() && Date.now() - t0 < maxMs) {
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (agentBusy()) log('agent still busy after ' + maxMs + 'ms — proceeding with restart anyway');
}

function killChildTree() {
  if (!child) return;
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); return; }
    catch (e) { log('taskkill failed, falling back to kill(): ' + e.message); }
  }
  try { child.kill(); } catch {}
}

// --- probation / rollback --------------------------------------------------
function agentHealthy(version) {
  try {
    const h = JSON.parse(fs.readFileSync(HEALTH_PATH, 'utf8'));
    return h.version === version && (Date.now() - new Date(h.healthyAt).getTime()) < 120000;
  } catch { return false; }
}
function checkProbation() {
  if (!probation) return;
  const verdict = lib.probationVerdict({
    healthySeen: agentHealthy(probation.version),
    crashCount: probation.crashCount,
    elapsedMs: Date.now() - probation.startedAt,
  });
  if (verdict === 'healthy') {
    log('agent ' + probation.version.slice(0, 12) + ' healthy — update confirmed');
    state.lastGood = probation.version; saveState();
    probation = null;
  } else if (verdict === 'rollback') {
    const bad = probation.version;
    log('agent ' + bad.slice(0, 12) + ' failed probation — rolling back');
    if (!state.rejected.includes(bad)) state.rejected.push(bad);
    saveState();
    try {
      fs.copyFileSync(PREV_PATH, AGENT_PATH);
    } catch (e) {
      // Keep probation set so the next tick retries the rollback — do not
      // clear the gate or restart the child onto the bad agent.js.
      log('rollback copy failed, will retry: ' + e.message);
      return;
    }
    probation = null;
    killIntent = true;
    killChildTree();
    reportStatus('rolled_back', bad);
  }
}

function readHeartbeatAgeMs() {
  try {
    const h = JSON.parse(fs.readFileSync(HEALTH_PATH, 'utf8'));
    return Date.now() - new Date(h.healthyAt).getTime();
  } catch { return Infinity; }
}

function checkLiveness() {
  if (!child || probation) return; // don't fight an in-progress update swap
  const verdict = lib.watchdogVerdict({
    heartbeatAgeMs: readHeartbeatAgeMs(),
    childUptimeMs: Date.now() - childSpawnedAt,
  });
  if (verdict !== 'restart') return;
  // A kill is already pending. Leave it alone if it's a non-watchdog kill
  // (watchdogKillAt === 0) or a recent watchdog kill still landing; only
  // re-issue once OUR kill is clearly stuck, so killIntent can't latch the
  // watchdog off forever when a kill never terminates the process.
  if (killIntent && (watchdogKillAt === 0 || Date.now() - watchdogKillAt < 60000)) return;
  log('agent heartbeat stale — force-restarting frozen agent (watchdog)');
  killIntent = true;
  watchdogKillAt = Date.now();
  killChildTree();            // child.on('exit') respawns it after 2s and resets watchdogKillAt
  reportStatus('watchdog_restart', null);
}

// --- update flow -----------------------------------------------------------
async function checkUpdate(manifest) {
  const localSha = currentAgentVersion();
  const manifestSha = manifest && manifest.agent && manifest.agent.sha256;
  if (!lib.shouldUpdate({ localSha, manifestSha, rejected: state.rejected })) return;
  log('update available: ' + manifestSha.slice(0, 12) + ' (local ' + String(localSha).slice(0, 12) + ')');
  const dl = await request('GET', ep.base + '/code?file=agent.js', { raw: true });
  if (dl.status !== 200) { log('download failed HTTP ' + dl.status); return; }
  const dlSha = crypto.createHash('sha256').update(dl.buf).digest('hex');
  if (dlSha !== manifestSha) { log('download sha mismatch — aborting'); return; }
  try { fs.writeFileSync(NEXT_PATH, dl.buf); }
  catch (e) { log('write next failed: ' + e.message); return; }
  try { execFileSync(process.execPath, ['--check', NEXT_PATH], { stdio: 'ignore' }); }
  catch { log('node --check failed — aborting update'); try { fs.unlinkSync(NEXT_PATH); } catch {} return; }
  await waitForAgentIdle(90000);   // don't swap+kill while a label is printing
  try {
    fs.copyFileSync(AGENT_PATH, PREV_PATH);
    fs.renameSync(NEXT_PATH, AGENT_PATH);
  } catch (e) {
    log('swap failed: ' + e.message);
    try { fs.unlinkSync(NEXT_PATH); } catch {}
    return;
  }
  log('swapped agent.js -> ' + manifestSha.slice(0, 12) + ', restarting child');
  probation = { version: manifestSha, startedAt: Date.now(), crashCount: 0 };
  killIntent = true;
  killChildTree();
}

// --- key rotation ----------------------------------------------------------
async function rotateIfDue(manifest) {
  if (!manifest || !manifest.rotate_due) return;
  log('rotation due — requesting new key');
  const r = await request('POST', ep.base + '/rotate-key', { body: {} });
  if (r.status !== 200 || !r.body || !r.body.new_key) { log('rotate failed HTTP ' + r.status); return; }
  try {
    const text = fs.readFileSync(ENV_PATH, 'utf8');
    fs.writeFileSync(ENV_PATH, lib.rewriteEnvKey(text, ep.envKey, r.body.new_key));
  } catch (e) { log('env rewrite failed: ' + e.message); return; }
  API_KEY = r.body.new_key;
  log('key rotated — restarting child to pick up new .env');
  await waitForAgentIdle(60000);   // don't restart while a label is printing
  killIntent = true;
  killChildTree();
}

// --- status report ---------------------------------------------------------
async function reportStatus(updateStatus, rejectedVersion) {
  try {
    await request('POST', ep.base + '/status', { body: {
      agent_version: currentAgentVersion(),
      supervisor_version: selfSha(),
      update_status: updateStatus || (probation ? 'updating' : 'ok'),
      rejected_version: rejectedVersion || null,
    } });
  } catch (e) { log('status report failed: ' + e.message); }
}

// --- main loop -------------------------------------------------------------
async function cycle() {
  try {
    const m = await request('GET', ep.base + '/manifest');
    if (m.status === 200 && m.body) {
      await rotateIfDue(m.body);  // rotate first, then update
      await checkUpdate(m.body);
    } else {
      log('manifest HTTP ' + m.status);
    }
  } catch (e) { log('cycle error: ' + e.message); }
  await reportStatus();
}

function main() {
  init();
  log('starting — role=' + ROLE + ' supervisor=' + selfSha().slice(0, 12));
  superviseChild();
  setInterval(checkProbation, 5000);
  setInterval(checkLiveness, 30000);
  setInterval(cycle, CHECK_INTERVAL_MS);
  cycle(); // run one cycle immediately so a fresh boot checks in without waiting
}

if (require.main === module) {
  try { main(); }
  catch (e) { console.error('[supervisor] fatal: ' + e.message); process.exit(1); }
}

module.exports = { _internals: { init, fileSha, selfSha } };
