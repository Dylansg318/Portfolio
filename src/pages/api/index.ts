import type { APIRoute } from 'astro';
import { indexRecord, json, methodNotAllowed } from '../../lib/api';

/**
 * GET /api — the index. Every endpoint, its parameters and where its answer
 * is read from, so the API describes itself the way the pages do. The same
 * record is the response on /reference, which is this list as a page.
 *
 * Runs in the Worker like the rest of /api: a request-time route is what
 * lets a query string mean something.
 */
export const prerender = false;

export const GET: APIRoute = () => json(indexRecord());

export const ALL: APIRoute = () => methodNotAllowed('GET');
