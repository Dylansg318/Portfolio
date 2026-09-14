import type { APIRoute } from 'astro';
import { experienceRecord, methodNotAllowed, parseFields, respond } from '../../lib/api';

/** GET /api/experience?since=YYYY — the path here. */
export const prerender = false;

export const GET: APIRoute = ({ url }) =>
  respond(() => experienceRecord(url.searchParams.get('since'), parseFields(url.searchParams.get('fields'))));

export const ALL: APIRoute = () => methodNotAllowed('GET');
