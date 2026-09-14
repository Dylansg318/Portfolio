# The site in C's world: an API reference with a real, read-only API
<!-- Decision record + scope ledger + verification contract. Slice detail added JIT. -->

## Decision
**Problem:** The approved home-page direction (C, "API reference": Plain English prose beside a dark
response column, a try-it console on every endpoint) exists only as a mockup; the live site is still
the green-on-graphite world it replaces. The ERP's product name is on the public site and in the
public repo, means nothing to a reader, and is a leak risk.

**Approach:** Move the whole site shell into C's world — one committed light theme (white prose
column, continuous dark response column), Source Sans 3 + JetBrains Mono, one blue-violet accent,
method badges — keeping every fact, both registers, the page order and the games' and help desk's
own worlds. Ship a real read-only JSON API under `/api/` (Worker routes reading the same
`site.ts` + content collection the pages render), so the console's Send really fetches, a pasted
cURL works, and "200 OK" is true. Rename the ERP to "the internal ERP" at
`/projects/internal-erp` with redirects from every old URL, and retire the old name from the
current tree (history is not rewritten). Nothing about the résumé's facts, the contract fields or
the demo lanes changes.

**Rejected:**
- Dual theme in C — doubles every new surface, weakens the light-prose/dark-code signature, and is
  not what was approved from the mock. C is single-theme; the theme toggle goes.
- Mock-labelled console — the cleverest part of C stays a prop; the real API is half a session.
- Home page only / shell first — a site that reads as two sites the moment someone clicks.
- Porting the mock's hash-router SPA — no SEO, no RSS, no no-JS path. Astro pages instead.
- Purging the name from git history — a force-push rewrite; a separate call, not made here.

**Invariants that must hold (the project's own):** only facts already on the site, no phone or
street address, no customer/vendor names not already public (`DESIGN_SYSTEM.md` §11); the contract
fields render on every project; both registers everywhere, plain by default without JS; the résumé
prints to one US-Letter page and the PDF is regenerated from the page; "deliberately"/"on purpose"
comments are kept unless the thing they guard is removed; games and `/desk` keep their own worlds;
`npm run check` and `npm run build` pass before a push; push to `main` deploys; stage and commit
by explicit path.

## Verification contract
| # | Slice | Proof command | Expected observable |
|---|---|---|---|
| 1 | Rename | `grep -rli <old name> src public README.md PRODUCT.md code/README.md` | no matches; `npm run build` emits the old-path → `/projects/internal-erp` redirects (incl. subsystems) |
| 2 | Tokens, fonts, shell | `npm run check` | contrast gate passes on the new pairs; astro check 0 errors |
| 3 | API | `npm run build && npx wrangler dev` + `curl /api/work?category=game` | JSON with 2 records, `content-type: application/json`, CORS header; `/api/work/nope` → 404 JSON |
| 4–8 | Console + pages | Playwright at 1440 and 390: `/`, `/projects`, `/projects/internal-erp`, `/about`, `/resume`, `/contact`, `/404`, `/desk` | no horizontal overflow; console at rest shows the real body; Send fetches and opens |
| 8 | Résumé PDF | `npm run resume:pdf` → `pdfinfo public/resume.pdf` | `Pages: 1`; `pdftotext` has no old product name |
| 11 | Ship | `npm run check && npm run build`, push, `curl https://portfolio.dylansg0318.workers.dev/api/dylan` | gates 0 errors; live 200 JSON |

## Scope ledger
- [x] 1. Rename the ERP (old product name → "the internal ERP"): content dir, frontmatter, copy, `site.ts`, redirects, desk, docs   DONE adb942d
- [x] 2. C tokens + fonts + single theme + header/footer + contrast gate + OG cards + drop dark images   DONE (this change)
- [x] 3. Real API: `src/lib/api.ts` + Worker routes under `/api/` with query params, `fields`, CORS   DONE (this change)
- [x] 4. Console island + row primitives (`Console`, `EndpointRow`, `Rail`, `Method`, `console.ts`)   DONE (this change)
- [x] 5. Home page in C   DONE (this change)
- [x] 6. Work index + project page (+ MDX components restyled)   DONE (this change)
- [x] 7. About, Contact, 404 in C   DONE (this change)
- [x] 8. Résumé page, print CSS, regenerated PDF   DONE (this change)
- [x] 9. Remove stranded components; desk and play sanity check   DONE (this change)
- [x] 10. Docs: DESIGN_SYSTEM §3/§4/§5/§7/§8/§9/§10/§12, README, PRODUCT.md, surface brief   DONE (this change)
- [x] 11. Gates, captures, commit by path, push, live check   DONE (this change)

## Slice detail — Slice 1: Rename
**Files:** `src/content/projects/<old>/**` → `src/content/projects/internal-erp/**` (git mv);
frontmatter titles/blurbs/alt in the moved files and `receipt-splitter`; `src/lib/site.ts`
(`resumeProjects`, experience bullets); `src/pages/{index,about,contact}.astro`,
`src/pages/projects/index.astro`; `src/lib/{desk,loops}.ts`; `astro.config.mjs` redirects;
`README.md`, `code/README.md`, `PRODUCT.md`, `DESIGN_SYSTEM.md`, `.impeccable/surfaces/*.md`.
**Change:** the public name is "the internal ERP" (title: "The internal ERP that runs a dental
supply company"); ids/URLs use `internal-erp`; old paths redirect (the old slug,
its `[sub]` children, and the three older aliases retarget). Employer name stays (already
public). Script comments that named the sibling repo now say "the ERP repo".
**Proves it:** the grep above is empty and the build lists the redirects.

## What execution added
- The write-up's own map (h2 anchors) sits in the dark column beside the MDX body, pruned to the
  register in view — the body was the one row with no natural endpoint.
- `fields` is an optional parameter on every GET console: rendered only where the row is about a
  subset, real everywhere.
- Same-site `page` links are followed relative to the current origin, so `wrangler dev` and any
  preview stay on their own host.
- Two class-name collisions with the help desk (`.panel`, `.chips`) — the reference styles are now
  scoped to their columns; a new global class name is on the §8.3 checklist.
- Contrast gate rewritten for one token block and caught the mock's accent at 4.41:1 on the quiet
  fill; the accent is `#5e56fb`.
- Not done, by design: mail delivery for `POST /api/contact` (needs the Cloudflare secrets), the
  finish-reviewer round (UI work ships without a second-model pass per the working rules).
