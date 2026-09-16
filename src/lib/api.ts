import { site } from './site';
import { nameplate } from './loops';
import { CATEGORIES, type Category } from './categories';
import { getAllProjects, getProjects, getChildren, type Project } from './content';
import { ENDPOINTS } from './endpoints';

/**
 * The records behind `/api/*` — and behind every "Response" pane on the site.
 *
 * One set of functions builds the JSON. The Worker routes in src/pages/api/
 * call them at request time; the pages call them at build time to render the
 * response a console shows before anyone presses Send. That is what makes the
 * console honest: the body on the page IS the body the endpoint returns,
 * because both came from here, from the same `site.ts` and content entries
 * the prose beside it was written from.
 *
 * Only facts already on the site. Nothing here reads a private source.
 */

const ORIGIN = String(import.meta.env.SITE ?? 'https://portfolio.dylansg0318.workers.dev').replace(/\/$/, '');
/** An absolute URL on this site, so a record pasted elsewhere still points home. */
export const abs = (path: string) => `${ORIGIN}${path}`;

export type View = 'plain' | 'engineer';

/** A request the API refuses, with the body it answers with. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public body: Record<string, unknown>,
  ) {
    super(`${status}`);
  }
}

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  400: 'Bad Request',
  404: 'Not Found',
  405: 'Method Not Allowed',
  422: 'Unprocessable Content',
  503: 'Service Unavailable',
};
export const statusText = (status: number) => STATUS_TEXT[status] ?? '';

type Rec = Record<string, unknown>;

/**
 * `?fields=a,b` — a sparse fieldset. Unknown names are an error rather than a
 * silent empty object, and `page` always comes back so a client can still
 * find the page the record describes.
 */
export function pick<T extends Rec>(record: T, fields?: string[]): Rec {
  if (!fields || fields.length === 0) return record;
  const unknown = fields.filter((f) => !(f in record));
  if (unknown.length > 0) {
    throw new ApiError(400, {
      error: 'unknown_field',
      detail: `No such field: ${unknown.join(', ')}.`,
      fields: Object.keys(record),
    });
  }
  const out: Rec = {};
  for (const f of fields) out[f] = record[f];
  if ('page' in record && !('page' in out)) out.page = record.page;
  return out;
}

export const parseFields = (raw: string | null | undefined): string[] | undefined => {
  const list = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : undefined;
};

// ---------------------------------------------------------------- /api/dylan

export function personRecord(view: View = 'plain', fields?: string[]) {
  if (view !== 'plain' && view !== 'engineer') {
    throw new ApiError(400, { error: 'bad_request', detail: 'view must be plain or engineer.' });
  }
  const summary = nameplate[view === 'engineer' ? 'eng' : 'plain'].map((s) => s.t).join('');
  return pick(
    {
      name: site.name,
      role: site.role,
      employer: { name: site.employer.name, site: site.employer.site },
      summary,
      view,
      mostly: site.mainly.focus,
      stack: site.mainly.stack,
      location: site.location,
      timezone: site.timezone,
      open_to: site.availability,
      looking_for: site.lookingFor,
      principles: site.principles.map((p) => ({ title: p.title, body: p.body })),
      links: {
        email: site.email,
        github: site.links.github,
        linkedin: site.links.linkedin,
        code: site.links.code,
        resume: abs(site.resumeUrl),
        resume_pdf: abs(site.resumePdf),
      },
      measured: site.statsAsOf,
      page: abs('/'),
    },
    fields,
  );
}

// ----------------------------------------------------------------- /api/work

const year = (p: Project) => p.data.date.getFullYear();

