/**
 * Live Zen — Claude acting in your OWN running Zen (your tabs, your containers), the way
 * Cowork / Claude in Chrome act in your real browser. Exposed by zen-mcp.mjs as live_*.
 *
 * Transport: Firefox's WebDriver BiDi remote control, which Zen only offers when started
 * with --remote-debugging-port (zen-live.mjs on). There is no Playwright here on purpose:
 * Playwright's BiDi context set-up applies to a whole container — it would deny downloads
 * and inject scripts into every one of your tabs in it, and its close path quits the
 * browser and deletes the container. This client touches only tabs it opened (or one of
 * your tabs it is told to use), never closes your tabs, never quits Zen.
 *
 * Pages are read with Playwright's own in-page snapshot script (lifted from the pinned
 * playwright-core, run in an isolated sandbox), so snapshots and element refs look the
 * same as the browser_* tools'. Clicks and keys are real input events (input.performActions).
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  NO_CONTAINER, cookieSitesByContainer, findZenProfile, loadConfig, readContainers, siteOf,
} from './profile.mjs';

const require = createRequire(import.meta.url);
const SANDBOX = 'claude-zen-live';
const IDLE_MS = 10 * 60_000;
const config = loadConfig();
const neverSites = (config.neverSites ?? []).map((s) => s.toLowerCase());
const neverContainers = new Set((config.neverContainers ?? []).map((n) => n.toLowerCase()));

const ZEN_LIVE = fileURLToPath(new URL('./zen-live.mjs', import.meta.url));

const OFF_MESSAGE = [
  "Live Zen is off — Zen isn't accepting remote control.",
  'Turning it on restarts Zen (tabs come back), and while it is on every site the user visits sees an automated browser,',
  `so it is their call: ask them to run \`! node "${ZEN_LIVE}" on\`, and \`… off\` when done.`,
  'For most work the headless browser_* tools already carry their Zen logins.',
].join(' ');

class LiveError extends Error {}

// ---------------------------------------------------------------- BiDi connection

class BiDi {
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const bidi = new BiDi(ws);
      ws.onopen = () => resolve(bidi);
      ws.onerror = () => reject(new LiveError(OFF_MESSAGE));
    });
  }

  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.closed = false;
    ws.onmessage = (m) => this.#onMessage(JSON.parse(String(m.data)));
    ws.onclose = () => {
      this.closed = true;
      for (const { reject } of this.pending.values()) reject(new LiveError('Lost the connection to Zen (was it quit or restarted?).'));
      this.pending.clear();
    };
  }

  #onMessage(msg) {
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { resolve, reject, timer } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      clearTimeout(timer);
      if (msg.type === 'error') reject(new LiveError(`${msg.error}: ${msg.message}`));
      else resolve(msg.result);
    } else if (msg.type === 'event') {
      for (const fn of this.listeners.get(msg.method) ?? []) fn(msg.params);
    }
  }

  send(method, params = {}, timeoutMs = 60_000) {
    if (this.closed) return Promise.reject(new LiveError('Lost the connection to Zen.'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new LiveError(`${method} timed out after ${Math.round(timeoutMs / 1000)}s (a dialog open in the tab?)`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }

  close() {
    try { this.ws.close(); } catch { /* already closed */ }
  }
}

// ---------------------------------------------------------------- session state

const live = {
  bidi: null,
  containers: null, // { byName: Map<lowercase name, {id, name}>, byId: Map<uuid, name> }
  mine: new Set(), // tabs Claude opened — the only ones it may close
  adopted: new Set(), // the user's tabs Claude was told to use
  current: null,
  prompts: new Map(),
  promptWaiters: new Set(),
  promptClosedAt: new Map(),
  idleTimer: null,
};

function touchIdle() {
  clearTimeout(live.idleTimer);
  live.idleTimer = setTimeout(() => { endSession().catch(() => {}); }, IDLE_MS);
  live.idleTimer.unref?.();
}

/** Ends the remote-control session (tabs stay open); frees Zen for another Claude session. */
export async function endSession() {
  clearTimeout(live.idleTimer);
  const b = live.bidi;
  live.bidi = null;
  live.containers = null;
  if (b && !b.closed) {
    await b.send('session.end', {}, 5000).catch(() => {});
    b.close();
  }
}

