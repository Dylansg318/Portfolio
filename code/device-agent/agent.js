#!/usr/bin/env node
// Device Print Agent
// Runs on the Windows PC connected to a USB label printer (e.g. Zebra ZP 450).
// Polls the server's print queue, downloads the file, and prints it to a specific
// Windows printer by name (NOT the system default — which may be a non-label printer).
//
// SINGLE-FILE RULE: the supervisor's auto-update delivers exactly ONE file
// (`/agent/code?file=agent.js`). Every helper must live in THIS file. The
// June-2026 agentLib.js split broke auto-update on every host: the new agent.js
// crashed on require('./agentLib') (file never delivered), failed probation and
// rolled back — hosts silently pinned to the old version. Pure helpers are
// inlined below and exported for tests; never add a local require().
//
// Env (loaded from .env in the same dir, written by the installer):
//   APP_URL               e.g. https://app.example.com
//   PRINTER_ID            UUID of the printer row on the server
//   PRINTER_KEY           Raw per-printer token
//   WINDOWS_PRINTER_NAME  e.g. "Zebra ZP 450-200 dpi (Copy 1)"
//   SUMATRA_PATH          Path to SumatraPDF.exe
//   POLL_INTERVAL_MS      optional, default 2000
//   PRINT_TIMEOUT_MS      optional, default 90000
//
// Bidirectional verification (all optional — omitting them = legacy behavior).
// Requires zebra-bidi.exe on the host (installed separately; NOT part of the
// one-file auto-update). If the exe is missing, verification silently stays off.
//   BIDI_VERIFY           off | monitor | enforce   (default off)
//                           off:     no printer reads
//                           monitor: verify + audit + report, never changes outcomes
//                           enforce: verdicts drive job outcomes (see bidiVerifyJob)
//   BIDI_LINT             off | monitor | enforce   (default monitor)
//                           structural ZPL lint before printing; enforce fails the
//                           job BEFORE printing (nothing wasted, safe requeue)
//   BIDI_EXE              path to zebra-bidi.exe (default: alongside agent.js)
//   BIDI_MATCH            usbprint device-path substring (default "vid_0a5f" = Zebra)
//   BIDI_TIMEOUT_MS       per-query timeout (default 4000)
//   BIDI_SETTLE_FAST_MS   fast settle poll cadence, serve channel only (default 250)
//   PREFLIGHT_CACHE_MS    pre-flight reuse window during verified-ok streaks (default 10000)
//   BIDI_PREFETCH         on | off  (default on) — claim job N+1 while job N's feed settles
//
// Speed note (2026-07-03): verification talks to zebra-bidi.exe through a
// resident `serve` child (one .NET start per agent life, not six per job) and
// settles via receive-buffer drain-detection instead of blind 900ms stability
// polling. If the host's exe predates serve mode the agent permanently falls
// back to the original per-query spawn path — same behavior, original speed.
//
// Fail-open invariant: no bidi read failure may ever block or lose a print.
// If the read channel is down, jobs print exactly as legacy and are flagged
// 'verify_unavailable' in the audit trail.

'use strict';

const fs        = require('fs');
const os        = require('os');
const path      = require('path');
const https     = require('https');
const http      = require('http');
const { spawn, execFile } = require('child_process');

// --- .env loader (no external deps) ----------------------------------------
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
} catch {}

const APP_URL              = (process.env.APP_URL || '').replace(/\/+$/, '');
const PRINTER_ID           = process.env.PRINTER_ID;
const PRINTER_KEY          = process.env.PRINTER_KEY;
const WINDOWS_PRINTER_NAME = process.env.WINDOWS_PRINTER_NAME;
const SUMATRA_PATH         = process.env.SUMATRA_PATH || path.join(__dirname, 'SumatraPDF.exe');
const POLL_INTERVAL_MS     = Math.max(1000, parseInt(process.env.POLL_INTERVAL_MS) || 2000);
const PRINT_TIMEOUT_MS     = Math.max(15000, parseInt(process.env.PRINT_TIMEOUT_MS) || 90000);
const BREAKER_THRESHOLD    = 3; // consecutive print failures before the breaker pauses claiming
const LOG_PATH             = process.env.LOG_PATH || path.join(__dirname, 'agent.log');

const HEALTH_PATH = path.join(__dirname, 'agent-health.json');

// --- BIDI verification config ----------------------------------------------
const BIDI_VERIFY     = (process.env.BIDI_VERIFY || 'off').toLowerCase();
const BIDI_LINT       = (process.env.BIDI_LINT || 'monitor').toLowerCase();
const BIDI_EXE        = process.env.BIDI_EXE  || path.join(__dirname, 'zebra-bidi.exe');
const BIDI_MATCH      = process.env.BIDI_MATCH || 'vid_0a5f';
const BIDI_TIMEOUT_MS = Math.min(10000, Math.max(1000, parseInt(process.env.BIDI_TIMEOUT_MS) || 4000));
const BIDI_SETTLE_MS      = 900;     // odometer poll interval after print (fallback transport)
const BIDI_SETTLE_STABLE  = 2;       // consecutive equal reads = mechanism settled (fallback)
// Wall-clock floor the odometer must hold before "settled" is believed. The
// counter ticks in whole inches (~200ms/inch at 5 ips), so anything shorter
// than a couple of inch-ticks lets two same-inch samples end the wait mid-feed.
const BIDI_SETTLE_MIN_STABLE_MS = Math.max(0, parseInt(process.env.BIDI_SETTLE_MIN_STABLE_MS) || 700);
const BIDI_SETTLE_CAP_MS  = 25000;   // hard cap waiting for the feed to finish
const BIDI_SETTLE_FAST_MS = Math.min(2000, Math.max(100, parseInt(process.env.BIDI_SETTLE_FAST_MS) || 250)); // drain-detect cadence (serve channel only)
const PREFLIGHT_CACHE_MS  = Math.min(60000, Math.max(0, parseInt(process.env.PREFLIGHT_CACHE_MS) || 10000)); // pre-flight reuse window during healthy streaks
const BIDI_PREFETCH       = (process.env.BIDI_PREFETCH || 'on').toLowerCase();  // 'off' disables next-job claim overlap
const AUDIT_PATH    = path.join(__dirname, 'print-audit.jsonl');
const HALT_PATH     = path.join(__dirname, 'bidi-halt.json');
const LEDGER_PATH   = path.join(__dirname, 'outcome-ledger.json');
const INFLIGHT_PATH = path.join(__dirname, 'inflight.json');
const BUSY_PATH     = path.join(__dirname, 'agent-busy.json');
const DPI = 203;
const bidiEnabled = () => (BIDI_VERIFY === 'monitor' || BIDI_VERIFY === 'enforce') && fs.existsSync(BIDI_EXE);

// ===========================================================================
// Pure helpers (inlined per the single-file rule; exported for tests)
// ===========================================================================

// Run an async operation with a hard timeout. If `promiseFactory()` does not
// settle within `ms`, reject and invoke `onTimeout` (used to kill the spawned
// print process). A late settle after timeout is ignored (single-settle).
function withTimeout(promiseFactory, ms, onTimeout) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { if (onTimeout) onTimeout(); } catch {}
      reject(new Error(`operation timed out after ${ms}ms`));
    }, ms);
    Promise.resolve().then(promiseFactory).then(
      (v) => { if (settled) return; settled = true; clearTimeout(timer); resolve(v); },
      (e) => { if (settled) return; settled = true; clearTimeout(timer); reject(e); },
    );
  });
}

// Circuit breaker: after `threshold` consecutive print failures, pause claiming
// for `cooldownMs` so a sustained printer fault (paper-out / offline) does not
// burn the whole queue to 'failed'. Jobs not yet claimed stay 'queued'.
function breakerDecision({ consecutiveFailures, threshold = 3, cooldownMs = 60000 }) {
  if (consecutiveFailures >= threshold) return { pause: true, cooldownMs };
  return { pause: false, cooldownMs: 0 };
}

