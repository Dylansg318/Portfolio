import type { APIRoute } from 'astro';
import { ENDPOINTS } from '../../lib/endpoints';
import { abs, json, methodNotAllowed } from '../../lib/api';

/**
 * GET /api — the index. Every endpoint, its parameters and where its answer
 * is read from, so the API describes itself the way the pages do.
 *
 * Runs in the Worker like the rest of /api: a request-time route is what
 * lets a query string mean something.
 */
export const prerender = false;

export const GET: APIRoute = () =>
  json({
    name: 'portfolio.dylansg0318.workers.dev',
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
    })),
    fields: 'Any GET accepts ?fields=a,b to return a subset of keys; `page` always comes back.',
    page: abs('/'),
  });

export const ALL: APIRoute = () => methodNotAllowed('GET');
