import type { APIRoute } from 'astro';
import { methodNotAllowed, parseFields, projectById, respond } from '../../../lib/api';

/**
 * GET /api/work/{id} — one piece of work in full. A part's id carries its
 * parent's path (internal-erp/repricing), which is why this is a rest route.
 */
export const prerender = false;

export const GET: APIRoute = ({ params, url }) =>
  respond(() => projectById(params.id ?? '', 'work', parseFields(url.searchParams.get('fields'))));

export const ALL: APIRoute = () => methodNotAllowed('GET');