// Structural ZPL lint. "Fed but blank" labels are payloads that parse but
// render nothing; most blank causes are visible in the bytes. Deliberately
// conservative — flags only structural emptiness, never styling.
function lintZpl(zpl) {
  const s = String(zpl);
  const problems = [];
  const opens  = (s.match(/\^XA/g) || []).length;
  const closes = (s.match(/\^XZ/g) || []).length;
  if (opens === 0)      problems.push('no ^XA format start — printer will ignore entire payload');
  if (opens !== closes) problems.push(`unbalanced formats: ${opens} ^XA vs ${closes} ^XZ`);
  const blocks = s.split(/\^XA/).slice(1);
  blocks.forEach((b, i) => {
    const body = b.split(/\^XZ/)[0] || '';
    const hasFieldData = /\^FD(?!\^)[^^]/.test(body);          // ^FD with nonempty data
    const hasGraphic   = /\^G[BCDEF]|\^XG|\^IM/.test(body);    // box/circle/diag/ellipse/field/graphic
    if (!hasFieldData && !hasGraphic) problems.push(`block ${i + 1}: no printable content (no ^FD data, no graphics) — would feed a blank label`);
  });
  return problems;
}

// Odometer verdict, judged PER LABEL so a missing label in a multi-block job
// can't hide inside a whole-job tolerance. Measured on the ZP 450: actual feed
// per label = nominal length + 0.5-1.5" of gap/positioning.
//   ok       perLabel in [len-1, len+3]
//   no_feed  advanced == 0 (spooled, nothing physically fed)
//   runaway  more than one whole extra label beyond the upper bound (dump mode)
//   partial  anything else (fed, but short — some labels missing)
function computeVerdict({ advanced, totalLabels, labelLenIn }) {
  const perLabel = advanced / (totalLabels || 1);
  if (advanced === 0) return 'no_feed';
  if (perLabel >= labelLenIn - 1 && perLabel <= labelLenIn + 3) return 'ok';
  if (advanced > (labelLenIn + 3) * totalLabels + labelLenIn) return 'runaway';
  return 'partial';
}

// One step of the post-print settle loop. Pure: the caller supplies one
// observation per poll tick.
//   state: { phase: 'drain'|'confirm', last, stable, stableSince, hsMisses, done, after }
//   obs:   { hs: parsed ~HS object|null, od: odometer inches|null, at: ms clock }
//   opts:  { stableNeeded, neverMovedStable, minStableMs, before }
// Drain phase watches the printer's receive buffer empty (formatsInBuffer /
// labelsRemainingInBatch; -1 = firmware didn't report → treat as drained, the
// confirm phase still gates on the odometer). 4 straight ~HS misses fall
// through to confirm so a flaky status channel can't stall the loop — the
// caller's hard cap still bounds the whole wait. Confirm phase requires
// `stableNeeded` consecutive equal reads once the odometer has advanced, or
// `neverMovedStable` when it never left `before` (the legacy extra patience
// before declaring no_feed).
//
// `minStableMs` exists because a SAMPLE COUNT cannot tell "the feed stopped"
// from "two samples landed inside the same inch". The odometer reports whole
// inches and advances one every ~200ms at 5 ips, while fast mode polls every
// 250ms — so two consecutive equal reads happen ROUTINELY mid-feed, and the
// loop declared victory early. That is the measured 2026-07-03 signature: every
// 1-block job verified ok, every multi-block job read ~55% of expected
// (`advanced=7" expected=~12.9"`), producing 333 verify_partial + 85
// verify_no_feed against 359 ok — false alarms that got the whole layer turned
// off the same day. Holding the reading for a wall-clock floor is cadence-
// independent; the sample count stays as the lower bound so existing
// callers/tests keep their semantics when minStableMs is absent.
function settleStep(state, obs, opts) {
  const s = { ...state, done: false, after: null };
  if (s.phase === 'drain') {
    if (obs.hs) {
      s.hsMisses = 0;
      const formats = (typeof obs.hs.formatsInBuffer === 'number') ? obs.hs.formatsInBuffer : -1;
      const remaining = (typeof obs.hs.labelsRemainingInBatch === 'number') ? obs.hs.labelsRemainingInBatch : -1;
      if (formats <= 0 && remaining <= 0) s.phase = 'confirm';
    } else {
      s.hsMisses += 1;
      if (s.hsMisses >= 4) s.phase = 'confirm';
    }
    return s;
  }
  if (obs.od === null || obs.od === undefined) return s;   // transient miss — keep polling
  const at = (typeof obs.at === 'number') ? obs.at : null;
  if (obs.od === s.last) {
    s.stable += 1;
    if (s.stableSince === null || s.stableSince === undefined) s.stableSince = at;
  } else {
    s.stable = 0; s.last = obs.od; s.stableSince = at;
  }
  const needed = (s.last === opts.before) ? opts.neverMovedStable : opts.stableNeeded;
  // No clock supplied (or no floor configured) → pure sample-count, exactly as
  // before. With both, the reading must ALSO have held for minStableMs.
  // An UNMEASURABLE floor must not be an infinite one: with no clock on the
  // observation there is nothing to compare, so fall back to the sample count
  // rather than spin to the caller's 25s cap and degrade the verdict to
  // 'unavailable'. Only a readable clock can hold the wait open.
  const minMs = opts.minStableMs || 0;
  const measurable = at !== null && s.stableSince !== null && s.stableSince !== undefined;
  const held = minMs === 0 || !measurable || (at - s.stableSince) >= minMs;
  if (s.stable >= needed && held) { s.done = true; s.after = s.last; }
  return s;
}

// Pre-flight cache admission: only a fresh, unbusted, healthy (readable and
// unblocked) pre-flight may be reused.
function preflightCacheUsable(cache, { now, busted, cacheMs }) {
  return !!(cache && !busted && (now - cache.at) < cacheMs && cache.pre && cache.pre.available && !cache.pre.blocked);
}

// Depth-1 next-job prefetch is only safe from a clean state: any failure
// streak, runaway halt, or not-ready printer must go through the main loop's
// live checks between jobs instead.
function prefetchAllowed({ enabled, consecutiveFailures, halted, preflightBlocked }) {
  return !!enabled && consecutiveFailures === 0 && !halted && !preflightBlocked;
}

// Interpret one claim-ACK response (see ackJob). Pure so the branch matrix is
// testable:
//   acked   server confirmed we own the claim — safe to print
//   skip    the job is no longer ours (reaper redelivered it, or it was
//           deleted) — do NOT print; whoever holds it now prints it once
//   legacy  the server predates the /ack route (plain-text 404) — print
//           exactly like the pre-ack agent did
//   retry   transient (5xx / unexpected shape) — try again
function ackOutcome(status, body) {
  if (status >= 200 && status < 300) {
    return (body && body.status === 'claimed') ? 'acked' : 'skip';
  }
  if (status === 404) {
    // Route exists → JSON {error}. Route missing → Express text "Cannot POST…".
    return (body && typeof body === 'object' && body.error) ? 'skip' : 'legacy';
  }
  return 'retry';
}

// ===========================================================================

// Heartbeat the supervisor reads to confirm this agent version is healthy,
// not merely running. Written on every successful server poll AND during long
// in-job waits (odometer settle, breaker cooldown) so the liveness watchdog
// never tree-kills an agent that is alive but mid-verification.
function writeHealth() {
  try {
    fs.writeFileSync(HEALTH_PATH, JSON.stringify({
      version: process.env.AGENT_VERSION || 'unknown',
      pid: process.pid,
      healthyAt: new Date().toISOString(),
      role: 'print',
    }));
  } catch {}
}

// Open the log file ourselves rather than relying on a shell `>>` redirect.
// Two reasons: (1) Task Scheduler can't capture stdout from a wrapped node.exe,
// and (2) when the install kicks off a fresh agent while an orphan from a
// previous run still has the log open via cmd.exe's redirect, the second
// open() races on Windows file-sharing flags and the new task exits code 1
// before its first log line. Node opens with shared-mode flags by default,
// so concurrent appenders coexist cleanly.
let logFd = null;
try {
  // Rotate before opening — agent.log grows ~10 MB/month in production.
  try { const st = fs.statSync(LOG_PATH); if (st.size > 20 * 1024 * 1024) fs.renameSync(LOG_PATH, LOG_PATH + '.1'); } catch {}
  logFd = fs.openSync(LOG_PATH, 'a');
} catch (e) {
  console.error('[agent] could not open log file', LOG_PATH, e.message);
}
function writeLine(stream, parts) {
  const line = new Date().toISOString() + ' ' + parts.map(String).join(' ') + '\n';
  if (logFd !== null) { try { fs.writeSync(logFd, line); } catch {} }
  stream.write(line);
}
const log = (...a) => writeLine(process.stdout, a);
const err = (...a) => writeLine(process.stderr, a);

