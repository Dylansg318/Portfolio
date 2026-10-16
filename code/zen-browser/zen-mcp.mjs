#!/usr/bin/env node
/**
 * Zen browser MCP — the Playwright browser tools, driving a HEADLESS copy of Zen that
 * carries your Zen logins, one Zen container at a time.
 *
 * Why: when Zen is your everyday browser, some logins exist only there, and the Chrome
 * Playwright MCP can't see them. This server launches Zen itself (never a visible
 * window), on a throwaway profile whose cookies are copied from your live Zen profile
 * each time the browser opens (profile.mjs), so a login you do in Zen reaches Claude
 * after a browser_close. Nothing flows back into your Zen.
 *
 * Containers: two containers can hold different accounts on the same site (a Work and
 * a Personal Google account, say), so the browser acts as ONE container at a time —
 * config.json's defaultContainer until browser_container switches it — and every tool
 * result starts with a line naming the container it acted as.
 *
 * The live_* tools (live.mjs) are the other mode: acting in your own open Zen, only
 * while you have turned remote control on (zen-live.mjs).
 *
 * It starts in every Claude session, so Playwright loads on the first browser call, not
 * at startup (the tool list comes from a cache written by the first load): idle went
 * from ~160 MB to ~70 MB per session.
 *
 * Register (user scope, every session):
 *   claude mcp add --scope user zen -- node /path/to/zen-browser/zen-mcp.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire, registerHooks } from 'node:module';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ToolListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  CACHE_ROOT, NO_CONTAINER, RUNS_DIR, ZEN_BIN,
  buildRunProfile, findZenProfile, loadConfig, readContainers, resolveContainer,
} from './profile.mjs';
import { LIVE_TOOLS, callLiveTool, endSession } from './live.mjs';

// Playwright opens every new page as a new WINDOW; Firefox's remote agent opens windows
// only when the app is literally named "Firefox" ("openWindow() not supported in Zen"),
// while tabs pass because Zen keeps Firefox's app ID. Swap that one call to a tab, in
// memory, and refuse to start if a Playwright update moved it — which is why
// @playwright/mcp is pinned in package.json.
const WINDOW_CALL = 'type: BrowsingContext.CreateType.Window,';
registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url.endsWith('/playwright-core/lib/coreBundle.js')) {
      const src = String(result.source);
      const hits = src.split(WINDOW_CALL).length - 1;
      if (hits !== 1) {
        throw new Error(`zen-browser: Playwright's new-window call appears ${hits} times in coreBundle.js (expected 1) — re-check the tab patch after a Playwright upgrade`);
      }
      result.source = src.replace(WINDOW_CALL, 'type: BrowsingContext.CreateType.Tab,');
    }
    return result;
  },
});
const require = createRequire(import.meta.url);
const VERSION = require('./package.json').version ?? '1.0.0';
const MCP_VERSION = require('@playwright/mcp/package.json').version;
const TOOLS_CACHE = path.join(CACHE_ROOT, `tools-${MCP_VERSION}.json`);

const PREFS = {
  'zen.welcome-screen.seen': true,
  'browser.aboutwelcome.enabled': false,
  'browser.shell.checkDefaultBrowser': false,
  'browser.sessionstore.resume_from_crash': false,
  'signon.rememberSignons': false,
  'datareporting.policy.dataSubmissionEnabled': false,
  'toolkit.telemetry.reportingpolicy.firstRun': false,
  'messaging-system.rsexperimentloader.enabled': false,
  'app.shield.optoutstudies.enabled': false,
  'extensions.update.enabled': false,
};

const config = loadConfig();

const INSTRUCTIONS = [
  "Headless Zen (the user's everyday browser) carrying their Zen logins, for sites signed in only on Zen. It never opens a window.",
  `It acts as ONE Zen container at a time — ${config.defaultContainer} unless browser_container switches it (two containers can hold different accounts on the same site); every result names the container it acted as.`,
  "Logins are copied fresh from Zen each time the browser opens: if a site isn't signed in, ask the user to sign in on Zen in that container, then browser_close and retry.",
  'Money sites (banks, card issuers, payment processors, payroll: config.json neverSites) are never copied.',
  "The live_* tools instead act in the user's own open Zen — their real tabs, opening Claude's in the background — and work only while they have turned remote control on (zen-live.mjs on, which restarts Zen; never run it without their OK). Use them when they ask Claude to work in their browser or a tab they have open; close tabs you opened when done.",
].join(' ');

const CONTAINER_TOOL = {
  name: 'browser_container',
  description: "Which of your Zen containers the Zen browser acts as. With no container: shows the current one and the choices. With a container: switches — closes the open Zen browser (its tabs are lost); the next browser call reopens it with that container's logins, copied fresh from Zen.",
  inputSchema: {
    type: 'object',
    properties: {
      container: { type: 'string', description: 'Container name (e.g. "Work", "Personal") or an alias from config.json; "none" = logins outside any container' },
    },
  },
};

const state = { wanted: config.defaultContainer, open: null };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Zen main processes running on `dir` — each leads its own process group (Playwright launches detached). */
function zenProcessesFor(dir) {
  try {
    return execFileSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' })
      .split('\n')
      .filter((l) => l.includes(ZEN_BIN) && l.includes(dir))
      .map((l) => Number(l.trim().split(/\s+/)[0]))
      .filter(Boolean);
  } catch { return []; }
}

