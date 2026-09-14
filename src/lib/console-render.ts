/**
 * The try-it console's rendering, shared by the server and the browser.
 *
 * Console.astro calls these at build time so a console is complete before
 * any script runs — the request in cURL, the real response, coloured — and
 * src/scripts/console.ts calls the same functions when a reader changes a
 * parameter, switches language or presses Send. One renderer, so the page at
 * rest and the page after a click cannot disagree.
 *
 * No imports: this file runs in the browser bundle as well as in Node.
 */

export type Lang = 'curl' | 'js' | 'py' | 'http';
export const LANGS: { id: Lang; label: string }[] = [
  { id: 'curl', label: 'cURL' },
  { id: 'js', label: 'JavaScript' },
  { id: 'py', label: 'Python' },
  { id: 'http', label: 'HTTP' },
];

export type Params = Record<string, string>;

export interface Request {
  method: 'GET' | 'POST';
  /** With `{param}` placeholders. */
  path: string;
  /** The variable name the JavaScript and Python snippets assign to. */
  varName: string;
}

export const escape = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Substitute `{id}`-style path parameters; the rest become the query — or,
 *  for a POST, the body, where an empty field is still a field. */
export function resolve(req: Request, params: Params) {
  let path = req.path;
  const query: Params = {};
  for (const [k, v] of Object.entries(params)) {
    if (path.includes(`{${k}}`)) path = path.replace(`{${k}}`, v);
    else if (req.method === 'POST' || (v !== '' && v != null)) query[k] = v ?? '';
  }
  return { path, query };
}

export const qs = (query: Params) => {
  const parts = Object.entries(query).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return parts.length > 0 ? `?${parts.join('&')}` : '';
};

/** The URL the request would hit, given an origin. */
export function urlFor(req: Request, params: Params, origin: string) {
  const { path, query } = resolve(req, params);
  return origin + path + (req.method === 'GET' ? qs(query) : '');
}

/** The request as the reader would type it, in one of four languages. */
export function snippet(req: Request, params: Params, origin: string, lang: Lang): string {
  const { path, query } = resolve(req, params);
  const host = origin.replace(/^https?:\/\//, '');
  const url = origin + path + (req.method === 'GET' ? qs(query) : '');
  const body = req.method === 'POST' ? query : {};

  if (lang === 'curl') {
    if (req.method === 'GET') return `curl "${url}"`;
    return `curl -X POST "${url}" \\\n  -H "content-type: application/json" \\\n  -d '${JSON.stringify(body)}'`;
  }
  if (lang === 'js') {
    if (req.method === 'GET') return `const res = await fetch("${url}");\nconst ${req.varName} = await res.json();`;
    return `await fetch("${url}", {\n  method: "POST",\n  headers: { "content-type": "application/json" },\n  body: JSON.stringify(${JSON.stringify(body, null, 2).replace(/\n/g, '\n  ')})\n});`;
  }
  if (lang === 'py') {
    if (req.method === 'GET') {
      const keys = Object.keys(query);
      const dict = keys.length > 0 ? `, params={${keys.map((k) => `${JSON.stringify(k)}: ${JSON.stringify(query[k])}`).join(', ')}}` : '';
      return `import requests\n\nr = requests.get("${origin}${path}"${dict})\n${req.varName} = r.json()`;
    }
    return `import requests\n\nr = requests.post("${url}", json=${JSON.stringify(body)})\nr.status_code`;
  }
  if (req.method === 'GET') return `GET ${path}${qs(query)} HTTP/1.1\nHost: ${host}\nAccept: application/json`;
  return `POST ${path} HTTP/1.1\nHost: ${host}\nContent-Type: application/json\n\n${JSON.stringify(body, null, 2)}`;
}

/** Colour a snippet: strings green (with soft break points after / ? & but
 *  never inside ://), a few keywords blue. */
export function colorSnippet(text: string): string {
  return escape(text)
    .replace(/(&quot;[^&]*?(?:&(?!quot;)[^&]*?)*&quot;|&#39;[^&]*?(?:&(?!#39;)[^&]*?)*&#39;)/g, (m) =>
      `<span class="s">${m.replace(/(:\/\/)|(\/|\?|&amp;)/g, (_x, scheme, brk) => (scheme ? scheme : `${brk}<wbr>`))}</span>`,
    )
    .replace(/^(curl|import|const|await|r =|GET|POST|Host:|Accept:|Content-Type:)/gm, '<span class="k">$1</span>')
    .replace(/\b(await|fetch|requests\.get|requests\.post|JSON\.stringify)\b/g, '<span class="k">$1</span>');
}

/** Colour a JSON value: keys blue, strings green, numbers and literals amber,
 *  punctuation dim. */
export function highlight(value: unknown): string {
  const json = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return escape(json)
    .replace(
      /(&quot;(?:[^&]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false|null)\b|-?\b\d+(?:\.\d+)?\b/g,
      (m, str: string | undefined, colon: string | undefined, kw: string | undefined) => {
        if (str) return colon ? `<span class="k">${str}</span><span class="p">${colon}</span>` : `<span class="s">${str}</span>`;
        if (kw) return `<span class="n">${kw}</span>`;
        return `<span class="n">${m}</span>`;
      },
    )
    .replace(/([{}[\],])/g, '<span class="p">$1</span>');
}

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  202: 'Accepted',
  400: 'Bad Request',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  422: 'Unprocessable Content',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};
export const statusLabel = (status: number, text?: string) =>
  `${status} ${text && text !== '' ? text : (STATUS_TEXT[status] ?? '')}`.trim();

/** Non-breaking space between number and unit: a status line wraps between
 *  segments, never inside one. */
export const formatBytes = (n: number) => (n < 1024 ? `${n}\u00a0B` : `${(n / 1024).toFixed(1)}\u00a0KB`);
