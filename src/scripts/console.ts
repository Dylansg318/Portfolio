import { LANGS, colorSnippet, formatBytes, highlight, snippet, statusLabel, urlFor, type Lang, type Params } from '../lib/console-render';

/**
 * The try-it console, live.
 *
 * Console.astro renders each console complete — the request, the real
 * response — so this script only has to make it move: rewrite the request as
 * parameters change or the language switches, fetch the live endpoint on
 * Send, stream the answer in, and open the page the answer names.
 *
 * Framework-free on purpose. It binds on `astro:page-load` (the first load
 * and every View Transitions navigation) and never twice to one console.
 */

interface Ep {
  key: string;
  method: 'GET' | 'POST';
  path: string;
  varName: string;
  source: string;
  /** The site's canonical origin — records carry absolute `page` URLs on it. */
  site: string;
}

const ARROW =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';

const LANG_KEY = 'api:lang';
const isLang = (v: string | null): v is Lang => LANGS.some((l) => l.id === v);
let lang: Lang = 'curl';
try {
  const stored = localStorage.getItem(LANG_KEY);
  if (isLang(stored)) lang = stored;
} catch {
  /* storage blocked — cURL it is */
}

const reduce = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Where a response points, if anywhere: `page` first, then a mailto. */
function pageOf(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.page === 'string') return b.page;
  if (typeof b.mailto === 'string') return b.mailto;
  return null;
}

/** On this site — whether the record says the canonical host or the one the
 *  page is being served from (a preview, a local build). */
const sameSite = (u: URL, site: string) => u.origin === location.origin || u.origin === site;

/** Same page as the one open now? Then Send changes state, not location. */
function isHere(target: string, site: string): boolean {
  try {
    const u = new URL(target, location.href);
    if (!sameSite(u, site)) return false;
    const here = location.pathname.replace(/\/$/, '') || '/';
    const there = u.pathname.replace(/\/$/, '') || '/';
    return here === there;
  } catch {
    return false;
  }
}

/** Where to go for a target: a same-site page stays on this host. */
function hrefFor(target: string, site: string): string {
  try {
    const u = new URL(target, location.href);
    return sameSite(u, site) ? `${u.pathname}${u.search}${u.hash}` : target;
  } catch {
    return target;
  }
}

function openLabel(target: string, site: string): string {
  if (target.startsWith('mailto:')) return 'Open in your mail app';
  try {
    const u = new URL(target, location.href);
    if (u.pathname.endsWith('.pdf')) return 'Open the PDF';
    if (!sameSite(u, site)) return `Open ${u.host}`;
    return `Open ${u.pathname}${u.search}`;
  } catch {
    return 'Open';
  }
}