// --- Spool-event ring buffer ----------------------------------------------
// Per the print-history spec, the server needs visibility into what *this* agent
// saw locally, separate from the server-side print_jobs.status the agent
// reports via /done. The ring buffer holds the last 100 events; on every
// poll cycle we POST the buffer to /api/print-queue/agent/print-history and
// clear it. A push failure leaves events in the buffer to retry next poll;
// the server upsert is idempotent on (job_id, event), so retries are safe.
const SPOOL_RING_MAX = 100;
const spoolRing = [];

function recordSpoolEvent({ job_id, agent_event, bytes_received, exit_code, error }) {
  if (spoolRing.length >= SPOOL_RING_MAX) spoolRing.shift();
  spoolRing.push({
    job_id,
    agent_event,
    bytes_received: bytes_received ?? null,
    exit_code:      exit_code      ?? null,
    error:          error          ?? null,
    received_at:    new Date().toISOString(),
  });
}

async function flushSpoolEvents() {
  if (spoolRing.length === 0) return;
  const batch = spoolRing.slice();
  try {
    const r = await request('POST', `${APP_URL}/api/print-queue/agent/print-history`, {
      headers: { 'Content-Type': 'application/json' },
      body: { events: batch },
    });
    if (r.status >= 200 && r.status < 300) {
      // Clear only the events we sent; new ones since then stay queued.
      spoolRing.splice(0, batch.length);
    } else {
      err(`[agent] spool-history push HTTP ${r.status}`);
    }
  } catch (e) {
    err('[agent] spool-history push error:', e.message);
  }
}

// --- HTTP helper -----------------------------------------------------------
function request(method, url, { headers = {}, body = null, raw = false, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const opts = {
      method,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + (u.search || ''),
      headers: {
        'X-Printer-Id':  PRINTER_ID,
        'X-Printer-Key': PRINTER_KEY,
        ...headers,
      },
    };
    const req = lib.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (raw) return resolve({ status: res.statusCode, headers: res.headers, body: buf });
        const text = buf.toString('utf8');
        let parsed = null;
        if (text) { try { parsed = JSON.parse(text); } catch {} }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed ?? text });
      });
    });
    req.on('error', reject);
    // Without a timeout a half-open socket (deploy window, network blip) hangs
    // this single-threaded agent forever: it stops polling and prints nothing,
    // while the job it claimed sits in 'claimed' until printJobReaper requeues
    // it for a duplicate print.
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`request timeout after ${timeoutMs}ms`)));
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

// Report a job's terminal state (done|fail) and RETRY through transient
// failures. The /done and /fail routes are idempotent, so a retry after a lost
// response is safe. If we gave up and a printed job stayed 'claimed',
// printJobReaper would requeue it and the label would print a second time —
// which is why unconfirmed reports also go to the persistent outcome ledger.
// Returns: true = accepted, null = 404 job gone (stop retrying),
//          false = transient failure (caller may persist and retry later).
async function reportJobStatus(jobId, kind, errorMsg) {
  const url = `${APP_URL}/api/print-queue/${jobId}/${kind}`;
  const opts = kind === 'fail'
    ? { headers: { 'Content-Type': 'application/json' },
        body: { error: String(errorMsg || 'Unknown error').slice(0, 1000) } }
    : {};
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const r = await request('POST', url, opts);
      if (r.status >= 200 && r.status < 300) return true;       // accepted
      if (r.status === 404) {                                    // job gone — stop
        err(`[agent] ${kind} ${jobId}: HTTP 404 (job not found)`);
        return null;
      }
      err(`[agent] ${kind} ${jobId}: HTTP ${r.status} (attempt ${attempt}/5)`);
    } catch (e) {
      err(`[agent] ${kind} ${jobId}: ${e.message} (attempt ${attempt}/5)`);
    }
    writeHealth(); // long retry ladders must not look like a frozen agent
    if (attempt < 5) await sleep(2000 * attempt);                // 2s,4s,6s,8s
  }
  return false;
}

// Confirm receipt of a claimed job BEFORE printing (claim-ACK protocol).
// GET /next marks the job 'claimed' server-side before this agent has the
// response; if that response is lost (flaky station NIC — the 2026-07-03
// duplicate-labels incident), the server can't tell "never delivered" from
// "printed but silent" and its reaper used to blind-reprint 15 min later.
// The ACK closes the gap: the server fast-requeues unacked claims (nothing
// printed — safe) and never auto-reprints acked ones. The contract on our
// side: NO PRINT before a confirmed ack. If the ack can't be confirmed the
// job is abandoned untouched and the server redelivers it in ~4 minutes.
// Returns 'acked' | 'skip' | 'legacy' | 'unconfirmed' (see ackOutcome).
async function ackJob(jobId) {
  const url = `${APP_URL}/api/print-queue/${jobId}/ack`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await request('POST', url, { timeoutMs: 8000 });
      const o = ackOutcome(r.status, r.body);
      if (o !== 'retry') return o;
      err(`[agent] ack ${jobId}: HTTP ${r.status} (attempt ${attempt}/3)`);
    } catch (e) {
      err(`[agent] ack ${jobId}: ${e.message} (attempt ${attempt}/3)`);
    }
    writeHealth();
    if (attempt < 3) await sleep(1000 * attempt);
  }
  return 'unconfirmed';
}

// --- Print via SumatraPDF --------------------------------------------------
function printPdf(filePath, copies = 1) {
  let child = null; // captured so the timeout can kill the spawned SumatraPDF
  const run = () => new Promise((resolve, reject) => {
    if (!fs.existsSync(SUMATRA_PATH)) {
      return reject(new Error(`SumatraPDF not found at ${SUMATRA_PATH}`));
    }
    // noscale = actual size; let the driver clip to its physical print area.
    // The upstream label system exports labels as 8.5x11 with content in the upper-left 4x6;
    // shrink-to-fit (Sumatra's default) would scale the whole letter page down.
    const settings = ['noscale'];
    if (copies > 1) settings.push(`${copies}x`);
    const args = [
      '-print-to', WINDOWS_PRINTER_NAME,
      '-silent',
      '-print-settings', settings.join(','),
      filePath,
    ];

    child = spawn(SUMATRA_PATH, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`SumatraPDF exited ${code}: ${stderr.trim()}`));
    });
  });
  return withTimeout(run, PRINT_TIMEOUT_MS, () => {
    err(`[agent] pdf-print exceeded ${PRINT_TIMEOUT_MS}ms — killing spooler child`);
    try { if (child) child.kill('SIGKILL'); } catch {}
  });
}