function endpoint() {
  const profileDir = findZenProfile();
  try {
    const info = JSON.parse(fs.readFileSync(path.join(profileDir, 'WebDriverBiDiServer.json'), 'utf8'));
    return { profileDir, url: `ws://${info.ws_host}:${info.ws_port}/session` };
  } catch {
    throw new LiveError(OFF_MESSAGE);
  }
}

async function session() {
  touchIdle();
  if (live.bidi && !live.bidi.closed) return live.bidi;
  const { profileDir, url } = endpoint();
  const bidi = await BiDi.connect(url);
  try {
    // "ignore": the user's own alerts and confirms behave exactly as without Claude.
    await bidi.send('session.new', { capabilities: { alwaysMatch: { unhandledPromptBehavior: { default: 'ignore' } } } });
  } catch (e) {
    bidi.close();
    throw new LiveError(/session/i.test(e.message)
      ? `Zen already has a remote-control session — most likely another Claude session is using live Zen. (${e.message})`
      : e.message);
  }
  await bidi.send('session.subscribe', {
    events: ['browsingContext.contextDestroyed', 'browsingContext.userPromptOpened', 'browsingContext.userPromptClosed'],
  });
  bidi.on('browsingContext.contextDestroyed', ({ context }) => {
    live.mine.delete(context);
    live.adopted.delete(context);
    live.prompts.delete(context);
    if (live.current === context) live.current = null;
  });
  bidi.on('browsingContext.userPromptOpened', (p) => {
    live.prompts.set(p.context, p);
    for (const fn of live.promptWaiters) fn(p);
  });
  bidi.on('browsingContext.userPromptClosed', ({ context }) => {
    live.prompts.delete(context);
    live.promptClosedAt.set(context, Date.now());
  });
  live.bidi = bidi;
  try {
    live.containers = await mapContainers(bidi, profileDir);
  } catch (e) {
    await endSession();
    throw e;
  }
  return bidi;
}

/**
 * Remote control names containers with random ids. Zen registers its containers in
 * containers.json order, so the order gives a candidate; each candidate is then proven
 * by its cookies (the sites it holds must match that container's best of all ids).
 * Anything that doesn't prove out is refused — acting as the wrong container is the
 * one mistake this must never make.
 */
async function mapContainers(bidi, profileDir) {
  const { userContexts } = await bidi.send('browser.getUserContexts');
  const ids = userContexts.map((u) => u.userContext).filter((id) => id !== 'default');
  const named = readContainers(profileDir);
  const byName = new Map([[NO_CONTAINER, { id: 'default', name: NO_CONTAINER }]]);
  const byId = new Map([['default', NO_CONTAINER]]);
  if (ids.length < named.length) return { byName, byId, error: `Zen reports ${ids.length} containers, its file lists ${named.length}` };

  const expected = cookieSitesByContainer(profileDir);
  const actual = new Map();
  for (const id of ids) {
    const { cookies } = await bidi.send('storage.getCookies', { partition: { type: 'storageKey', userContext: id } });
    actual.set(id, new Set(cookies.map((c) => siteOf(c.domain))));
  }
  const score = (a, b) => {
    if (!a?.size || !b?.size) return 0;
    let both = 0;
    for (const s of a) if (b.has(s)) both++;
    return both / (a.size + b.size - both);
  };
  const unproven = [];
  named.forEach((c, i) => {
    const id = ids[i];
    const want = expected.get(c.id);
    if (want?.size) {
      const best = ids.reduce((top, other) => (score(want, actual.get(other)) > score(want, actual.get(top)) ? other : top), id);
      if (best !== id || score(want, actual.get(id)) === 0) { unproven.push(c.name); return; }
    }
    byName.set(c.name.toLowerCase(), { id, name: c.name });
    byId.set(id, c.name);
  });
  return { byName, byId, error: unproven.length ? `could not prove which id is ${unproven.join(', ')}` : null };
}

function containerFor(wanted) {
  const key = String(wanted ?? config.defaultContainer).trim().toLowerCase();
  const name = (config.aliases ?? {})[key] ?? wanted ?? config.defaultContainer;
  if (neverContainers.has(String(name).toLowerCase())) throw new LiveError(`"${name}" is off-limits to Claude (config.json neverContainers).`);
  const hit = live.containers.byName.get(String(name).toLowerCase());
  if (!hit) {
    const why = live.containers.error ? ` (${live.containers.error})` : '';
    throw new LiveError(`Can't open a tab as "${name}" in live Zen${why}. Choices: ${[...live.containers.byName.values()].map((c) => c.name).join(', ')}`);
  }
  return hit;
}