function mount(el: HTMLElement) {
  if (el.dataset.live) return;
  el.dataset.live = '1';
  const ep = JSON.parse(el.dataset.ep ?? '{}') as Ep;
  const req = { method: ep.method, path: ep.path, varName: ep.varName };
  const reqEl = el.querySelector<HTMLElement>('.cx-req')!;
  const out = el.querySelector<HTMLElement>('.cx-out')!;
  const wrap = out.parentElement!;
  const status = el.querySelector<HTMLElement>('.cx-status')!;
  const sendBtn = el.querySelector<HTMLButtonElement>('.cx-send')!;
  type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  const inputs = [...el.querySelectorAll('[name]')] as Field[];

  const readParams = (): Params => {
    const p: Params = {};
    for (const i of inputs) {
      p[i.name] = i instanceof HTMLInputElement && i.type === 'checkbox' ? (i.checked ? 'true' : '') : i.value;
    }
    return p;
  };

  const refresh = () => {
    reqEl.innerHTML = colorSnippet(snippet(req, readParams(), location.origin, lang));
  };

  // A long response fades at the bottom until it is scrolled.
  const clipped = () => {
    const c = out.scrollHeight > out.clientHeight + 2 && out.scrollTop + out.clientHeight < out.scrollHeight - 2;
    wrap.classList.toggle('is-clipped', c);
  };
  out.addEventListener('scroll', clipped, { passive: true });
  clipped();

  const setStatus = (code: number, text: string, bytes: number, ms: number | null, body: unknown, count: number | null) => {
    const ok = code >= 200 && code < 300;
    const cls = ok ? 'ok' : 'bad';
    let html = `<span class="${cls}">${statusLabel(code, text)}</span> · ${formatBytes(bytes)}`;
    if (ms != null) html += ` · ${ms}\u00a0ms`;
    if (count != null) html += ` · ${count}\u00a0${count === 1 ? 'item' : 'items'}`;
    const target = pageOf(body);
    if (target && !isHere(target, ep.site)) {
      html += `<span class="cx-more"> · <a class="cx-open" href="${hrefFor(target, ep.site).replace(/"/g, '&quot;')}">${openLabel(target, ep.site)} ${ARROW}</a></span>`;
    }
    status.innerHTML = html;
  };

  // Copy buttons.
  el.querySelectorAll<HTMLButtonElement>('.cx-copy').forEach((b) => {
    b.addEventListener('click', async () => {
      const src = b.dataset.copy === 'req' ? reqEl : out;
      const was = b.textContent;
      const done = (okk: boolean) => {
        b.textContent = okk ? 'Copied' : 'Select to copy';
        setTimeout(() => (b.textContent = was), 1400);
      };
      try {
        await navigator.clipboard.writeText(src.textContent ?? '');
        done(true);
      } catch {
        done(false);
      }
    });
  });

  // ⌘/Ctrl+Enter sends from anywhere in the console.
  el.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      sendBtn.click();
    }
  });

  inputs.forEach((i) => {
    i.addEventListener('input', refresh);
    i.addEventListener('change', refresh);
  });

  // Language is one choice for the whole site, remembered.
  el.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.lang === lang));
    b.addEventListener('click', () => {
      const next = b.dataset.lang ?? 'curl';
      if (!isLang(next)) return;
      lang = next;
      try {
        localStorage.setItem(LANG_KEY, lang);
      } catch {
        /* fine */
      }
      document.querySelectorAll<HTMLButtonElement>('.cx [data-lang]').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.lang === lang)));
      document.querySelectorAll<HTMLElement>('.cx[data-live]').forEach((c) => c.dispatchEvent(new CustomEvent('console:refresh')));
    });
  });
  el.addEventListener('console:refresh', refresh);
  // Another script on the page (the work index's tabs) may set a parameter.
  el.addEventListener('console:set', (e) => {
    const d = (e as CustomEvent<Params>).detail ?? {};
    for (const i of inputs) if (i.name in d) i.value = d[i.name];
    refresh();
  });
  if (lang !== 'curl') refresh();

  let inflight: AbortController | null = null;

  sendBtn.addEventListener('click', async () => {
    const params = readParams();
    const url = urlFor(req, params, location.origin);
    inflight?.abort();
    inflight = new AbortController();
    el.classList.add('is-sending');
    status.textContent = 'sending…';

    const t0 = performance.now();
    let code = 0;
    let text = '';
    let raw = '';
    let body: unknown = null;
    try {
      const init: RequestInit = { signal: inflight.signal, headers: { accept: 'application/json' } };
      if (req.method === 'POST') {
        const query: Params = {};
        for (const [k, v] of Object.entries(params)) if (!req.path.includes(`{${k}}`)) query[k] = v;
        init.method = 'POST';
        init.headers = { ...init.headers, 'content-type': 'application/json' };
        init.body = JSON.stringify(query);
      }
      const res = await fetch(url, init);
      code = res.status;
      text = res.statusText;
      raw = await res.text();
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      code = 0;
      text = 'network error';
      body = { error: 'fetch_failed', detail: (err as Error).message, url };
      raw = JSON.stringify(body);
    }
    const ms = Math.max(1, Math.round(performance.now() - t0));
    const bytes = new TextEncoder().encode(raw).length;
    const count = Array.isArray(body)
      ? body.length
      : body && typeof body === 'object' && Array.isArray((body as { items?: unknown }).items)
        ? ((body as { items: unknown[] }).items.length)
        : null;

    // Stream the answer in a line at a time, then finish: the status line,
    // the fade, and — if the answer names a page — the page.
    const html = highlight(body);
    const lines = html.split('\n');
    out.innerHTML = '';
    const per = Math.max(6, Math.min(40, Math.floor(380 / lines.length)));
    const finish = () => {
      el.classList.remove('is-sending');
      out.scrollTop = 0;
      setStatus(code || 0, text, bytes, ms, body, count);
      clipped();
      document.dispatchEvent(new CustomEvent('console:sent', { detail: { key: ep.key, params, status: code, body } }));
      const target = pageOf(body);
      if (target && !isHere(target, ep.site)) {
        setTimeout(() => location.assign(hrefFor(target, ep.site)), reduce() ? 0 : 500);
      }
    };
    if (reduce()) {
      out.innerHTML = html;
      finish();
      return;
    }
    let i = 0;
    const step = () => {
      if (i >= lines.length) {
        finish();
        return;
      }
      out.innerHTML += (i ? '\n' : '') + lines[i++];
      out.scrollTop = out.scrollHeight;
      setTimeout(step, per);
    };
    setTimeout(step, 120);
  });
}

document.addEventListener('astro:page-load', () => {
  document.querySelectorAll<HTMLElement>('.cx[data-ep]').forEach(mount);
});
