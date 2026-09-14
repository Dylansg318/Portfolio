import type { APIRoute } from 'astro';
import { methodNotAllowed, parseFields, respond, workList } from '../../lib/api';

/** GET /api/work?category=work|tool|game — every top-level project. */
export const prerender = false;

export const GET: APIRoute = ({ url }) =>
  respond(() => workList(url.searchParams.get('category'), parseFields(url.searchParams.get('fields'))));

export const ALL: APIRoute = () => methodNotAllowed('GET');