function removeRun(dir) {
  for (const pid of zenProcessesFor(dir)) {
    try { process.kill(-pid, 'SIGKILL'); } catch {
      try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Runs left by a server that died without cleaning up (its pid prefixes the folder name). */
function pruneStaleRuns() {
  let entries = [];
  try { entries = fs.readdirSync(RUNS_DIR); } catch { return; }
  for (const name of entries) {
    const pid = Number(name.split('-')[0]);
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch { /* dead */ }
    if (!alive) removeRun(path.join(RUNS_DIR, name));
  }
}

/** Snapshots and screenshots hold page text from signed-in sites; keep a week. */
function pruneOutput() {
  const dir = path.join(CACHE_ROOT, 'output');
  const cutoff = Date.now() - 7 * 86400_000;
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const n of names) {
    try { if (fs.statSync(path.join(dir, n)).mtimeMs < cutoff) fs.rmSync(path.join(dir, n), { force: true }); } catch { /* raced */ }
  }
}

/**
 * A server killed outright (SIGKILL, crash) can't close its browser, and Zen outlives it
 * (measured: 13 processes, ~2.6 GB, until something cleaned up). This shell loop — ~1 MB —
 * kills the browser's process group and deletes the copy within 2s of the server dying,
 * and exits on its own when the copy is removed by a normal close.
 */
function startWatchdog(zenPid, runDir) {
  const script = 'while kill -0 "$1" 2>/dev/null && [ -d "$3" ]; do sleep 2; done; '
    + 'if [ -d "$3" ]; then kill -9 -- "-$2" 2>/dev/null; rm -rf "$3"; fi';
  spawn('/bin/sh', ['-c', script, 'zen-watchdog', String(process.pid), String(zenPid), runDir], {
    detached: true, stdio: 'ignore',
  }).unref();
}

let firefox;
let innerClient;

/** Load Playwright and its MCP on first use; resolves to an MCP client for its tools. */
function inner() {
  innerClient ??= (async () => {
    ({ firefox } = require('playwright-core'));
    const { createConnection } = require('@playwright/mcp');
    const server = await createConnection(
      { browser: { browserName: 'firefox' }, outputDir: path.join(CACHE_ROOT, 'output'), filePaths: 'absolute' },
      openContext,
    );
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: 'zen-browser', version: VERSION });
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => outer.sendToolListChanged().catch(() => {}));
    await client.connect(clientSide);
    return client;
  })();
  return innerClient;
}

async function innerTools() {
  if (!innerClient) {
    try { return JSON.parse(fs.readFileSync(TOOLS_CACHE, 'utf8')); } catch { /* first run: load once */ }
  }
  const { tools } = await (await inner()).listTools();
  try {
    fs.mkdirSync(CACHE_ROOT, { recursive: true, mode: 0o700 });
    fs.writeFileSync(TOOLS_CACHE, JSON.stringify(tools));
  } catch { /* cache is an optimisation */ }
  return tools;
}