function blockedSite(url) {
  let host;
  try { host = new URL(url).hostname; } catch { return null; }
  const site = siteOf(host);
  return neverSites.some((s) => site === s || site.endsWith(`.${s}`)) ? site : null;
}

function guardUrl(url) {
  const site = blockedSite(url);
  if (site) throw new LiveError(`${site} is off-limits to Claude (config.json neverSites).`);
}

// ---------------------------------------------------------------- page helpers

let injectedSource;
function injectedScript() {
  if (injectedSource) return injectedSource;
  const bundle = path.join(path.dirname(require.resolve('playwright-core/package.json')), 'lib/coreBundle.js');
  const text = fs.readFileSync(bundle, 'utf8');
  const at = text.indexOf('// packages/playwright-core/src/generated/injectedScriptSource.ts');
  const m = at < 0 ? null : /\n\s*source\d+ = ('(?:[^'\\]|\\.)*');/.exec(text.slice(at, at + 2_000_000));
  if (!m) throw new LiveError('zen-browser: could not find Playwright\'s injected snapshot script — re-check live.mjs after a Playwright upgrade');
  injectedSource = vm.runInNewContext(m[1]);
  return injectedSource;
}

const INJECTED_OPTIONS = {
  isUnderTest: false,
  sdkLanguage: 'javascript',
  frameSeq: 0,
  testIdAttributeName: 'data-testid',
  stableRafCount: 1,
  browserName: 'firefox',
  shouldPrependErrorPrefix: true,
  isUtilityWorld: true,
  customEngines: [],
};

function fromRemote(v) {
  if (!v || typeof v !== 'object') return v;
  switch (v.type) {
    case 'undefined': return undefined;
    case 'null': return null;
    case 'string': case 'boolean': return v.value;
    case 'number': return typeof v.value === 'string' ? Number(v.value) : v.value;
    case 'bigint': return `${v.value}n`;
    case 'array': case 'set': return (v.value ?? []).map(fromRemote);
    case 'object': case 'map': return Object.fromEntries((v.value ?? []).map(([k, val]) => [typeof k === 'string' ? k : JSON.stringify(fromRemote(k)), fromRemote(val)]));
    case 'date': return v.value;
    case 'node': return `<${v.value?.localName ?? 'node'}>`;
    default: return `[${v.type}]`;
  }
}

const str = (value) => ({ type: 'string', value: String(value) });

async function call(ctx, functionDeclaration, args = [], { sandbox = true, owned = false, timeoutMs = 30_000 } = {}) {
  const r = await live.bidi.send('script.callFunction', {
    functionDeclaration,
    arguments: args,
    target: sandbox ? { context: ctx, sandbox: SANDBOX } : { context: ctx },
    awaitPromise: true,
    resultOwnership: owned ? 'root' : 'none',
    serializationOptions: { maxDomDepth: 0, maxObjectDepth: 4 },
  }, timeoutMs);
  if (r.type === 'exception') throw new LiveError(r.exceptionDetails?.text ?? 'script error');
  return r.result;
}

async function ensureInjected(ctx) {
  const has = await call(ctx, '() => !!globalThis.__claudeInjected');
  if (has.value) return;
  const expr = `(() => { const module = {}; ${injectedScript()}\nglobalThis.__claudeInjected = new (module.exports.InjectedScript())(globalThis, ${JSON.stringify(INJECTED_OPTIONS)}); return true; })()`;
  const r = await live.bidi.send('script.evaluate', {
    expression: expr, target: { context: ctx, sandbox: SANDBOX }, awaitPromise: false, resultOwnership: 'none',
  });
  if (r.type === 'exception') throw new LiveError(`snapshot script failed: ${r.exceptionDetails?.text}`);
}

async function snapshotText(ctx) {
  await ensureInjected(ctx);
  const r = await call(ctx, '() => globalThis.__claudeInjected.ariaSnapshot(document.body ?? document.documentElement, { mode: "ai" })');
  return r.value;
}

/** The element behind a snapshot ref, scrolled to the middle of the view; returns its BiDi node id. */
async function element(ctx, ref) {
  await ensureInjected(ctx);
  const r = await call(ctx, `(ref) => {
    const inj = globalThis.__claudeInjected;
    const el = inj.querySelector(inj.parseSelector('aria-ref=' + ref), document, false);
    if (!el) throw new Error('No element ' + ref + ' on this page now — take a new live_snapshot');
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    return el;
  }`, [str(ref)], { owned: true });
  if (!r.sharedId) throw new LiveError(`Ref ${ref} is not an element.`);
  return { sharedId: r.sharedId };
}

