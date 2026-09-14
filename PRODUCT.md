# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A recruiter, hiring manager, or engineer deciding in under a minute whether to
interview Dylan for a backend or full-stack role. They arrive from a résumé link, a
LinkedIn profile, or a GitHub README, usually on a laptop, sometimes on a phone
between meetings, and they are comparing him against other candidates they opened
in adjacent tabs.

A second audience shares the same pages: a founder, a family member, or a former
colleague who wants to know what he does now, in words that do not assume they know
what an ERP is.

## Product Purpose

The site is Dylan San Gabriel's professional home page. It says what he built, for
whom, and what changed as a result, and gives one way to get in touch. Success is a
reader who leaves knowing three things — he is the only engineer on the system a
dental supply company runs its day on, he got there from retail and restaurant work,
and how to reach him — and who believes all three because every claim can be checked.

## Positioning

One person who went from managing a T-Mobile store and running a Korean BBQ floor
to designing, building, and running the in-house ERP at RMH3 Dental Supply, as its
only engineer, with the numbers measured on the production database and dated.
Every page ships in two registers, Plain English and Engineer, from the same facts.
Thirteen sanitized production modules are public in the repo's `code/` tree as
third-party-checkable evidence for a system that is otherwise private.

## Operating Context

The reader typically has the résumé PDF, the LinkedIn profile, and this site open
together and is looking for agreement between them. Titles, dates, and numbers on
the home page must match `src/lib/site.ts`, which also renders the résumé. Numbers
carry an as-of date (`statsAsOf`). The header carries the Plain English / Engineer
switch; plain is the default and is what crawlers and no-JS readers get.

## Capabilities and Constraints

- Astro 7, Tailwind 4, MDX, deployed to Cloudflare Workers. A push to `main` is a
  deploy.
- Every page ships both registers in the HTML; visibility is CSS on `data-mode`.
  Nothing is fetched on the switch.
- Write-ups ship with no JavaScript; demos and games load behind a click.
- Dark theme is the default and the server renders it; the visitor's toggle wins.
- `npm run check` runs a contrast gate that fails the build on any token pair below
  4.5:1 (3:1 for strong borders).
- Terminology: "Software Engineer" is the title everywhere. Education is
  "coursework" at George Mason, never a degree. Metrics are outcome or scale
  figures, never size figures (no lines of code, table counts, endpoint counts).
- The repository is public. Only facts already on the site appear in code, comments,
  plans, or commits. No customer, vendor, price, or storefront names beyond those
  already published; no phone number or street address.

## Brand Commitments

- Name: Dylan San Gabriel. Role: Software Engineer. Location: Chantilly, VA · US Eastern.
- Voice, binding: fact first with no runway; concrete nouns over abstractions; no
  adjectives about himself; plain courtesy, not brochure warmth; honest hedges stay
  ("mostly backend", "about"). No slogans, no availability pitch above the fold, no
  typewriter effects. Full rules in `DESIGN_SYSTEM.md` §2 and the 2026-09-10 log entry.
- Structure, binding (decided 2026-09-10, reconfirmed 2026-09-14): the home page is
  person-first — name and role → short background → selected work → experience →
  personal → contact. The first nameplate sentence is identical in both registers.
- Incumbent visual world, documented in `DESIGN_SYSTEM.md` §3: graphite ground,
  Meadow Green accent ramp spent on emphasis only, Bricolage Grotesque display, IBM
  Plex Sans body, IBM Plex Mono. On 2026-09-14 Dylan asked to see the home page both
  inside this world and in a replacement world, side by side, before deciding.

## Evidence on Hand

- Production metrics, measured August 2026 (`src/lib/site.ts` → `stats`): ~520
  orders a day (up from ~270), 32K products / 49K channel listings, 6 sales channels,
  180 scheduled jobs.
- Redacted screenshots of the internal ERP and the receipt splitter under
  `src/content/projects/*/` and `public/`, paired light and dark.
- Career record (`site.experience`): Software Engineer at RMH3 Dental Supply
  (Jun 2025–present); Head Server, The Qui (Aug 2022–Jun 2025); Store Manager,
  Wireless Vision / T-Mobile (Jan 2021–Aug 2022).
- Thirteen public code excerpts with tests in `code/`.
- Two playable demos (Galaxy Defense, Shotcall) and an embedded receipt splitter.
- Absent, not to be invented: testimonials, client quotes, press, employer logos
  beyond the employer's name, any business figure beyond the four stats and the
  per-project metrics.

## Product Principles

1. Proof over claims: every sentence survives someone opening the commit log or the
   `code/` tree.
2. Two audiences, one page: the same facts in two vocabularies, both shipped.
3. Honest, not modest: no inflated title, no degree not conferred, the retail years
   told as what they were.
4. Nothing loads until asked.
5. Consistency is structural: schemas, gates, and one facts file remember the rules
   so people do not have to.

## Accessibility & Inclusion

Every token pair is gated at WCAG AA in `npm run check`. Reduced motion zeroes all
durations and disables scroll-driven animation. Every heading level is real; eyebrows
are never fake headings. The site must read fully with JavaScript off.
