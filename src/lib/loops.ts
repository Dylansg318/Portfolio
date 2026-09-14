import { site } from './site';

/** The nameplate sentence — the one line of employment the home page opens
 *  with and GET /api/dylan returns as `summary` — in two registers, plus the
 *  tokenizer the word-morph in Nameplate.astro runs on. */

/** One sentence of employment, in two registers. The first sentence is the
 *  same in both so it stays put when the switch flips and only the claim
 *  rewrites — same fact, two audiences, which is the thing being shown.
 *
 *  A segment with `href` is one link and one token; the morph never splits
 *  it, so the employer is a single link in both registers. */
export interface Segment {
  t: string;
  href?: string;
}

const opening: Segment[] = [
  { t: 'I ran a phone store, then a restaurant floor. ' },
];
const employer: Segment[] = [
  { t: "Today, I'm the engineer at " },
  { t: site.employer.name, href: site.employer.site },
];

export const nameplate: Record<'plain' | 'eng', Segment[]> = {
  plain: [
    ...opening,
    ...employer,
    { t: ', where I built the system the company runs its orders, stock and shipping in, and I keep it running.' },
  ],
  eng: [
    ...opening,
    ...employer,
    {
      t:
        ', where I built and run the ERP the company works in. Mostly TypeScript, ' +
        'Node and Postgres: integrations, data correctness, and the deploys.',
    },
  ],
};

/** A word, or a whole link, plus whether a space follows it. `post` lives on
 *  the token so a word can collapse to zero width and take its space with it. */
export interface Token {
  w: string;
  href?: string;
  post: '' | ' ';
}

export function tokenize(segments: Segment[]): Token[] {
  const out: Token[] = [];
  for (const s of segments) {
    if (s.href) {
      out.push({ w: s.t, href: s.href, post: '' });
      continue;
    }
    // Keep the separators: a run of whitespace marks the previous token's
    // trailing space, so ", a" glues to the link before it and "at " does not.
    for (const part of s.t.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        if (out.length) out[out.length - 1].post = ' ';
      } else {
        out.push({ w: part, post: '' });
      }
    }
  }
  return out;
}
