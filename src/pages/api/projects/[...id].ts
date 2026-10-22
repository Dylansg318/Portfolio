import type { APIRoute } from 'astro';
import { methodNotAllowed, parseFields, projectById, respond } from '../../../lib/api';

/** GET /api/projects/{id} — one project in full. */
export const prerender = false;

export const GET: APIRoute = ({ params, url }) =>
  respond(() => projectById(params.id ?? '', 'projects', parseFields(url.searchParams.get('fields'))));

export const ALL: APIRoute = () => methodNotAllowed('GET');
