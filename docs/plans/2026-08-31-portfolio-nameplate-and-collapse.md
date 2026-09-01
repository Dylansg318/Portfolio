# Portfolio: nameplate homepage, ERP collapse, credential About
<!-- Decision record + scope ledger + verification contract. Slice detail added JIT. -->

## Decision

**Problem:** The homepage renders most of `site.ts` — 6 sections, 17 boxes, ~716 words — and
auto-selects its four work slots by `featured` rank, so all four are the same codebase. Five of
nine write-ups are one system. The site reads as "one job at a small company," which is the
exact impression Dylan does not want in front of a recruiter. Separately, the density is
compensation for missing evidence: nine write-ups, ~9,600 words, zero screenshots.

**Approach:**
1. **Hero → nameplate.** Name, discipline, location, then one factual sentence of employment.
   No first-person claim ("I build the software that runs…"), no availability sales line. The
   four stat tiles move onto the MHLHUB card, where they are facts about a system rather than a
   boast about a person.
2. **Homepage → three sections** (nameplate / the work / contact). 17 boxes → ~7. One contact
   exit instead of four. Removed content moves to `/about` and `/resume`, which already carry it.
3. **Collapse the ERP** as parent + children: `repricer`, `channel-sync` and `quickbooks` move to
   `src/content/projects/mhlhub/<slug>/index.mdx`, which the existing `**/index.mdx` glob renders
   at `/projects/mhlhub/<slug>` with no route changes. Top-level work list reads 6, not 9.
4. **`/about` becomes the credential narrative** — the actual through-line: recruited off a
   restaurant floor by a customer, then inventory → shipping → customer service → automation →
   the ERP; T-Mobile salesman → store manager; all during a GMU CS degree.
5. **Name the enablement work.** Dylan is the only engineer; the non-technical owner also ships,
   by directing AI. Dylan owns the backend, the environments (Shopify, Railway, GitHub, Harness)
   and the guardrails that make that safe. This pre-explains the second committer in the repo and
   is the strongest available answer to the "worked alone, nothing reviewed" read.

**Rejected:**
- *One merged mega-page for the ERP* — ~4,600 words in one scroll, and it buries the repricer,
  which is the best single engineering story on the site.
- *Just reorder `featured`* — cheapest, but the list still shows nine items of which five say ERP.
- *Adding filler projects for breadth* — the answer to "looks like one job" is making the one job
  look large and rigorous, not making it look smaller.
- *Claiming the new storefront* — 50 of its 51 commits are the owner's. Dylan set up the platform
  it deploys on; that is what gets claimed.
- *Dropping "sole engineer"* — it is true (the other committer is non-technical, and Dylan uses
  both accounts at times). Explaining it beats hedging it.

**Invariants that must hold:**
- `src/lib/site.ts` stays the single source of truth for anything appearing on more than one page.
- The narrative contract in `src/content.config.ts` (`problem` / `unique` / `learned` required)
  keeps failing the build rather than publishing a half-finished write-up.
- No dead URLs: every moved project keeps a working path from its old one.
- Every claim on the site must survive someone opening `RMH3Dental/MHLHUB` and reading the log.
- No screenshot ships with a real customer name, price, or vendor identifier.

## Verification contract

| # | Slice | Proof command | Expected observable |
|---|---|---|---|
| 1 | Identity + role accuracy | `npm run check` | 0 errors |
| 2 | Homepage strip | `grep -c '<!-- =' src/pages/index.astro` | 3 section markers |
| 3 | ERP collapse | `npm run build` then `ls dist/client/projects/mhlhub/` | `repricing.html`, `channel-sync.html`, `quickbooks.html` exist |
| 3 | Old URLs alive | `grep -c '' public/_redirects` | 3 redirect rules |
| 3 | Top-level list is 6 | `node -e` over the built `/projects` page | 6 cards |
| 4 | About narrative | `npm run check && npm run build` | 0 errors, build succeeds |

## Scope ledger

- [x] 1. `site.ts` — nameplate identity, employer facts, enablement framing, Harness   DONE (uncommitted)
- [x] 2. Homepage → nameplate / the work / contact; stats onto the MHLHUB card          DONE (uncommitted)
- [x] 3. ERP collapse: nested content, `parent` field, subsystem cards, redirects       DONE (uncommitted)
- [x] 4. `/about` → credential narrative + principles moved off the homepage            DONE (uncommitted)
- [x] 5. Redacted screenshots for MHLHUB and the repricer                              DONE (uncommitted)

## Slice detail — current slice

### Slice 1: identity in `site.ts`
**Files:** `src/lib/site.ts`
**Change:**
- `tagline` → drop the first-person claim; it feeds `/about`'s meta description and the default
  OG card, so it must read as a description, not a boast.
- Add `employer: { name, kind, since }` so the nameplate sentence is data, not hard-coded copy.
- Keep `availability` (still rendered on `/desk`); stop rendering it in the hero.
- `experience[0].summary` — add the enablement line; add Harness to ops tooling.
**Proves it:** `npm run check` → 0 errors.

## Result

`npm run check` → 0 errors / 0 warnings / 0 hints. `npm run build` → 18 pages indexed.

Built routes confirm the collapse: `/projects/mhlhub/{repricing,channel-sync,quickbooks}.html`
exist, `dist/client/_redirects` carries three 301s from the old flat paths, and both the home
page and `/projects` list six top-level items instead of nine. Home page went 6 sections / 17
boxes / ~716 words → 3 sections / 1 card + 5 rows, and four contact exits → one.

Two fixes found by looking at the rendered page rather than the diff:
- The featured card printed its own title twice (the generated cover art repeated the heading).
  The cover now carries the headline metric and the row below it skips that metric.
- Astro compiles `<!-- -->` inside a JSX expression as a parse error. Comments explaining code
  inside `{cond && (…)}` have to sit above the expression or use `{/* */}`.

## Slice 5 — screenshots (added after the fact)

Captured from the live app, authenticated through the internal agent-testing path documented
in the MHLHUB repo (details private).

Shipped, after redaction:
- `mhlhub/warehouse-map.png` — the floor-plan editor, 119 numbered locations across two
  buildings. MHLHUB's cover. Nothing sensitive in it.
- `mhlhub/repricing/repricer-dashboard.png` — buy-box win/loss, push success rates, the
  "why we're losing" breakdown, and the safety rails. The repricing page's cover.
- `mhlhub/repricing/repricer-log.png` — 8,592 pushes over seven days with a reason per row.
  Rendered as a `<Figure wide>` OUTSIDE the PlainOnly/EngOnly blocks so both reading modes
  get it; a picture needs no jargon to be useful.

Redaction method: a CSS `filter: blur(5px)` applied in the browser to leaf elements whose text
matched the other legal entities, then screenshotted. Blurring in the page beats drawing boxes
over a PNG afterwards — it survives re-capture and it cannot miss an occurrence that scrolled.

NOT shipped:
- `/channels` (Channel Hub) — per-channel P&L. The capture happened to be empty because the
  period had just rolled over at 01:45, but the page's job is revenue and margin. Keep it off.
- `/automation` — clean of data, but it renders three of its seven rules twice. Fix the page
  before using it as an exhibit.
