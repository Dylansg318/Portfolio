import type { APIRoute } from 'astro';
import { methodNotAllowed, parseFields, personRecord, respond, type View } from '../../lib/api';

/** GET /api/dylan?view=plain|engineer — who this is. */
export const prerender = false;

export const GET: APIRoute = ({ url }) =>
  respond(() =>
    personRecord((url.searchParams.get('view') ?? 'plain') as View, parseFields(url.searchParams.get('fields'))),
  );

export const ALL: APIRoute = () => methodNotAllowed('GET');