async function openContext() {
  pruneStaleRuns();
  const profileDir = findZenProfile();
  const container = resolveContainer(profileDir, state.wanted, config);
  fs.mkdirSync(RUNS_DIR, { recursive: true, mode: 0o700 });
  const runDir = fs.mkdtempSync(path.join(RUNS_DIR, `${process.pid}-`));
  try {
    const summary = buildRunProfile({ profileDir, container, runDir, config });
    const ctx = await firefox.launchPersistentContext(runDir, {
      channel: 'moz-firefox',
      executablePath: ZEN_BIN,
      headless: true,
      firefoxUserPrefs: PREFS,
    });
    const [zenPid] = zenProcessesFor(runDir);
    if (zenPid) startWatchdog(zenPid, runDir);
    state.open = { ctx, runDir, container, summary, at: new Date() };
    ctx.on('close', () => {
      if (state.open?.ctx === ctx) state.open = null;
      removeRun(runDir);
    });
    return ctx;
  } catch (e) {
    removeRun(runDir);
    throw e;
  }
}

/**
 * Close the Zen browser. Playwright's own browser_close only drops its tab list when it
 * was handed a context (its session then stays wedged), so this closes the context
 * itself: the backend sees the close and the next browser call reopens through
 * openContext with fresh logins. Graceful close gets 3s, then the Zen processes are
 * killed — a graceful Firefox shutdown can take ~30s waiting on background services.
 */
async function closeBrowser() {
  const o = state.open;
  if (!o) return false;
  const closed = new Promise((r) => o.ctx.once('close', r));
  o.ctx.close().catch(() => {});
  await Promise.race([closed, sleep(3000)]);
  removeRun(o.runDir);
  await Promise.race([closed, sleep(5000)]);
  if (state.open === o) state.open = null;
  return true;
}

/**
 * Leak guard. Nothing used to close the browser between calls, so a leak had the whole
 * session to grow: a copy opened for one lookup sat idle and held 61 GB within 80 minutes
 * — all in Zen's main process, its pages under 120 MB — with the Mac's swap 21 of
 * 22.5 GB full. Each minute the browser is open, close it after idleCloseMinutes without
 * a browser call, or at once when its processes together pass maxFootprintGB
 * (config.json; ZEN_* env overrides for tests). The next browser call reopens it as
 * usual and its result says why the last one closed; guard.log keeps a line.
 */
const IDLE_MS = Number(process.env.ZEN_IDLE_CLOSE_MINUTES ?? config.idleCloseMinutes ?? 10) * 60_000;
const MAX_FOOTPRINT_MB = Number(process.env.ZEN_MAX_FOOTPRINT_GB ?? config.maxFootprintGB ?? 4) * 1024;
const GUARD_EVERY_MS = Number(process.env.ZEN_GUARD_INTERVAL_MS ?? 60_000);
const GUARD_LOG = path.join(CACHE_ROOT, 'guard.log');
const activity = { inFlight: 0, lastUse: Date.now(), closing: null };

/**
 * MB held by the Zen processes on `runDir` (the main process and its children). top's MEM
 * is the physical footprint `footprint` reports; ps RSS read 4–10 GB of that 61 GB.
 */
function footprintMB(runDir) {
  const mains = new Set(zenProcessesFor(runDir));
  if (!mains.size) return 0;
  let out;
  try {
    out = execFileSync('/usr/bin/top', ['-l', '1', '-stats', 'pid,ppid,mem'], { encoding: 'utf8', timeout: 15_000 });
  } catch { return 0; }
  const unit = { B: 1 / 1048576, K: 1 / 1024, M: 1, G: 1024, T: 1048576 };
  let mb = 0;
  for (const line of out.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)([BKMGT])/);
    if (m && (mains.has(Number(m[1])) || mains.has(Number(m[2])))) mb += Number(m[3]) * unit[m[4]];
  }
  return Math.round(mb);
}