async function pageInfo(ctx) {
  const { contexts } = await live.bidi.send('browsingContext.getTree', { root: ctx, maxDepth: 0 });
  const c = contexts[0];
  let title = '';
  if (!live.prompts.has(ctx)) {
    try { title = (await call(ctx, '() => document.title', [], { timeoutMs: 5000 })).value; } catch { /* busy page */ }
  }
  return { url: c?.url ?? '', title, container: live.containers?.byId.get(c?.userContext) ?? '?' };
}

function header(info, ctx) {
  const prompt = live.prompts.get(ctx);
  return [
    `Live Zen (your browser) · ${info.container === NO_CONTAINER ? 'no container' : info.container} tab ${ctx.slice(0, 8)} · ${info.url}`,
    `- Page Title: ${info.title}`,
    ...(prompt ? [`### Dialog open: ${prompt.type} "${prompt.message}" — live_handle_dialog to accept or dismiss it`] : []),
  ].join('\n');
}

async function afterAction(ctx, withSnapshot) {
  await new Promise((r) => setTimeout(r, 400));
  for (let i = 0; i < 20 && !live.prompts.has(ctx); i++) {
    try {
      const state = await call(ctx, '() => document.readyState', [], { timeoutMs: 3000 });
      if (state.value === 'complete') break;
    } catch { /* navigating */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const info = await pageInfo(ctx);
  const site = blockedSite(info.url);
  if (site) {
    live.current = null;
    return `${header(info, ctx)}\nThis tab is now on ${site}, which is off-limits to Claude — stopped using it.`;
  }
  if (!withSnapshot || live.prompts.has(ctx)) return header(info, ctx);
  return `${header(info, ctx)}\n### Snapshot\n\`\`\`yaml\n${await snapshotText(ctx)}\n\`\`\``;
}

function currentTab() {
  if (!live.current) throw new LiveError("No live tab yet — live_open a page, or live_use_tab one of the user's tabs (live_tabs lists them).");
  return live.current;
}

/**
 * Send input actions. An action that opens an alert/confirm doesn't complete until the
 * dialog is answered, so this returns as soon as one opens in the tab; the result then
 * reports the dialog and live_handle_dialog answers it.
 *
 * Firefox's anti-abuse rule (dom.successive_dialog_time_limit, 3s — kept, it's the user's
 * real browser) holds back a dialog that follows another within 3s, unseen by remote
 * control, and the click that opened it never finishes. So input waits out that window,
 * and gives up after 15s instead of hanging.
 */
async function perform(ctx, actions) {
  const sinceDialog = Date.now() - (live.promptClosedAt.get(ctx) ?? 0);
  if (sinceDialog < 3500) await new Promise((r) => setTimeout(r, 3500 - sinceDialog));
  let onPrompt;
  const opened = new Promise((resolve) => {
    onPrompt = (p) => { if (p.context === ctx) resolve('dialog'); };
    live.promptWaiters.add(onPrompt);
  });
  const sent = live.bidi.send('input.performActions', { context: ctx, actions });
  sent.catch(() => {});
  try {
    const stuck = new Promise((r) => setTimeout(() => r('stuck'), 15_000));
    const outcome = await Promise.race([sent.then(() => 'done'), opened, stuck]);
    if (outcome === 'done') await live.bidi.send('input.releaseActions', { context: ctx });
    if (outcome === 'stuck') {
      throw new LiveError("The page hasn't finished handling that input after 15s — a dialog remote control can't see may be open in the tab. Ask the user to look at it.");
    }
  } finally {
    live.promptWaiters.delete(onPrompt);
  }
}

async function performMouse(ctx, target, { button = 0, clicks = 1 } = {}) {
  const actions = [{ type: 'pointerMove', x: 0, y: 0, origin: { type: 'element', element: target } }];
  for (let i = 0; i < clicks; i++) actions.push({ type: 'pointerDown', button }, { type: 'pointerUp', button });
  await perform(ctx, [{ type: 'pointer', id: 'claude-mouse', parameters: { pointerType: 'mouse' }, actions }]);
}

const KEYS = {
  enter: '', tab: '', escape: '', esc: '', backspace: '', delete: '',
  arrowup: '', arrowdown: '', arrowleft: '', arrowright: '', home: '',
  end: '', pageup: '', pagedown: '', space: ' ', shift: '', control: '',
  ctrl: '', alt: '', meta: '', cmd: '',
};

async function sendKeys(ctx, actions) {
  await perform(ctx, [{ type: 'key', id: 'claude-keyboard', actions }]);
}

const typeActions = (text) => [...text].flatMap((ch) => [{ type: 'keyDown', value: ch }, { type: 'keyUp', value: ch }]);

function comboActions(combo) {
  const parts = String(combo).split('+').map((p) => KEYS[p.toLowerCase()] ?? p);
  const down = parts.map((value) => ({ type: 'keyDown', value }));
  const up = [...parts].reverse().map((value) => ({ type: 'keyUp', value }));
  return [...down, ...up];
}

// ---------------------------------------------------------------- tools

export const LIVE_TOOLS = [
  {
    name: 'live_tabs',
    description: "LIVE Zen (the user's own browser, only while they have turned remote control on): list their open tabs — id, container, address — marking the ones Claude opened or is using. Money sites show as hidden.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'live_open',
    description: `LIVE Zen: open a new background tab in the user's own Zen, inside a container (default ${config.defaultContainer}), go to the URL and make it Claude's current tab. Returns the page snapshot with element refs.`,
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        container: { type: 'string', description: 'Container name (e.g. "Work", "Personal"), an alias from config.json, or "none"' },
      },
      required: ['url'],
    },
  },
  {
    name: 'live_use_tab',
    description: "LIVE Zen: make one of the user's existing tabs (id from live_tabs) Claude's current tab — only when they asked Claude to work in that tab. Claude never closes their tabs.",
    inputSchema: { type: 'object', properties: { tab: { type: 'string', description: 'Tab id (or its first characters) from live_tabs' } }, required: ['tab'] },
  },
  {
    name: 'live_navigate',
    description: "LIVE Zen: load a URL in Claude's current tab.",
    inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  },
  {
    name: 'live_back',
    description: "LIVE Zen: go back one page in Claude's current tab.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'live_snapshot',
    description: "LIVE Zen: the current tab's accessibility snapshot with element refs (same format as browser_snapshot).",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'live_click',
    description: 'LIVE Zen: click an element by its snapshot ref (a real mouse click).',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Element ref from the latest live snapshot, e.g. e12' },
        element: { type: 'string', description: 'What the element is, in words' },
        button: { type: 'string', enum: ['left', 'right', 'middle'] },
        doubleClick: { type: 'boolean' },
      },
      required: ['ref'],
    },
  },
  {
    name: 'live_hover',
    description: 'LIVE Zen: move the mouse over an element by its snapshot ref.',
    inputSchema: { type: 'object', properties: { ref: { type: 'string' }, element: { type: 'string' } }, required: ['ref'] },
  },
  {
    name: 'live_type',
    description: 'LIVE Zen: click into a field by its snapshot ref and type text with real key presses. clear=true replaces what is there; submit=true presses Enter after.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string' },
        element: { type: 'string' },
        text: { type: 'string' },
        clear: { type: 'boolean' },
        submit: { type: 'boolean' },
      },
      required: ['ref', 'text'],
    },
  },
  {
    name: 'live_press_key',
    description: 'LIVE Zen: press a key or combination in the current tab, e.g. Enter, Escape, ArrowDown, Meta+a.',
    inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
  },
  {
    name: 'live_select_option',
    description: 'LIVE Zen: choose option(s) in a <select> by its snapshot ref, matching option value or visible text.',
    inputSchema: {
      type: 'object',
      properties: { ref: { type: 'string' }, element: { type: 'string' }, values: { type: 'array', items: { type: 'string' } } },
      required: ['ref', 'values'],
    },
  },
  {
    name: 'live_screenshot',
    description: 'LIVE Zen: screenshot of the current tab as it renders now.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'live_evaluate',
    description: "LIVE Zen: run a JavaScript function in the current tab's page and return its result, e.g. \"() => document.title\".",
    inputSchema: { type: 'object', properties: { function: { type: 'string' } }, required: ['function'] },
  },
  {
    name: 'live_wait_for',
    description: 'LIVE Zen: wait until text appears (text) or disappears (textGone) in the current tab, or for a number of seconds (time). Max 60s.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' }, textGone: { type: 'string' }, time: { type: 'number' } },
    },
  },
  {
    name: 'live_handle_dialog',
    description: 'LIVE Zen: accept or dismiss the alert/confirm/prompt open in the current tab.',
    inputSchema: {
      type: 'object',
      properties: { accept: { type: 'boolean' }, promptText: { type: 'string' } },
      required: ['accept'],
    },
  },
  {
    name: 'live_close_tab',
    description: "LIVE Zen: close Claude's current tab — only tabs Claude opened; the user's tabs are never closed. Do it when a task is done unless the user wants to look at the tab.",
    inputSchema: { type: 'object', properties: {} },
  },
];

