import type { APIRoute } from 'astro';
import { methodNotAllowed, parseFields, projectList, respond } from '../../lib/api';

/** GET /api/projects?category=tool|game|course — everything that isn't work. */
export const prerender = false;

export const GET: APIRoute = ({ url }) =>
  respond(() => projectList(url.searchParams.get('category'), parseFields(url.searchParams.get('fields'))));

export const ALL: APIRoute = () => methodNotAllowed('GET');