async function guard() {
  const o = state.open;
  if (!o || activity.closing) return;
  const mb = footprintMB(o.runDir);
  let why;
  if (mb > MAX_FOOTPRINT_MB) why = `it held ${(mb / 1024).toFixed(1)} GB (the cap is ${MAX_FOOTPRINT_MB / 1024} GB)`;
  else if (!activity.inFlight && Date.now() - activity.lastUse > IDLE_MS) why = `${IDLE_MS / 60_000} minutes passed without a browser call`;
  if (!why || state.open !== o) return;
  activity.closing = closeBrowser();
  try { await activity.closing; } finally { activity.closing = null; }
  state.closed = { why, at: new Date() };
  try {
    fs.appendFileSync(GUARD_LOG, `${new Date().toISOString()} server=${process.pid} container=${o.container.name} opened=${o.at.toISOString()} footprintMB=${mb} inFlight=${activity.inFlight} closed: ${why}\n`);
  } catch { /* the log is evidence, not control */ }
}
setInterval(() => { guard().catch(() => {}); }, GUARD_EVERY_MS).unref();

const label =(name) => (name === NO_CONTAINER ? 'no container' : name);
const clock = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });

function stamp() {
  const o = state.open;
  const c = state.closed;
  state.closed = null;
  const note = c ? `\nThe previous Zen browser was closed at ${clock(c.at)} because ${c.why}; its tabs are gone.` : '';
  if (!o) return `Zen (headless) · not open · the next browser call acts as ${label(state.wanted)}, with logins copied fresh from your Zen${note}`;
  return `Zen (headless) · acting as ${label(o.container.name)} · logins copied from your Zen at ${clock(o.at)} (${o.summary.cookies} cookies)${note}`;
}

async function containerTool({ container } = {}) {
  const profileDir = findZenProfile();
  if (!container) {
    const never = new Set((config.neverContainers ?? []).map((n) => n.toLowerCase()));
    const choices = readContainers(profileDir).filter((c) => !never.has(c.name.toLowerCase())).map((c) => c.name);
    return text(`${stamp()}\nChoices: ${[...choices, NO_CONTAINER].join(', ')}`);
  }
  let c;
  try { c = resolveContainer(profileDir, container, config); } catch (e) { return text(e.message, true); }
  const open = state.open;
  state.wanted = c.name;
  if (open && open.container.name !== c.name) {
    await closeBrowser();
    return text(`Closed the Zen browser that was acting as ${label(open.container.name)}. The next browser call opens it as ${label(c.name)}, with logins copied fresh from your Zen.`);
  }
  if (open) return text(`Already acting as ${label(c.name)}.`);
  return text(`The next browser call opens Zen as ${label(c.name)}, with logins copied fresh from your Zen.`);
}

const outer = new Server(
  { name: 'zen', version: VERSION },
  { capabilities: { tools: { listChanged: true } }, instructions: INSTRUCTIONS },
);
outer.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [...(await innerTools()), CONTAINER_TOOL, ...LIVE_TOOLS],
}));
outer.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const { name, arguments: args = {} } = request.params;
  if (name === CONTAINER_TOOL.name) return containerTool(args);
  if (name.startsWith('live_')) return callLiveTool(name, args);
  if (name === 'browser_close') {
    const was = state.open;
    await closeBrowser();
    return text(was
      ? `Closed the Zen browser (was acting as ${label(was.container.name)}). The next browser call reopens it as ${label(state.wanted)}, with logins copied fresh from your Zen.`
      : stamp());
  }
  await activity.closing; // a guard close finishes before this call reopens the browser
  activity.inFlight++;
  activity.lastUse = Date.now();
  let result;
  try {
    result = await (await inner()).callTool({ name, arguments: args }, undefined, {
      signal: extra.signal,
      timeout: 15 * 60_000,
      resetTimeoutOnProgress: true,
    });
  } finally {
    activity.inFlight--;
    activity.lastUse = Date.now();
  }
  return { ...result, content: [{ type: 'text', text: stamp() }, ...(result.content ?? [])] };
});

async function shutdown() {
  await Promise.all([closeBrowser().catch(() => {}), endSession().catch(() => {})]);
  process.exit(0);
}
process.stdin.on('end', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

pruneStaleRuns();
pruneOutput();
await outer.connect(new StdioServerTransport());
