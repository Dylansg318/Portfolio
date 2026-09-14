import type { APIRoute } from 'astro';
import { methodNotAllowed, parseFields, respond, resumeRecord } from '../../lib/api';

/** GET /api/resume?format=json|html|pdf — the one-page résumé as data. */
export const prerender = false;

export const GET: APIRoute = ({ url }) =>
  respond(() => resumeRecord(url.searchParams.get('format') ?? 'json', parseFields(url.searchParams.get('fields'))));

export const ALL: APIRoute = () => methodNotAllowed('GET');