const metricsOf = (p: Project): Rec | undefined => {
  if (p.data.metrics.length === 0) return undefined;
  const m: Rec = {};
  for (const x of p.data.metrics) {
    m[x.label.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').toLowerCase()] = x.value;
  }
  return m;
};

const linksOf = (p: Project): Rec => {
  const l: Rec = {};
  if (p.data.links.source) l.source = p.data.links.source;
  if (p.data.links.live) l.live = p.data.links.live;
  if (p.data.links.writeup) l.writeup = p.data.links.writeup;
  if (p.data.demo.kind !== 'none' && p.data.demo.fullscreen) l.play = abs(`/play/${p.id}`);
  return l;
};

/** The listing shape: what a card would say, as data. */
export function projectRecord(p: Project, parent?: Project) {
  const r: Rec = {
    id: p.id,
    title: p.data.title,
    status: p.data.status,
    year: year(p),
    category: p.data.category ?? parent?.data.category,
    role: p.data.role,
    summary: p.data.blurb,
  };
  if (p.data.plainBlurb) r.summary_plain = p.data.plainBlurb;
  r.stack = p.data.stack;
  const m = metricsOf(p);
  if (m) r.metrics = m;
  const l = linksOf(p);
  if (Object.keys(l).length > 0) r.links = l;
  if (parent) r.parent = { id: parent.id, title: parent.data.title, page: abs(`/projects/${parent.id}`) };
  r.page = abs(`/projects/${p.id}`);
  return r;
}

/** The full shape: the listing record plus the contract, the parts, the cover. */
export function projectFullRecord(p: Project, children: Project[], parent?: Project) {
  const base = projectRecord(p, parent);
  const { page, ...rest } = base;
  const r: Rec = {
    ...rest,
    problem: p.data.problem,
    unique: p.data.unique,
    ai: p.data.aiNote,
    learned: p.data.learned,
  };
  if (children.length > 0) {
    r.subsystems = children.map((c) => ({
      id: c.id,
      title: c.data.title,
      summary: c.data.blurb,
      page: abs(`/projects/${c.id}`),
    }));
  }
  if (p.data.cover) {
    r.cover = {
      url: abs(p.data.cover.src),
      width: p.data.cover.width,
      height: p.data.cover.height,
      alt: p.data.coverAlt ?? '',
    };
  }
  r.page = page;
  return r;
}

const isCategory = (v: string): v is Category => (CATEGORIES as readonly string[]).includes(v);

export async function workList(category?: string | null, fields?: string[]) {
  const cat = category && category !== 'all' ? category : '';
  if (cat && !isCategory(cat)) {
    throw new ApiError(400, {
      error: 'bad_request',
      detail: `category must be one of ${CATEGORIES.join(', ')}.`,
    });
  }
  const projects = (await getProjects()).filter((p) => !cat || p.data.category === cat);
  const items = projects.map((p) => pick(projectRecord(p), fields));
  return {
    category: cat || 'all',
    count: items.length,
    items,
    page: abs(`/projects${cat ? `?category=${cat}` : ''}`),
  };
}

export async function projectById(id: string, fields?: string[]) {
  const all = await getAllProjects();
  const p = all.find((x) => x.id === id);
  if (!p) {
    throw new ApiError(404, {
      error: 'not_found',
      detail: `No project with id "${id}".`,
      hint: 'GET /api/work lists every id; a subsystem id looks like internal-erp/repricing.',
    });
  }
  const parent = p.data.parent ? all.find((x) => x.id === p.data.parent) : undefined;
  const children = await getChildren(p.id);
  return pick(projectFullRecord(p, children, parent), fields);
}

// ----------------------------------------------------------- /api/experience

const startYear = (start: string) => Number(start.slice(-4));

export function experienceRecord(since?: string | null, fields?: string[]) {
  const s = since ? String(since) : '';
  if (s && !/^\d{4}$/.test(s)) {
    throw new ApiError(400, { error: 'bad_request', detail: 'since must be a four-digit year.' });
  }
  const jobs = site.experience
    .filter((j) => !s || startYear(j.start) >= Number(s))
    .map((j) => ({
      title: j.title,
      org: j.org,
      place: j.place,
      start: j.start,
      end: j.end,
      summary: j.summary,
      bullets: j.bullets,
    }));
  const r: Rec = {};
  if (s) r.since = Number(s);
  r.path = site.path.map((x) => ({ id: x.id, when: x.when, what: x.what, note: x.note }));
  r.jobs = jobs;
  r.education = site.education.map((e) => ({ title: e.title, org: e.org, place: e.place, when: e.when, detail: e.detail }));
  r.certifications = site.certifications.map((c) => ({ name: c.name, issuer: c.issuer, id: c.id }));
  r.page = abs(`/about${s ? `?since=${s}` : ''}`);
  return pick(r, fields);
}

// --------------------------------------------------------------- /api/resume

export function resumeRecord(format: string = 'json', fields?: string[]) {
  if (!['json', 'html', 'pdf'].includes(format)) {
    throw new ApiError(400, { error: 'bad_request', detail: 'format must be json, html or pdf.' });
  }
  const skills: Rec = {};
  for (const row of site.skills) skills[row.group] = row.items;
  return pick(
    {
      format,
      name: site.name,
      role: site.role,
      location: site.location,
      email: site.email,
      summary: site.resumeSummary,
      experience: site.experience.map((j) => ({
        title: j.title,
        org: j.org,
        place: j.place,
        start: j.start,
        end: j.end,
        bullets: j.bullets,
      })),
      projects: site.resumeProjects.map((p) => ({
        title: p.title,
        stack: p.stack,
        summary: p.blurb,
        page: p.href.startsWith('/') ? abs(p.href) : p.href,
      })),
      skills,
      education: site.education.map((e) => ({ title: e.title, org: e.org, place: e.place, when: e.when, detail: e.detail })),
      certifications: site.certifications.map((c) => ({ name: c.name, issuer: c.issuer, id: c.id })),
      paper: 'US Letter, one page',
      pdf: abs(site.resumePdf),
      page: format === 'pdf' ? abs(site.resumePdf) : abs(site.resumeUrl),
    },
    fields,
  );
}

// ------------------------------------------------------- /api/away-from-work

export async function awayRecord(playable: boolean, fields?: string[]) {
  const game = (await getProjects()).find((p) => p.id === 'galaxy-defense');
  const r: Rec = {
    note: site.away.note,
    interests: site.away.interests,
  };
  if (game) {
    r.first_program = {
      id: game.id,
      title: game.data.title,
      year: year(game),
      status: game.data.status,
      summary: game.data.blurb,
      play: abs(`/play/${game.id}`),
      page: abs(`/projects/${game.id}`),
    };
  }
  r.help_desk = abs('/desk');
  r.playable = playable;
  r.page = playable && game ? abs(`/play/${game.id}`) : abs('/projects/galaxy-defense');
  return pick(r, fields);
}

// ------------------------------------------------------------------- /api

/** The index: every endpoint, its parameters and where its answer is read
 *  from, so the API describes itself the way the pages do. Each entry carries
 *  the page whose row it is, and the record's own page is `/reference`, the
 *  same list rendered as a page. */
export function indexRecord() {
  return {
    name: new URL(ORIGIN).host,
    description:
      'A read-only API over the same facts the site renders. Every record carries `page`, the address of the page it describes.',
    endpoints: ENDPOINTS.map((e) => ({
      method: e.method,
      path: e.path,
      description: e.description,
      params: e.params.map((p) => ({
        name: p.name,
        description: p.description,
        ...(p.options ? { one_of: p.options.map((o) => o.value).filter(Boolean) } : {}),
      })),
      source: e.source,
      page: abs(e.page.href),
    })),
    fields: 'Any GET accepts ?fields=a,b to return a subset of keys; `page` always comes back.',
    page: abs('/reference'),
  };
}

// ---------------------------------------------------------------- responses

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  // A public read-only API: anyone may fetch it from anywhere.
  'access-control-allow-origin': '*',
};

/** A 200 is a record that was true five minutes ago and still is; anything
 *  else — an error, a write — is not for a cache to keep. */
export const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      ...HEADERS,
      'cache-control': status === 200 ? 'public, max-age=300, s-maxage=3600' : 'no-store',
      ...extra,
    },
  });

/** Run an endpoint body; an ApiError becomes its own response. */
export async function respond(fn: () => Promise<unknown> | unknown): Promise<Response> {
  try {
    return json(await fn());
  } catch (e) {
    if (e instanceof ApiError) return json({ status: e.status, ...e.body }, e.status);
    throw e;
  }
}

export const methodNotAllowed = (allow: string) =>
  json({ status: 405, error: 'method_not_allowed', allow }, 405, { allow });