// --- Raw ZPL to printer ----------------------------------------------------
// Sends raw bytes to a Windows printer via the Win32 spooler API
// (OpenPrinter -> StartDocPrinter[Datatype="RAW"] -> WritePrinter).
//
// We previously used `cmd.exe /c print /D:<printer> <file>`. That silently
// exits 0 on USB-only (non-shared) printers without putting anything on the
// wire — every job got marked "printed" with no label out. Going through the
// spooler API directly hits the same path the Zebra ZPL driver uses
// internally, so USB and shared printers both work and Win32 errors surface
// loudly instead of being swallowed.
function printZplRaw(zpl) {
  let child = null; // captured so the timeout can kill the spawned PowerShell
  const run = () => new Promise((resolve, reject) => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const dataPath = path.join(os.tmpdir(), `zpl-${stamp}.bin`);
    const psPath   = path.join(os.tmpdir(), `zpl-${stamp}.ps1`);

    try { fs.writeFileSync(dataPath, zpl); }
    catch (e) { return reject(e); }

    const psScript = `$ErrorActionPreference = 'Stop'
$printerName = $args[0]
$dataPath    = $args[1]

Add-Type -Language CSharp -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class RawSpooler {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
  public struct DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string DocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string OutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string DataType;
  }
  [DllImport("winspool.drv", CharSet = CharSet.Auto, SetLastError = true)]
  public static extern bool OpenPrinter(string p, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet = CharSet.Auto, SetLastError = true)]
  public static extern bool StartDocPrinter(IntPtr h, int level, [In] ref DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr h, byte[] b, int n, out int w);
}
"@

$bytes = [System.IO.File]::ReadAllBytes($dataPath)
$h = [IntPtr]::Zero
if (-not [RawSpooler]::OpenPrinter($printerName, [ref]$h, [IntPtr]::Zero)) {
  throw "OpenPrinter('$printerName') failed: Win32 error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
}
try {
  $di = New-Object RawSpooler+DOCINFO
  $di.DocName  = 'Device Agent Label'
  $di.DataType = 'RAW'
  if (-not [RawSpooler]::StartDocPrinter($h, 1, [ref]$di)) {
    throw "StartDocPrinter failed: Win32 error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }
  try {
    [void][RawSpooler]::StartPagePrinter($h)
    $written = 0
    if (-not [RawSpooler]::WritePrinter($h, $bytes, $bytes.Length, [ref]$written)) {
      throw "WritePrinter failed: Win32 error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }
    if ($written -ne $bytes.Length) {
      throw "WritePrinter short write: $written of $($bytes.Length)"
    }
    [void][RawSpooler]::EndPagePrinter($h)
  } finally {
    [void][RawSpooler]::EndDocPrinter($h)
  }
} finally {
  [void][RawSpooler]::ClosePrinter($h)
}
Write-Output "OK $written"
`;

    try { fs.writeFileSync(psPath, psScript); }
    catch (e) {
      try { fs.unlinkSync(dataPath); } catch {}
      return reject(e);
    }

    child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', psPath,
      WINDOWS_PRINTER_NAME, dataPath,
    ], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => {
      try { fs.unlinkSync(dataPath); } catch {}
      try { fs.unlinkSync(psPath); } catch {}
      reject(e);
    });
    child.on('close', (code) => {
      try { fs.unlinkSync(dataPath); } catch {}
      try { fs.unlinkSync(psPath); } catch {}
      if (code === 0 && /^OK \d+/m.test(stdout)) return resolve();
      const msg = (stderr.trim() || stdout.trim() || '(no output)').slice(0, 500);
      reject(new Error(`raw-print exited ${code}: ${msg}`));
    });
  });
  return withTimeout(run, PRINT_TIMEOUT_MS, () => {
    err(`[agent] raw-print exceeded ${PRINT_TIMEOUT_MS}ms — killing spooler child`);
    try { if (child) child.kill('SIGKILL'); } catch {}
  });
}

// ===========================================================================
// BIDI verification — talks to the printer over raw USB via zebra-bidi.exe
// (query-only allowlist: ~HS host status, ~HQES error status, odometer SGDs).
// Proves labels PHYSICALLY printed instead of trusting the Windows spooler.
// ===========================================================================

// --- serve channel -----------------------------------------------------------
// Persistent zebra-bidi.exe child in `serve` mode: one allowlisted command per
// stdin line, one single-line JSON reply per request, strictly in order. The
// first stdout line is the ready banner ({"ok":true,"serve":true}); an old exe
// prints an "unknown mode" error and exits instead — that sniff makes the
// channel report serve unsupported PERMANENTLY and callers fall back to
// per-query spawns (exactly today's behavior). A request timeout kills the
// child (its USB read thread may be blocked; per the zebra-bidi IO note,
// process teardown is the only safe reclaim) and the next query respawns it.
// query() never rejects — failures return { ok:false, error } (fail open).
function createBidiChannel({ cmd, args, timeoutMs, onLog }) {
  const logf = onLog || (() => {});
  const state = { child: null, ready: null, supported: null, pending: null, buf: '' };
  let chain = Promise.resolve();   // FIFO: one request in flight at a time

  function kill() {
    const c = state.child;
    state.child = null; state.ready = null; state.buf = '';
    if (c) { try { c.kill(); } catch {} }
    if (state.pending) {
      const p = state.pending; state.pending = null;
      p({ ok: false, error: 'serve channel died' });
    }
  }

  function spawnChild() {
    const child = spawn(cmd, args, { windowsHide: true });
    state.child = child;
    state.buf = '';
    state.ready = new Promise((resolve) => {
      let banner = false;
      const settle = (v) => { if (!banner) { banner = true; resolve(v); } };
      child.stdout.on('data', (d) => {
        state.buf += d.toString();
        let idx;
        while ((idx = state.buf.indexOf('\n')) >= 0) {
          const line = state.buf.slice(0, idx).trim();
          state.buf = state.buf.slice(idx + 1);
          if (!line) continue;
          let parsed = null;
          try { parsed = JSON.parse(line); } catch {}
          if (!banner) {
            settle(!!(parsed && parsed.ok && parsed.serve));
          } else if (state.pending) {
            const p = state.pending; state.pending = null;
            p(parsed || { ok: false, error: 'unparseable: ' + line.slice(0, 120) });
          }
        }
      });
      child.stderr.on('data', () => {});   // drain, never block the child
      child.on('error', (e) => { logf('serve channel spawn error: ' + e.message); settle(false); if (state.child === child) kill(); });
      child.on('close', () => { settle(false); if (state.child === child) kill(); });
    });
    return state.ready;
  }

  async function queryNow(cmdName) {
    if (state.supported === false) return { ok: false, error: 'serve unsupported' };
    if (!state.child) {
      const ok = await spawnChild();
      if (state.supported === null) {
        state.supported = ok;
        logf(ok ? 'zebra-bidi serve channel active'
                : 'zebra-bidi serve mode unavailable (old exe?) — falling back to per-query spawns');
      }
      if (!ok) { kill(); return { ok: false, error: state.supported === false ? 'serve unsupported' : 'serve respawn failed' }; }
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        logf(`serve query '${cmdName}' timed out after ${timeoutMs + 1000}ms — recycling child`);
        kill();   // resolves the pending request with an error
      }, timeoutMs + 1000);   // the exe enforces its own timeout; this is the backstop
      state.pending = (v) => { clearTimeout(timer); resolve(v); };
      try { state.child.stdin.write(cmdName + '\n'); }
      catch (e) { clearTimeout(timer); state.pending = null; kill(); resolve({ ok: false, error: 'serve stdin write failed: ' + e.message }); }
    });
  }

  return {
    serveSupported: () => state.supported,
    query(cmdName) {
      const run = () => queryNow(cmdName);
      const p = chain.then(run, run);
      chain = p.then(() => {}, () => {});
      return p;
    },
    dispose: kill,
  };
}

// Per-query spawn path (legacy / fallback when the host exe predates serve mode).
function bidiSpawnQuery(cmd) {
  return new Promise((resolve) => {
    execFile(BIDI_EXE, ['query', '--match', BIDI_MATCH, '--cmd', cmd, '--timeout', String(BIDI_TIMEOUT_MS)],
      { timeout: BIDI_TIMEOUT_MS + 3000, windowsHide: true }, (e, stdout) => {
        if (e && !stdout) return resolve({ ok: false, error: String(e.message || e).slice(0, 200) });
        try { resolve(JSON.parse(String(stdout).trim())); }
        catch { resolve({ ok: false, error: 'unparseable: ' + String(stdout).slice(0, 120) }); }
      });
  });
}

// Resident serve channel; lazily sniffs serve support on first use and falls
// back permanently to per-query spawns on an old exe (no behavior change).
const bidiChannel = createBidiChannel({
  cmd: BIDI_EXE,
  args: ['serve', '--match', BIDI_MATCH, '--timeout', String(BIDI_TIMEOUT_MS)],
  timeoutMs: BIDI_TIMEOUT_MS,
  onLog: (m) => log('[agent] ' + m),
});
const bidiFastMode = () => bidiChannel.serveSupported() === true;

