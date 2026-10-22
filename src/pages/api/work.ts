import type { APIRoute } from 'astro';
import { methodNotAllowed, parseFields, respond, workList } from '../../lib/api';

/** GET /api/work — what I built at my job. Everything else is GET /api/projects. */
export const prerender = false;

export const GET: APIRoute = ({ url }) => respond(() => workList(parseFields(url.searchParams.get('fields'))));

export const ALL: APIRoute = () => methodNotAllowed('GET');
