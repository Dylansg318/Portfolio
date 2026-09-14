import type { APIRoute } from 'astro';
// Astro v6 removed `Astro.locals.runtime.env`; bindings and secrets now come
// from the Workers runtime module. This resolves at request time inside the
// Worker, which is the only place this route ever runs.
import { env } from 'cloudflare:workers';
import { site } from '../../lib/site';
import { json, methodNotAllowed } from '../../lib/api';

/**
 * POST /api/contact — the one write in the API.
 *
 * Until mail delivery is configured (RESEND_API_KEY and CONTACT_TO), a valid
 * message is answered with 503 and a `mailto:` link carrying it, and the
 * console on the site opens that link. An unconfigured route that said
 * `{ ok: true }` would be a job reporting success while doing nothing — the
 * one failure this site's own rules single out.
 */
export const prerender = false;

interface ContactPayload {
  name?: unknown;
  email?: unknown;
  /** The console's name for `email`. */
  from?: unknown;
  message?: unknown;
  /** Honeypot — real users never fill this; bots usually do. */
  company?: unknown;
  'cf-turnstile-response'?: unknown;
}

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const SUBJECT = 'Hello from your portfolio';

const mailto = (email: string, message: string) =>
  `mailto:${site.email}?subject=${encodeURIComponent(SUBJECT)}&body=${encodeURIComponent(
    message + (email ? `\n\n— ${email}` : ''),
  )}`;

async function verifyTurnstile(token: string, secret: string, ip: string | null) {
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form,
  });
  const data = (await res.json()) as { success?: boolean };
  return data.success === true;
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const secrets = env as unknown as Record<string, string | undefined>;

  let payload: ContactPayload;
  try {
    payload = (await request.json()) as ContactPayload;
  } catch {
    return json({ status: 400, error: 'bad_request', detail: 'Expected a JSON body.' }, 400);
  }

  // Honeypot: pretend success so the bot doesn't learn anything.
  if (typeof payload.company === 'string' && payload.company.trim() !== '') {
    return json({ ok: true }, 200, { 'cache-control': 'no-store' });
  }

  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const rawEmail = typeof payload.email === 'string' ? payload.email : typeof payload.from === 'string' ? payload.from : '';
  const email = rawEmail.trim();
  const message = typeof payload.message === 'string' ? payload.message.trim() : '';

  const errors: Record<string, string> = {};
  if (name && (name.length < 2 || name.length > 100)) errors.name = 'Please give a name.';
  if (email && !isEmail(email)) errors.from = 'That email address does not look right.';
  if (message.length < 10) errors.message = 'A little more detail, please — ten characters or more.';
  if (message.length > 5000) errors.message = 'That is too long for this form.';

  if (Object.keys(errors).length > 0) {
    return json({ status: 422, error: 'validation_failed', fields: errors }, 422);
  }

  const apiKey = secrets.RESEND_API_KEY;
  const to = secrets.CONTACT_TO;

  // Not configured: say so, and hand the message to the reader's mail client.
  if (!apiKey || !to) {
    return json(
      {
        status: 503,
        error: 'mail_not_configured',
        detail: 'This route cannot deliver mail yet. The address below can.',
        to: site.email,
        subject: SUBJECT,
        mailto: mailto(email, message),
        page: mailto(email, message),
      },
      503,
    );
  }

  // Spam check. Only enforced once a secret is configured.
  const turnstileSecret = secrets.TURNSTILE_SECRET;
  if (turnstileSecret) {
    const token = payload['cf-turnstile-response'];
    if (typeof token !== 'string' || token === '') {
      return json({ status: 400, error: 'spam_check_required', detail: 'Please complete the spam check.' }, 400);
    }
    const ok = await verifyTurnstile(token, turnstileSecret, clientAddress ?? null);
    if (!ok) return json({ status: 403, error: 'spam_check_failed', detail: 'Spam check failed. Please try again.' }, 403);
  }

  if (!email) {
    return json({ status: 422, error: 'validation_failed', fields: { from: 'An address to reply to, please.' } }, 422);
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Portfolio <onboarding@resend.dev>', // replace once a domain is verified
      to: [to],
      reply_to: email,
      subject: `Portfolio contact — ${name || email}`,
      text: `From: ${name ? `${name} <${email}>` : email}\n\n${message}`,
    }),
  });

  if (!res.ok) {
    console.error('[contact] resend failed', res.status, await res.text());
    return json({ status: 502, error: 'delivery_failed', detail: 'Could not send right now. Try again shortly.' }, 502);
  }

  return json({ status: 202, ok: true, delivered: true, to: site.email }, 202);
};

export const ALL: APIRoute = () => methodNotAllowed('POST');
