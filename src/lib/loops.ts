import { site } from './site';

/** The hero's list, in the grammar of my notes: a dated line, a box, an
 *  action. Four are closed and link to the story behind them; the fifth is
 *  open, because the honest answer to "what's next" is that it isn't written.
 *
 *  Every line is a fact that already appears on /about or a write-up. Nothing
 *  here comes from the private vault except the shape of the line. */
export interface Loop {
  when: string;
  text: string;
  href: string;
  done: boolean;
  /** Hover/assistive label for the open line, whose text is deliberately terse. */
  title?: string;
}

export const loops: Loop[] = [
  { when: '2020', text: 'shipped a game with no arrays', href: '/projects/galaxy-defense', done: true },
  { when: '2022', text: 'the manager left me the store', href: '/about#tmobile', done: true },
  { when: '2025', text: 'hired off the restaurant floor', href: '/about#rmh3', done: true },
  { when: '2025', text: 'the spreadsheet became the system', href: '/projects/mhlhub', done: true },
  { when: '2026', text: 'unknown', href: '/contact', done: false, title: 'The next one. Get in touch.' },
];

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
  { t: 'The engineer at ' },
  { t: site.employer.name, href: site.employer.site },
  { t: `, ${site.employer.kind}. ` },
];

export const nameplate: Record<'plain' | 'eng', Segment[]> = {
  plain: [
    ...opening,
    { t: 'I built the one system the company runs its orders, stock, prices and shipping in, and I keep it running.' },
  ],
  eng: [
    ...opening,
    {
      t:
        'I built and run MHLHUB, the ERP the company works in: TypeScript and Postgres, six sales channels, ' +
        '180 scheduled jobs, one codebase. I also own the environments the rest of the business ships through.',
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
