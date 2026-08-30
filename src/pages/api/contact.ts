import type { APIRoute } from 'astro';

/**
 * The ONLY route in this site that runs at request time. Everything else is
 * prerendered and served free from Cloudflare's edge; this one invokes the
 * Worker, against a 100,000/day free ceiling a portfolio will never approach.
 */
export const prerender = false;

interface ContactPayload {
  name?: unknown;
  email?: unknown;
  message?: unknown;
  /** Honeypot — real users never fill this; bots usually do. */
  company?: unknown;
  'cf-turnstile-response'?: unknown;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

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

export const POST: APIRoute = async ({ request, locals, clientAddress }) => {
  const env = (locals as any)?.runtime?.env ?? (import.meta.env as Record<string, string>);

  let payload: ContactPayload;
  try {
    payload = (await request.json()) as ContactPayload;
  } catch {
    return json({ error: 'Expected JSON.' }, 400);
  }

  // Honeypot: pretend success so the bot doesn't learn anything.
  if (typeof payload.company === 'string' && payload.company.trim() !== '') {
    return json({ ok: true });
  }

  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const email = typeof payload.email === 'string' ? payload.email.trim() : '';
  const message = typeof payload.message === 'string' ? payload.message.trim() : '';

  const errors: Record<string, string> = {};
  if (name.length < 2 || name.length > 100) errors.name = 'Please give a name.';
  if (!isEmail(email)) errors.email = 'That email address does not look right.';
  if (message.length < 10) errors.message = 'A little more detail, please.';
  if (message.length > 5000) errors.message = 'That is too long for this form.';

  if (Object.keys(errors).length > 0) {
    return json({ error: 'Validation failed.', fields: errors }, 422);
  }

  // Spam check. Skipped only when no secret is configured (local dev).
  const turnstileSecret = env.TURNSTILE_SECRET;
  if (turnstileSecret) {
    const token = payload['cf-turnstile-response'];
    if (typeof token !== 'string' || token === '') {
      return json({ error: 'Please complete the spam check.' }, 400);
    }
    const ok = await verifyTurnstile(token, turnstileSecret, clientAddress ?? null);
    if (!ok) return json({ error: 'Spam check failed. Please try again.' }, 403);
  }

  const apiKey = env.RESEND_API_KEY;
  const to = env.CONTACT_TO;

  // Not configured yet: accept and log rather than 500 at a visitor.
  if (!apiKey || !to) {
    console.warn('[contact] RESEND_API_KEY / CONTACT_TO unset — message not delivered', {
      name,
      email,
    });
    return json({ ok: true, delivered: false });
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
      subject: `Portfolio contact — ${name}`,
      text: `From: ${name} <${email}>\n\n${message}`,
    }),
  });

  if (!res.ok) {
    console.error('[contact] resend failed', res.status, await res.text());
    return json({ error: 'Could not send right now. Try again shortly.' }, 502);
  }

  return json({ ok: true, delivered: true });
};
