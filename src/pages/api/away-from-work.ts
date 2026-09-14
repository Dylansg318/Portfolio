import type { APIRoute } from 'astro';
import { awayRecord, methodNotAllowed, parseFields, respond } from '../../lib/api';

/** GET /api/away-from-work?playable=true — off the clock, and the first program. */
export const prerender = false;

export const GET: APIRoute = ({ url }) =>
  respond(() =>
    awayRecord(['true', '1', 'yes'].includes(url.searchParams.get('playable') ?? ''), parseFields(url.searchParams.get('fields'))),
  );

export const ALL: APIRoute = () => methodNotAllowed('GET');