async function bidiQueryOnce(cmd) {
  if (bidiChannel.serveSupported() !== false) {
    const r = await bidiChannel.query(cmd);
    if (bidiChannel.serveSupported() !== false) return r;
    // sniff resolved to "unsupported" during this very call — fall through
  }
  return bidiSpawnQuery(cmd);
}
async function bidiQuery(cmd) {
  let last = null;
  for (let a = 1; a <= 3; a++) {
    last = await bidiQueryOnce(cmd);
    if (last.ok) return last;
    await sleep(200 * a);
  }
  return last;
}

// --- audit log (JSONL, size-capped) ----------------------------------------
function auditWrite(entry) {
  try {
    try { const st = fs.statSync(AUDIT_PATH); if (st.size > 10 * 1024 * 1024) fs.renameSync(AUDIT_PATH, AUDIT_PATH + '.1'); } catch {}
    fs.appendFileSync(AUDIT_PATH, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
  } catch {}
}

// --- persistent outcome ledger ----------------------------------------------
// If a label PHYSICALLY printed but /done can't reach the server (network
// outage), the job would sit 'claimed' until the reaper requeues it — printing
// a DUPLICATE label. The ledger persists unconfirmed done/fail reports across
// network outages and agent restarts; every poll cycle retries them until the
// server acknowledges (2xx or 404 job-gone). The routes are idempotent, so
// double-reporting is harmless.
function ledgerLoad() {
  try { const v = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8')); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
function ledgerSave(entries) {
  try {
    if (entries.length === 0) { try { fs.unlinkSync(LEDGER_PATH); } catch {} return; }
    fs.writeFileSync(LEDGER_PATH, JSON.stringify(entries, null, 2));
  } catch {}
}
function ledgerAdd(job_id, kind, errorMsg) {
  const entries = ledgerLoad();
  if (!entries.some((e) => e.job_id === job_id && e.kind === kind)) {
    entries.push({ job_id, kind, error: errorMsg || null, ts: new Date().toISOString() });
    ledgerSave(entries);
  }
  auditWrite({ job_id, phase: 'ledger', note: `${kind} unconfirmed — persisted for retry` });
}
async function ledgerFlush() {
  const entries = ledgerLoad();
  if (entries.length === 0) return;
  const remaining = [];
  for (const e of entries) {
    // reportJobStatus retries 5x internally; returns true=accepted,
    // null=404 job gone (stop retrying), false=transient (keep for next cycle).
    const r = await reportJobStatus(e.job_id, e.kind, e.error);
    if (r === false) remaining.push(e);
    else auditWrite({ job_id: e.job_id, phase: 'ledger', note: `${e.kind} ${r === null ? 'dropped (job gone)' : 'confirmed'} after outage` });
  }
  ledgerSave(remaining);
}

// --- halt latch (runaway protection, enforce mode only) ---------------------
// When a runaway is detected the agent stops CLAIMING jobs until a human
// clears it (delete bidi-halt.json, or set BIDI_VERIFY to off/monitor and
// restart). Queued jobs stay safe on the server; nothing is lost while halted.
function bidiHalted() {
  try { return fs.existsSync(HALT_PATH) ? JSON.parse(fs.readFileSync(HALT_PATH, 'utf8')) : null; }
  catch { return { reason: 'unreadable halt file' }; }
}
function bidiHalt(reason, detail) {
  try { fs.writeFileSync(HALT_PATH, JSON.stringify({ reason, detail, at: new Date().toISOString() }, null, 2)); } catch {}
}

// --- pre-flight --------------------------------------------------------------
async function bidiPreflight() {
  const hsR = await bidiQuery('hs');
  const esR = await bidiQuery('es');
  const hs = hsR.ok ? hsR.hs : null;
  const es = esR.ok ? esR.es : null;
  let blocked = null;
  if (hs) {
    if (hs.diagMode)        blocked = 'printer is in DIAGNOSTIC/DUMP mode';
    else if (hs.paperOut)   blocked = 'media out';
    else if (hs.headUp)     blocked = 'printhead open';
    else if (hs.paused)     blocked = 'printer paused';
    else if (hs.corruptRam) blocked = 'printer reports corrupt RAM';
  }
  if (!blocked && es && es.errorFlag > 0) blocked = `printer error flags ${es.errorGroup2}/${es.errorGroup1}`;
  return { blocked, hs, es, available: !!hs };
}

// --- pre-flight cache ---------------------------------------------------------
// During a healthy streak the per-job ~HS/~HQES pair is redundant — reuse the
// last result for PREFLIGHT_CACHE_MS. ANY anomaly (non-ok verdict, lint
// problems, blocked/unreadable pre-flight) busts the cache so the next job
// probes live. The enforce-mode not-ready re-probe loop in loop() deliberately
// calls bidiPreflight() directly and never sees the cache.
let preflightCache = null;        // { pre, at }
let preflightCacheBusted = true;  // start busted: first job always probes live

async function bidiPreflightCached() {
  if (preflightCacheUsable(preflightCache, { now: Date.now(), busted: preflightCacheBusted, cacheMs: PREFLIGHT_CACHE_MS })) {
    return preflightCache.pre;
  }
  const pre = await bidiPreflight();
  preflightCache = { pre, at: Date.now() };
  preflightCacheBusted = !!(pre.blocked || !pre.available);
  return pre;
}
function bustPreflightCache() { preflightCacheBusted = true; }

// --- odometer ----------------------------------------------------------------
async function bidiOdometer() {
  const r = await bidiQuery('sgd:odometer.total_print_length');
  return (r.ok && r.odometerInches >= 0) ? r.odometerInches : null;
}
// After spooling, wait for the mechanism to finish feeding.
// Serve channel active: drain-detect — poll ~HS at BIDI_SETTLE_FAST_MS until
// the receive buffer empties (this overlaps the physical feed), then confirm
// with BIDI_SETTLE_STABLE consecutive equal odometer reads. Fallback (per-
// query spawns): odometer-stability only at the legacy 900ms cadence with the
// legacy extra never-moved patience — identical behavior to before this
// change. BIDI_SETTLE_CAP_MS bounds the whole wait in both modes.
async function bidiFeedSettled(before) {
  const fast = bidiFastMode();
  const interval = fast ? BIDI_SETTLE_FAST_MS : BIDI_SETTLE_MS;
  const opts = {
    stableNeeded: BIDI_SETTLE_STABLE,
    neverMovedStable: fast ? BIDI_SETTLE_STABLE : BIDI_SETTLE_STABLE + 2,
    minStableMs: BIDI_SETTLE_MIN_STABLE_MS,
    before,
  };
  let state = { phase: fast ? 'drain' : 'confirm', last: null, stable: 0, stableSince: null, hsMisses: 0, done: false, after: null };
  const t0 = Date.now();
  let lastOd = null;
  while (Date.now() - t0 < BIDI_SETTLE_CAP_MS) {
    await sleep(interval);
    writeHealth();                               // settling ≠ frozen (watchdog)
    const obs = { hs: null, od: null };
    if (state.phase === 'drain') {
      const r = await bidiQuery('hs');
      obs.hs = r.ok ? r.hs : null;
    } else {
      obs.od = await bidiOdometer();
      obs.at = Date.now();          // read AFTER the query — the floor must span real elapsed time
      if (obs.od !== null) lastOd = obs.od;
    }
    state = settleStep(state, obs, opts);
    if (state.done) return state.after;
  }
  return lastOd;   // cap hit — best-effort reading, same as legacy
}

// --- in-flight reconciliation ------------------------------------------------
// If the process dies MID-PRINT (crash, supervisor swap, power cut), the job's
// outcome is unknown and the server reaper would requeue it — a duplicate if it
// actually printed. So: persist {job, odometer-before} to inflight.json before
// printing; delete after the outcome is reported. On startup, if the file
// exists, read the odometer and settle the orphan.
function inflightWrite(data) { try { fs.writeFileSync(INFLIGHT_PATH, JSON.stringify(data)); } catch {} }
function inflightClear()     { try { fs.unlinkSync(INFLIGHT_PATH); } catch {} }
async function inflightReconcile() {
  let inf = null;
  try { inf = JSON.parse(fs.readFileSync(INFLIGHT_PATH, 'utf8')); } catch { return; }
  if (!inf || !inf.job_id) { inflightClear(); return; }
  log(`[agent] reconciling interrupted job ${inf.job_id} (agent died mid-print)`);
  const now = bidiEnabled() ? await bidiOdometer() : null;
  let outcome, msg;
  if (now === null || inf.before === null || inf.before === undefined) {
    outcome = null;
    msg = 'agent restarted mid-print; odometer unavailable — outcome unknown, needs human check before reprint';
  } else {
    const advanced = now - inf.before;
    const perLabel = advanced / (inf.totalLabels || 1);
    if (advanced === 0) {
      outcome = 'fail';
      msg = 'agent restarted mid-print; odometer shows nothing fed — safe to requeue';
    } else if (inf.labelLenIn && perLabel >= inf.labelLenIn - 1 && perLabel <= inf.labelLenIn + 3) {
      outcome = 'done';
      msg = `agent restarted mid-print; odometer confirms it printed (${advanced}")`;
    } else {
      outcome = null;
      msg = `agent restarted mid-print; odometer moved ${advanced}" (ambiguous — other feeds may have occurred) — needs human check`;
    }
  }
  auditWrite({ job_id: inf.job_id, phase: 'reconcile', outcome: outcome || 'attention', note: msg, inflight: inf });
  recordSpoolEvent({ job_id: inf.job_id, agent_event: outcome ? `reconciled_${outcome}` : 'reconcile_attention', error: msg });
  if (outcome) {
    if ((await reportJobStatus(inf.job_id, outcome, outcome === 'fail' ? msg : undefined)) === false) {
      ledgerAdd(inf.job_id, outcome, outcome === 'fail' ? msg : null);
    }
  }
  inflightClear();
}

// --- channel-lost tracking ---------------------------------------------------
// DUMP mode usually makes the printer STOP ANSWERING status queries (it prints
// received bytes instead of parsing them). So "reads worked recently, now every
// read times out" is itself a dump-mode signature. Track consecutive
// all-reads-failed jobs; at the threshold emit a loud spool event the server
// can alert on. We still fail open (print) — a broken read channel on a healthy
// printer must never stop shipping — but the alert makes the state visible
// within a couple of jobs instead of a stack of hex pages.
let bidiUnavailableStreak = 0;
function bidiChannelCheck(verdict, jobId) {
  if (verdict === 'unavailable') {
    bidiUnavailableStreak++;
    if (bidiUnavailableStreak === 2) {
      err('[agent] BIDI channel lost for 2+ consecutive jobs — possible DUMP mode or USB fault; check the printer');
      recordSpoolEvent({ job_id: jobId, agent_event: 'bidi_channel_lost',
                         error: 'status reads failing since last ' + bidiUnavailableStreak + ' jobs — possible dump mode / USB fault; physical check advised' });
    }
  } else {
    bidiUnavailableStreak = 0;
  }
}

// --- per-job verification wrapper -------------------------------------------
// Wraps printFn with pre-flight + odometer delta. Returns:
//   { verdict: 'ok'|'no_feed'|'partial'|'runaway'|'preflight_blocked'|'unavailable',
//     printed: bool, detail, advanced, expected }
// 'printed' tells the caller whether printFn ran (it does NOT run when enforce
// mode blocks on pre-flight; it always runs otherwise).
async function bidiVerifyJob(job, printFn) {
  const enforce = BIDI_VERIFY === 'enforce';
  const blocks = (String(job.payload_zpl).match(/\^XA/g) || []).length || 1;

  const pre = await bidiPreflightCached();
  const labelLenIn = (pre.hs && pre.hs.labelLengthDots > 0) ? pre.hs.labelLengthDots / DPI : 6.5;
  const totalLabels = blocks * (job.copies || 1);
  const expected = totalLabels * labelLenIn;

  if (pre.blocked && enforce) {
    auditWrite({ job_id: job.id, phase: 'preflight', verdict: 'blocked', reason: pre.blocked, hs: pre.hs, es: pre.es });
    return { verdict: 'preflight_blocked', printed: false, detail: pre.blocked, expected, advanced: null };
  }
  if (pre.blocked) {
    // monitor mode: record, but do not change behavior
    auditWrite({ job_id: job.id, phase: 'preflight', verdict: 'blocked_observed', reason: pre.blocked, hs: pre.hs, es: pre.es });
  }

  const before = pre.available ? await bidiOdometer() : null;
  // Persist in-flight state so a crash/kill mid-print can be reconciled on
  // restart instead of the reaper blindly reprinting (see inflightReconcile).
  inflightWrite({ job_id: job.id, before, totalLabels, labelLenIn, at: new Date().toISOString() });
  writeHealth();
  if (before === null) {
    await printFn();   // no read channel — print exactly like legacy (fail open)
    auditWrite({ job_id: job.id, phase: 'verify', verdict: 'unavailable', note: 'odometer unreadable before print' });
    return { verdict: 'unavailable', printed: true, detail: 'bidi unavailable; printed fail-open', expected, advanced: null };
  }

  await printFn();
  writeHealth();

  const after = await bidiFeedSettled(before);
  if (after === null) {
    auditWrite({ job_id: job.id, phase: 'verify', verdict: 'unavailable', before, note: 'odometer unreadable after print' });
    return { verdict: 'unavailable', printed: true, detail: 'printed; post-print odometer unreadable', expected, advanced: null };
  }

  const advanced = after - before;
  const perLabel = advanced / totalLabels;
  const verdict = computeVerdict({ advanced, totalLabels, labelLenIn });

  // Post-print ~HS: 'formatsInBuffer' distinguishes the two no_feed causes —
  //   buffer drained + no feed  -> payload never formed a printable format (bad ZPL)
  //   buffer holding + no feed  -> printer accepted the format but is blocked
  let detail = `advanced=${advanced}" (${(Math.round(perLabel * 10) / 10)}\"/label) expected=~${expected.toFixed(1)}" for ${totalLabels} label(s)`;
  let hsPost = null;
  if (verdict !== 'ok') {
    const hsR = await bidiQuery('hs');
    hsPost = hsR.ok ? hsR.hs : null;
    if (verdict === 'no_feed' && hsPost) {
      detail += hsPost.formatsInBuffer > 0
        ? `; printer holds ${hsPost.formatsInBuffer} unprinted format(s) — printer blocked`
        : '; receive buffer empty — payload likely never formed a printable format (bad/ignored ZPL)';
    }
  }

  auditWrite({ job_id: job.id, phase: 'verify', verdict, before, after, advanced, expected, blocks,
               copies: job.copies || 1, totalLabels, perLabel: Math.round(perLabel * 100) / 100,
               labelLenIn, hs_pre: pre.hs, es_pre: pre.es, hs_post: hsPost });
  return { verdict, printed: true, detail, expected, advanced };
}

// --- Job processor ---------------------------------------------------------
// agent-busy.json exists while a job is being processed. The supervisor checks
// it before killing the agent for an update/key-rotation restart, so a version
// swap can never land mid-print. Returns true when the job reached a good
// outcome (feeds the consecutive-failure breaker in loop()).
async function processJob(job) {
  try { fs.writeFileSync(BUSY_PATH, JSON.stringify({ job_id: job.id, at: new Date().toISOString() })); } catch {}
  try {
    return await processJobInner(job);
  } finally {
    inflightClear();
    try { fs.unlinkSync(BUSY_PATH); } catch {}
  }
}

async function processJobInner(job) {
  log(`[agent] claimed job ${job.id} (${job.original_name || 'inline-zpl'})`);
  const bytes_received = job.payload_zpl ? Buffer.byteLength(job.payload_zpl, 'utf8') : null;
  recordSpoolEvent({ job_id: job.id, agent_event: 'received', bytes_received });

  // Claim-ACK gate — never print a job the server doesn't know we hold.
  const ack = await ackJob(job.id);
  if (ack === 'skip') {
    // The claim is no longer ours (redelivered/deleted). Not a printer fault:
    // don't feed the breaker; the current holder prints it exactly once.
    log(`[agent] job ${job.id} claim superseded on server — skipping (no print)`);
    return true;
  }
  if (ack === 'unconfirmed') {
    // Network died between claim and ack. Abandon UNPRINTED — the server
    // fast-requeues unacked claims (~4 min), so nothing is lost and nothing
    // can duplicate. Printing here would recreate the blind-reprint hazard.
    err(`[agent] job ${job.id} ack unconfirmed — abandoning unprinted for server redelivery`);
    recordSpoolEvent({ job_id: job.id, agent_event: 'ack_abandoned', bytes_received,
                       error: 'claim ack unconfirmed; job intentionally not printed — server will redeliver' });
    return true;
  }
  // 'acked' → we own the claim; 'legacy' → pre-ack server, print as before.

  // Payload lint — catch structurally-blank/ignored ZPL before wasting a claim.
  if (job.payload_zpl && BIDI_LINT !== 'off') {
    const problems = lintZpl(job.payload_zpl);
    if (problems.length > 0) {
      bustPreflightCache();
      const msg = `payload lint: ${problems.join('; ')}`.slice(0, 900);
      auditWrite({ job_id: job.id, phase: 'lint', problems });
      recordSpoolEvent({ job_id: job.id, agent_event: 'lint_failed', bytes_received, error: msg });
      if (BIDI_LINT === 'enforce') {
        // Nothing printed, nothing wasted — server can fix the payload and requeue.
        err(`[agent] job ${job.id} REJECTED by lint: ${msg}`);
        if ((await reportJobStatus(job.id, 'fail', msg + ' (rejected before printing; fix payload and requeue)')) === false) {
          ledgerAdd(job.id, 'fail', msg);
        }
        return false;
      }
      err(`[agent] job ${job.id} lint warnings (printing anyway, mode=monitor): ${msg}`);
    }
  }

  // Phase 1 — print. A failure here means the label did NOT come out, so the
  // job is genuinely failed. A failure reporting /done afterwards is NOT a
  // print failure and must not flip the job to 'failed' (Phase 2).
  let tmpFile = null;
  let verify = null;   // bidi verdict (jobs with BIDI_VERIFY on)
  try {
    if (job.payload_zpl) {
      const doPrint = async () => {
        for (let i = 0; i < (job.copies || 1); i++) {
          await printZplRaw(job.payload_zpl);
        }
        prefetch.arm();   // spool done — overlap the settle wait with the next claim
      };
      if (bidiEnabled()) {
        verify = await bidiVerifyJob(job, doPrint);
        log(`[agent] job ${job.id} verify: ${verify.verdict} (${verify.detail})`);
        recordSpoolEvent({ job_id: job.id, agent_event: `verify_${verify.verdict}`, bytes_received,
                           error: verify.verdict === 'ok' ? null : verify.detail });
        bidiChannelCheck(verify.verdict, job.id);
        if (verify.verdict !== 'ok') bustPreflightCache();
      } else {
        // No verification available — still persist in-flight state so a
        // mid-print crash at least raises an attention event on restart.
        inflightWrite({ job_id: job.id, before: null, at: new Date().toISOString() });
        await doPrint();
      }
    } else if (job.file_drop_id && job.payload_download_url) {
      // pdf-driver mode: download the file then feed Sumatra.
      // Page count isn't known here, so full length-verification doesn't apply —
      // but the odometer still catches the worst case: driver accepted the job
      // and NOTHING fed (the blank-packing-slip incident).
      const dl = await request('GET', APP_URL + job.payload_download_url, { raw: true });
      if (dl.status !== 200) throw new Error(`Download failed: HTTP ${dl.status}`);

      const ext = path.extname(job.original_name || '') || '.pdf';
      tmpFile = path.join(os.tmpdir(), `print-${job.id}${ext}`);
      fs.writeFileSync(tmpFile, dl.body);

      if (bidiEnabled()) {
        const before = await bidiOdometer();
        inflightWrite({ job_id: job.id, before, at: new Date().toISOString() });
        await printPdf(tmpFile, job.copies || 1);
        prefetch.arm();   // spool done — overlap the settle wait with the next claim
        if (before !== null) {
          const after = await bidiFeedSettled(before);
          const advanced = (after !== null) ? after - before : null;
          const v = (advanced === null) ? 'unavailable' : (advanced === 0 ? 'no_feed' : 'ok');
          verify = { verdict: v, printed: true, advanced, expected: null,
                     detail: `pdf job: advanced=${advanced === null ? '?' : advanced}"` };
          auditWrite({ job_id: job.id, phase: 'verify', kind: 'pdf', verdict: v, before, after, advanced });
          recordSpoolEvent({ job_id: job.id, agent_event: `verify_${v}`, bytes_received,
                             error: v === 'ok' ? null : verify.detail });
          bidiChannelCheck(v, job.id);
          if (v !== 'ok') bustPreflightCache();
        } else {
          auditWrite({ job_id: job.id, phase: 'verify', kind: 'pdf', verdict: 'unavailable' });
        }
      } else {
        await printPdf(tmpFile, job.copies || 1);
        prefetch.arm();
      }
    } else {
      throw new Error('Job has no printable payload');
    }
  } catch (e) {
    err(`[agent] job ${job.id} PRINT failed:`, e.message);
    recordSpoolEvent({ job_id: job.id, agent_event: 'failed', error: e.message });
    await reportJobStatus(job.id, 'fail', e.message);
    return false;
  } finally {
    if (tmpFile) { try { fs.unlinkSync(tmpFile); } catch {} }
  }

  // Map verify verdict to job outcome (enforce mode only changes outcomes).
  if (verify && BIDI_VERIFY === 'enforce') {
    switch (verify.verdict) {
      case 'preflight_blocked':
        // Nothing printed and nothing wasted. Fail the job with the reason so
        // the server can requeue it; the poll loop pauses claims until the
        // printer is healthy again (see loop()).
        err(`[agent] job ${job.id} blocked pre-flight: ${verify.detail}`);
        preflightBlockedSince = Date.now();
        {
          const msg = `printer not ready: ${verify.detail} (job not printed; safe to requeue)`;
          if ((await reportJobStatus(job.id, 'fail', msg)) === false) ledgerAdd(job.id, 'fail', msg);
        }
        return false;
      case 'no_feed': {
        // Spooled but nothing physically fed — the exact silent-failure case.
        // Safe to requeue: no label came out, so a reprint cannot duplicate.
        err(`[agent] job ${job.id} VERIFIED NO-FEED — failing for requeue`);
        const msg = `verified no-feed: spooler accepted but printer fed 0 inches (${verify.detail}); safe to requeue`;
        if ((await reportJobStatus(job.id, 'fail', msg)) === false) ledgerAdd(job.id, 'fail', msg);
        return false;
      }
      case 'runaway':
        // Printer fed far more than expected (dump mode / runaway). Halt all
        // claiming until a human clears bidi-halt.json. Fail the job with an
        // explicit DO-NOT-AUTO-REPRINT marker: labels may have partially
        // printed, so a human must decide.
        err(`[agent] job ${job.id} RUNAWAY (${verify.detail}) — halting agent claims`);
        bidiHalt('runaway', `job ${job.id}: ${verify.detail}`);
        {
          const msg = `RUNAWAY: printer fed ${verify.advanced}" for ~${(verify.expected ?? 0).toFixed(0)}" expected — agent HALTED, needs human check (labels may exist; do not blind-reprint)`;
          if ((await reportJobStatus(job.id, 'fail', msg)) === false) ledgerAdd(job.id, 'fail', msg);
        }
        return false;
      case 'partial':
        // Some but not all labels fed. Do NOT auto-requeue (would duplicate the
        // labels that did print). Mark done but flag loudly for human review.
        err(`[agent] job ${job.id} PARTIAL feed (${verify.detail}) — flagged for review`);
        break; // falls through to /done, with the verify_partial event already recorded
      // 'ok' and 'unavailable' fall through to /done
    }
  }

  // Phase 2 — the label physically printed (or legacy/monitor mode). Confirm
  // /done, retrying transient failures. If this can't be confirmed the job
  // stays 'claimed' and the reaper is the (now rare) backstop.
  recordSpoolEvent({ job_id: job.id, agent_event: 'despooled', bytes_received, exit_code: 0 });
  const done = await reportJobStatus(job.id, 'done');
  if (done) {
    log(`[agent] printed ${job.id}` + (verify ? ` [verify:${verify.verdict}]` : ''));
  } else if (done === false) {
    // Network outage after a PHYSICAL print: persist the /done so it survives
    // the outage (and agent restarts) instead of letting the reaper reprint.
    err(`[agent] job ${job.id} printed but /done unconfirmed — persisted to outcome ledger`);
    ledgerAdd(job.id, 'done', null);
  }
  return true;
}

// --- Main loop -------------------------------------------------------------
let running = true;
let preflightBlockedSince = 0;   // enforce mode: pause claims while printer not ready
let consecutiveFailures = 0;     // hoisted from loop() so prefetchAllowed can see it
process.on('SIGTERM', () => { running = false; });
process.on('SIGINT',  () => { running = false; });

// --- next-job prefetch --------------------------------------------------------
// While the settle loop waits on the current job's physical feed, claim the
// next job so the /next round-trip is off the critical path. Depth 1; printing
// stays strictly serial. arm() is a no-op outside a clean healthy state — a
// failure streak, runaway halt, or not-ready printer must pass through loop()'s
// live checks between jobs. A prefetched job we die holding stays 'claimed'
// and the server reaper requeues it (nothing physical happened — safe). If the
// breaker pauses AFTER a prefetch, the claim is simply processed when the
// cooldown ends (60s claimed ≪ the reaper threshold — no duplicate risk).
const prefetch = {
  p: null,
  arm() {
    if (this.p) return;
    if (!prefetchAllowed({
      enabled: BIDI_PREFETCH !== 'off',
      consecutiveFailures,
      halted: BIDI_VERIFY === 'enforce' && !!bidiHalted(),
      preflightBlocked: !!preflightBlockedSince,
    })) return;
    this.p = request('GET', `${APP_URL}/api/print-queue/next`)
      .then((r) => (r.status === 200 && r.body && r.body.job ? r.body.job : null))
      .catch(() => null);
  },
  async take() {
    const p = this.p;
    this.p = null;
    return p ? await p : null;
  },
};

async function loop() {
  log(`[agent] starting — printer=${PRINTER_ID} (${WINDOWS_PRINTER_NAME}) interval=${POLL_INTERVAL_MS}ms bidi=${BIDI_VERIFY} lint=${BIDI_LINT} prefetch=${BIDI_PREFETCH}${bidiEnabled() ? '' : (BIDI_VERIFY !== 'off' ? ' (exe missing — inactive)' : '')}`);
  try { fs.unlinkSync(BUSY_PATH); } catch {}          // clear stale busy flag from a killed run
  await inflightReconcile();                          // settle any job interrupted mid-print
  let lastHaltReport = 0;
  while (running) {
    try {
      await flushSpoolEvents();
      await ledgerFlush();   // confirm any outcomes stranded by a network outage

      // Runaway halt latch (enforce mode): stop claiming, keep heartbeating.
      if (BIDI_VERIFY === 'enforce') {
        const halt = bidiHalted();
        if (halt) {
          if (Date.now() - lastHaltReport > 60000) {
            lastHaltReport = Date.now();
            err(`[agent] HALTED (${halt.reason}) — delete bidi-halt.json to resume`);
          }
          writeHealth();   // still healthy — halting is deliberate, not a crash
          await sleep(POLL_INTERVAL_MS * 5);
          continue;
        }
        // After a pre-flight block, wait for the printer to become ready
        // before claiming again (prevents draining the queue into failures
        // while someone reloads media / closes the head).
        if (preflightBlockedSince) {
          const pre = await bidiPreflight();
          if (pre.blocked) {
            if (Date.now() - lastHaltReport > 60000) {
              lastHaltReport = Date.now();
              err(`[agent] printer not ready (${pre.blocked}) — pausing claims`);
            }
            writeHealth();
            await sleep(15000);
            continue;
          }
          log('[agent] printer ready again — resuming claims');
          preflightBlockedSince = 0;
        }
      }

      let job = await prefetch.take();
      if (!job) {
        const r = await request('GET', `${APP_URL}/api/print-queue/next`);
        if (r.status === 200 || r.status === 204) writeHealth();
        if (r.status === 204) {
          await sleep(POLL_INTERVAL_MS);
          continue;
        }
        if (r.status !== 200) {
          err(`[agent] poll HTTP ${r.status}`);
          await sleep(POLL_INTERVAL_MS * 5);
          continue;
        }
        job = r.body.job;
      } else {
        writeHealth();   // a successful prefetched claim is proof of server contact
      }
      const ok = await processJob(job);
      consecutiveFailures = ok ? 0 : consecutiveFailures + 1;
      const brk = breakerDecision({ consecutiveFailures, threshold: BREAKER_THRESHOLD });
      if (brk.pause) {
        err(`[agent] ${consecutiveFailures} consecutive print failures — pausing ${brk.cooldownMs}ms (printer fault?)`);
        // Keep the heartbeat fresh across the cooldown: a paused agent is alive
        // and deliberately backing off, not frozen. Without this, a ~90s
        // timed-out print + this 60s pause exceeds the supervisor watchdog's
        // 120s stale window, so it would tree-kill/respawn us mid-pause and wipe
        // consecutiveFailures (re-burning jobs).
        writeHealth();
        await sleep(brk.cooldownMs);
        consecutiveFailures = BREAKER_THRESHOLD - 1; // re-probe with ONE job — a single failure re-trips the breaker; a success resets to 0
      }
      // Loop again immediately — there might be more queued
    } catch (e) {
      err('[agent] poll error:', e.message);
      await sleep(POLL_INTERVAL_MS * 5);
    }
  }
  log('[agent] shutting down');
  bidiChannel.dispose();   // release the serve child so the event loop can drain
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// --- entrypoint / maintenance CLI -------------------------------------------
// Maintenance flags are safe to run beside a live agent: no polling, no
// claiming; device access is serialized by zebra-bidi.exe's global mutex.
//   --selftest-bidi          read-only pre-flight + odometer, prints JSON
//   --lint-check <file.zpl>  offline lint of a payload file
//   --test-verify <file.zpl> PHYSICALLY prints via the real queue — VOID labels only
if (require.main === module) {
  if (!APP_URL || !PRINTER_ID || !PRINTER_KEY || !WINDOWS_PRINTER_NAME) {
    err('[agent] Missing required env: APP_URL / PRINTER_ID / PRINTER_KEY / WINDOWS_PRINTER_NAME');
    process.exit(1);
  }
  if (process.argv.includes('--selftest-bidi')) {
    (async () => {
      const pre = await bidiPreflight();
      const od  = await bidiOdometer();
      console.log(JSON.stringify({
        bidi_mode: BIDI_VERIFY, lint_mode: BIDI_LINT, exe: BIDI_EXE, exe_present: fs.existsSync(BIDI_EXE),
        preflight: pre, odometerInches: od,
      }, null, 2));
      process.exit(pre.available && od !== null ? 0 : 1);
    })();
  } else if (process.argv.includes('--lint-check')) {
    const file = process.argv[process.argv.indexOf('--lint-check') + 1];
    if (!file || !fs.existsSync(file)) { console.error('usage: --lint-check <zpl-file>'); process.exit(7); }
    const problems = lintZpl(fs.readFileSync(file, 'utf8'));
    console.log(JSON.stringify({ file, problems, pass: problems.length === 0 }, null, 2));
    process.exit(problems.length === 0 ? 0 : 1);
  } else if (process.argv.includes('--test-verify')) {
    (async () => {
      const file = process.argv[process.argv.indexOf('--test-verify') + 1];
      if (!file || !fs.existsSync(file)) { console.error('usage: --test-verify <zpl-file>'); process.exit(7); }
      const zpl = fs.readFileSync(file, 'utf8');
      const job = { id: 'test-verify-' + Date.now(), payload_zpl: zpl, copies: 1 };
      const res = await bidiVerifyJob(job, async () => { await printZplRaw(zpl); });
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.verdict === 'ok' ? 0 : 1);
    })();
  } else {
    loop();
  }
}

// Pure helpers exported for tests (never imported by production code — the
// single-file rule means agent.js has no local dependents).
module.exports = { withTimeout, breakerDecision, lintZpl, computeVerdict, settleStep, preflightCacheUsable, prefetchAllowed, ackOutcome, createBidiChannel };