const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });

const HANDLERS = {
  async live_tabs() {
    const { contexts } = await live.bidi.send('browsingContext.getTree', { maxDepth: 0 });
    const lines = contexts.map((c) => {
      const marks = [live.mine.has(c.context) && 'opened by Claude', live.adopted.has(c.context) && 'Claude using',
        live.current === c.context && 'current'].filter(Boolean);
      const where = live.containers.byId.get(c.userContext) ?? '?';
      const addr = blockedSite(c.url) ? `[${blockedSite(c.url)} — hidden]` : c.url.slice(0, 140);
      return `- ${c.context.slice(0, 8)} · ${where === NO_CONTAINER ? 'no container' : where} · ${addr}${marks.length ? ` (${marks.join(', ')})` : ''}`;
    });
    return text(`Live Zen (your browser) · ${contexts.length} tabs\n${lines.join('\n')}`);
  },

  async live_open({ url, container }) {
    guardUrl(url);
    const c = containerFor(container);
    const { context } = await live.bidi.send('browsingContext.create', { type: 'tab', userContext: c.id, background: true });
    live.mine.add(context);
    live.current = context;
    await live.bidi.send('browsingContext.navigate', { context, url, wait: 'complete' }, 90_000).catch(() => {});
    return text(await afterAction(context, true));
  },

  async live_use_tab({ tab }) {
    const { contexts } = await live.bidi.send('browsingContext.getTree', { maxDepth: 0 });
    const hits = contexts.filter((c) => c.context.startsWith(String(tab)));
    if (hits.length !== 1) throw new LiveError(hits.length ? `"${tab}" matches ${hits.length} tabs — give more characters.` : `No tab "${tab}" — live_tabs lists them.`);
    const c = hits[0];
    if (blockedSite(c.url)) throw new LiveError(`That tab is on ${blockedSite(c.url)}, which is off-limits to Claude.`);
    const where = live.containers.byId.get(c.userContext);
    if (where && neverContainers.has(where.toLowerCase())) throw new LiveError(`That tab is in "${where}", which is off-limits to Claude.`);
    if (!live.mine.has(c.context)) live.adopted.add(c.context);
    live.current = c.context;
    return text(await afterAction(c.context, true));
  },

  async live_navigate({ url }) {
    const ctx = currentTab();
    guardUrl(url);
    await live.bidi.send('browsingContext.navigate', { context: ctx, url, wait: 'complete' }, 90_000).catch(() => {});
    return text(await afterAction(ctx, true));
  },

  async live_back() {
    const ctx = currentTab();
    await live.bidi.send('browsingContext.traverseHistory', { context: ctx, delta: -1 });
    return text(await afterAction(ctx, true));
  },

  async live_snapshot() {
    const ctx = currentTab();
    return text(await afterAction(ctx, true));
  },

  async live_click({ ref, button = 'left', doubleClick = false }) {
    const ctx = currentTab();
    const target = await element(ctx, ref);
    await performMouse(ctx, target, { button: { left: 0, middle: 1, right: 2 }[button] ?? 0, clicks: doubleClick ? 2 : 1 });
    return text(await afterAction(ctx, false));
  },

  async live_hover({ ref }) {
    const ctx = currentTab();
    await performMouse(ctx, await element(ctx, ref), { clicks: 0 });
    return text(await afterAction(ctx, false));
  },

  async live_type({ ref, text: value, clear = false, submit = false }) {
    const ctx = currentTab();
    const target = await element(ctx, ref);
    await performMouse(ctx, target);
    const keys = [];
    if (clear) {
      await live.bidi.send('script.callFunction', {
        functionDeclaration: `(el) => {
          if (typeof el.select === 'function') el.select();
          else { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
        }`,
        arguments: [target],
        target: { context: ctx, sandbox: SANDBOX },
        awaitPromise: false,
        resultOwnership: 'none',
      });
      keys.push({ type: 'keyDown', value: KEYS.backspace }, { type: 'keyUp', value: KEYS.backspace });
    }
    keys.push(...typeActions(value));
    if (submit) keys.push({ type: 'keyDown', value: KEYS.enter }, { type: 'keyUp', value: KEYS.enter });
    await sendKeys(ctx, keys);
    return text(await afterAction(ctx, false));
  },

  async live_press_key({ key }) {
    const ctx = currentTab();
    await sendKeys(ctx, comboActions(key));
    return text(await afterAction(ctx, false));
  },

  async live_select_option({ ref, values }) {
    const ctx = currentTab();
    const target = await element(ctx, ref);
    const r = await live.bidi.send('script.callFunction', {
      functionDeclaration: `(el, wanted) => {
        if (el.localName !== 'select') throw new Error('Not a <select>');
        const want = JSON.parse(wanted);
        let n = 0;
        for (const o of el.options) {
          const hit = want.includes(o.value) || want.includes(o.label) || want.includes(o.text.trim());
          if (hit) n++;
          if (el.multiple) o.selected = hit; else if (hit) { el.value = o.value; break; }
        }
        if (!n) throw new Error('No option matches ' + wanted);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return n;
      }`,
      arguments: [target, str(JSON.stringify(values))],
      target: { context: ctx },
      awaitPromise: false,
      resultOwnership: 'none',
    });
    if (r.type === 'exception') throw new LiveError(r.exceptionDetails?.text ?? 'select failed');
    return text(await afterAction(ctx, false));
  },

  async live_screenshot() {
    const ctx = currentTab();
    const info = await pageInfo(ctx);
    if (blockedSite(info.url)) throw new LiveError(`This tab is on ${blockedSite(info.url)}, which is off-limits to Claude.`);
    const { data } = await live.bidi.send('browsingContext.captureScreenshot', { context: ctx });
    return { content: [{ type: 'text', text: header(info, ctx) }, { type: 'image', data, mimeType: 'image/png' }] };
  },

  async live_evaluate({ function: fn }) {
    const ctx = currentTab();
    const result = fromRemote(await call(ctx, fn, [], { sandbox: false }));
    const info = await pageInfo(ctx);
    return text(`${header(info, ctx)}\n### Result\n${JSON.stringify(result, null, 2) ?? 'undefined'}`);
  },

  async live_wait_for({ text: appear, textGone, time }) {
    const ctx = currentTab();
    const deadline = Date.now() + Math.min(60, time ?? 30) * 1000;
    if (appear || textGone) {
      for (;;) {
        const body = (await call(ctx, '() => document.body?.innerText ?? ""', [], { timeoutMs: 5000 }).catch(() => ({ value: '' }))).value;
        if ((appear && body.includes(appear)) || (textGone && !body.includes(textGone))) break;
        if (Date.now() > deadline) throw new LiveError(`Timed out waiting for ${appear ? `"${appear}" to appear` : `"${textGone}" to go`}.`);
        await new Promise((r) => setTimeout(r, 500));
      }
    } else {
      await new Promise((r) => setTimeout(r, Math.max(0, deadline - Date.now())));
    }
    return text(await afterAction(ctx, false));
  },

  async live_handle_dialog({ accept, promptText }) {
    const ctx = currentTab();
    if (!live.prompts.has(ctx)) throw new LiveError('No dialog is open in the current tab.');
    await live.bidi.send('browsingContext.handleUserPrompt', { context: ctx, accept, ...(promptText !== undefined ? { userText: promptText } : {}) });
    live.prompts.delete(ctx);
    return text(await afterAction(ctx, false));
  },

  async live_close_tab() {
    const ctx = currentTab();
    if (!live.mine.has(ctx)) throw new LiveError("That is one of the user's tabs — Claude never closes them.");
    await live.bidi.send('browsingContext.close', { context: ctx });
    live.mine.delete(ctx);
    live.current = null;
    return text(`Closed Claude's tab ${ctx.slice(0, 8)}. ${live.mine.size ? `${live.mine.size} other tab(s) Claude opened are still open.` : ''}`.trim());
  },
};

export async function callLiveTool(name, args = {}) {
  try {
    await session();
    return await HANDLERS[name](args);
  } catch (e) {
    return text(e instanceof LiveError ? e.message : `Live Zen error: ${e.message}`, true);
  }
}
