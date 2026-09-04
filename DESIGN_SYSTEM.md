# Portfolio Design System

**The language of this site and the decisions behind it.** Visual, verbal, and structural.

This file is public, like everything else in the repository. It is written to be read
by three audiences at once: me, six months from now, adding a project; a coding agent
in a fresh session with none of this in context; and a recruiter or engineer who found
the repo and wants to see how decisions get made here. That third reader is why this is
a document and not a memory file.

`README.md` says how to run, build, and deploy the site, and what the frontmatter fields
are. This file says **why** the site looks, reads, and behaves the way it does, so that
the next project and the next feature match the ones already here without a redesign.
Where the two overlap, the README is the mechanics and this is the reasoning.

**How to use it.** Before adding a project, read §2 (voice) and §8 (checklists). Before
touching anything visual, read §3 and run the contrast gate. Before changing how a page is
shaped, read §4. Every decision that changes a rule here gets a dated line in §9. The file
is meant to grow: append, date, and never rewrite history to look tidier than it was.

## Table of contents

1. [Principles](#1-principles)
2. [Voice: how the site talks](#2-voice-how-the-site-talks)
3. [Visual language](#3-visual-language)
4. [Page grammar](#4-page-grammar)
5. [Content model](#5-content-model)
6. [Demos, media, and screenshots](#6-demos-media-and-screenshots)
7. [Engineering decisions](#7-engineering-decisions)
8. [Checklists](#8-checklists)
9. [Decision log](#9-decision-log)
10. [Parked and open](#10-parked-and-open)
11. [Public-repo rules](#11-public-repo-rules)
12. [Version history of this file](#12-version-history-of-this-file)

---

## 1. Principles

Six ideas carry the whole site. When a new feature or page conflicts with one of these,
the feature changes, not the principle.

1. **Proof over claims.** Every sentence on the site must survive someone opening the
   MHLHUB commit log, the `code/` tree, or a reference check. Numbers are measured, dated
   (`statsAsOf` in `src/lib/site.ts`), and are outcome or scale figures, never size
   figures. Lines of code, table counts, and endpoint counts were removed on purpose:
   they say how big a thing is, not how well it works, and a reader who knows that
   discounts the numbers next to them.
2. **Two audiences, one page.** The site has a Plain English register and an Engineer
   register, switched in the header. Both ship in the HTML. Plain is the default and is
   what crawlers, RSS readers, and no-JS visitors get. Same facts, two vocabularies.
3. **Colour is emphasis.** A neutral graphite ground carries every page. The Meadow
   Green ramp is spent only on highlights: links, the active tab, the headline gradient,
   focus rings, the eyebrow rule. Nothing large is tinted. Colour reads as emphasis only
   when most of the page is not coloured.
4. **Nothing loads until asked.** A write-up ships with 0 KB of JavaScript. Demos,
   games, and video appear behind a click and never enter the page for a reader who
   came to read. The cheapest performance win is not loading the heavy thing.
5. **Consistency is structural, not remembered.** The write-up contract is a schema that
   fails the build. The contrast gate fails `npm run check`. Code samples read the real
   file at build time. Facts live in one file. Anything that has to be remembered every
   time will eventually be forgotten once, so the tooling remembers instead.
6. **Honest, not modest.** No slogans, no availability sales line in the hero, no
   inflated title, no degree that was not conferred. Retail and restaurant jobs are told
   as what they were: the same thing happening three times in a row, someone watching the
   work and handing over more than the job. The site does not apologise for the path and
   does not decorate it.

---

## 2. Voice: how the site talks

### 2.1 The two registers

| | Plain English (default) | Engineer |
|---|---|---|
| Who it is for | A recruiter, a founder, a family member, a search engine | A hiring manager or engineer deciding whether to interview |
| What it answers | What the work did, for whom, and what changed | How it works, what was hard, what was decided and thrown away |
| Vocabulary | Business terms: orders, stock, prices, the books, the truck | Stack, data shapes, invariants, failure modes, numbers with units |
| Where it lives | `plainBlurb`, `<PlainOnly>` blocks, the plain nameplate sentence | `blurb`, `<EngOnly>` blocks, `problem`, `unique`, the engineer nameplate sentence |

Rules that keep the switch honest:

- **Both registers ship in the HTML.** Visibility is CSS on `data-mode`, set before first
  paint. No content is fetched on flip.
- **Plain is the fallback everywhere.** A card with no `plainBlurb` shows `blurb` in both
  modes. A write-up with no `<PlainOnly>` block shows the same body in both. Never gate
  the only copy of something behind Engineer mode.
- **Figures and screenshots sit outside the mode blocks.** A picture needs no jargon;
  both audiences get it. This is how the repricer push-log figure is placed.
- **The first sentence of the nameplate is identical in both registers.** Only the claim
  rewrites. That is the demonstration: same fact, two audiences. Keep it that way.
- **The contract fields are one register.** `problem` and `unique` are written for the
  engineer reader; `plainBlurb` is the plain reader's summary. Do not write two versions
  of the contract.

### 2.2 Sentence-level rules

- **Say what happened, not what I am.** "The company went from about 270 orders a day to
  about 520" beats "I scaled the business". The nameplate says where I work and what I
  own, and nothing about how good I am at it.
- **Numbers carry units and a date.** "138,000+ price changes, each logged with its
  reason." Round honestly: `~520`, `32K`, `300K+`. A number a reader can check beats a
  bigger one they cannot.
- **Name what was thrown away.** The `aiNote` on every project says what the agent did,
  what I decided, and what I cut. The rejected-options list in each plan does the same.
  Judgement shows in the discards.
- **Write "unknown" rather than guess.** The fifth loop on the home page is literally the
  word "unknown". A number that is not measured is not on the site.
- **No first-person boasts, no slogans, no availability pitch above the fold.** The
  hero's job is the name, the discipline, the location, and one factual sentence.
- **Short words for hard things.** "The spreadsheet became the system." Plain mode should
  be readable aloud to someone who does not know what an ERP is, and Engineer mode should
  not need it either.
- **The retail years are told straight.** Promotions, trust, and being handed the store
  are the argument the About page makes. They are never compressed into a title.

### 2.3 Titles, blurbs, and labels

| Field | Shape | Example |
|---|---|---|
| `title` | Sentence case. Says what the thing is or does, often as a clause after a comma or a claim with a twist. Never a product name alone unless it is a game. | *MHLHUB, the ERP that runs a dental supply company* · *Repricing every minute without a race to the bottom* · *Split the check from a photo* |
| `blurb` | One sentence, ≤160 characters, Engineer register. Doubles as the meta description. | *One system for orders, inventory, repricing, shipping, service and books across six sales channels, built from scratch, about 500 orders a day.* |
| `plainBlurb` | ≤200 characters, business words only. Falls back to `blurb` when absent. | *The company sold on six websites using six different tools that never agreed. I built the one system that runs it all, about 500 orders a day.* |
| `role` | Lower case, middle-dot separated facts. | `sole engineer · 13 daily users` · `solo · side project` · `contributor · team of 10` |
| Metric `label` | Lower case, spaced with slashes for rates. Value is a string so it can carry `~`, `K`, `+`, `$`. | `{ label: orders / day, value: "~520" }` |
| Eyebrow | One or two words, set in the `.eyebrow` style. | *The work* · *Contact* · *Loops* · *Inside it* |
| Section heading on a project page | Fixed wording, never varies per project. | *The problem* · *What was unique* · *Where AI fit in* · *Inside it* · *What I learned* |

### 2.4 The contract, field by field

These three fields are required by the schema and the build fails without them. What
each is for:

- **`problem`**: what was actually wrong or needed, for whom, and what it cost. Not
  "I built an X". A reader should be able to tell whether this was worth doing before
  they know what was done.
- **`unique`**: the non-obvious part. The judgement call, the constraint, the trick, the
  thing a competent engineer might have done differently. One or two sentences that would
  not appear in any other project's `unique`.
- **`learned`**: at least one concrete takeaway with a number or a specific failure in
  it. "Self-reported confidence is not evidence. Tesseract read TAX 1.69 as 19.169 at
  healthy confidence." A lesson that could be pasted into another project's write-up
  unchanged is too general.
- **`aiNote`** (optional, but every real write-up has one): where AI tooling fit and where
  it did not. Says what I decided, what I verified, and what I threw away. Assume the
  reader assumes AI was used; what they screen for is whether the author can account for
  it.

### 2.5 Commit messages and code comments

The repository is part of the site. A reader who clicks Source sees the log, so the log is
written in the same voice.

- **Commits**: `type(scope): what changed, in a lower-case sentence`. The sentence
  describes the visible result, not the mechanics. `feat(covers): project screenshots
  follow the site theme` · `fix(site): drop the reply-time promise from the home and
  contact pages` · `perf(ci): overlap the typecheck and the build`.
- **Comments explain why, and they are allowed to be paragraphs.** The reasoning for a
  local decision lives next to the code it governs, not here. This file points at the
  comment; it does not duplicate it. When a comment says "deliberately" or "on purpose",
  it is marking something that looks like a mistake and is not. Do not "fix" those
  without reading the comment.
- **Plans are decision records**, kept in `docs/plans/` with the date in the filename:
  decision, rejected options, invariants, scope ledger, verification contract, result.
  They are public and are written knowing that.

---

## 3. Visual language

Every token lives in `src/styles/global.css`. Components reference semantic names only
(`bg-surface`, `text-ink`, `border-border`), never a hex. A redesign is one file.

### 3.1 Ground and ink

| Token | Light | Dark | Role |
|---|---|---|---|
| `--bg` | `#f4f5f7` | `#16181c` | Page ground. Grey, never white or black, so cards can lift above it. |
| `--surface` | `#ffffff` | `#1d2025` | Cards, tiles, code, the mode hint. |
| `--surface-raised` | `#eceef1` | `#24282e` | Stack chips, cover placeholders, hover fills. |
| `--border` | `#dcdfe4` | `#2e333a` | Every hairline. |
| `--border-strong` | `#7d8590` | `#5f6873` | Hover borders, link underlines, bullets. Must clear 3:1 on `--bg`. |
| `--ink` | `#16191d` | `#ffffff` | Body text. Black only in light, white only in dark; no tinted text. |
| `--ink-muted` | `#4a5058` | `#b4bcc6` | Secondary copy, blurbs, captions. |
| `--ink-faint` | `#5c636c` | `#98a1ac` | Meta: dates, eyebrows, labels. Still passes 4.5:1. |

### 3.2 Accent and the ramp

The ramp is ten steps from lime to Yale blue, exposed as `bg-meadow-lime` …
`text-meadow-yale`. It paints highlights only.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--accent` | `#1a759f` (cerulean) | `#b5e48c` (light green) | Links, the eyebrow rule, focus ring, primary button. |
| `--accent-hover` | `#1e6091` | `#d9ed92` | Hover state of the above. |
| `--accent-ink` | `#ffffff` | `#141619` | Text on an accent fill. |
| `--accent-wash` | `#dcecf5` | `#2a3320` | Selection, the Takeaway box, the What I learned box, the Playable pill. |
| `--tab-active` | `#b5e48c` | `#b5e48c` | The active nav tab. Same in both themes because the bar is. |
| `--ok` / `--warn` / `--danger` | `#2f7a55` / `#7a6410` / `#a32f2f` | `#76c893` / `#d9ed92` / `#ff9d9d` | Status pills at 15% fill, error text. Kept inside the palette where the hue allows. |

**The ramp flips at step 8.** Steps 1 to 7 (lime through cerulean) carry black text;
steps 8 to 10 (cerulean through Yale) need white. Never white on meadow 1 to 7, never
black on meadow 8 to 10.

**The nav bar is near-black in both themes** (`--nav: #1b1f24` light, `#101215` dark).
The header layers `white/10` borders and hovers on it that only resolve against a dark
bar. It is painted at 90 to 95% over a blur; keep that opacity high or the muted label's
real contrast drifts below what the gate reports.

**The gradient headline** (`.text-gradient`) runs light-green → mist → bondi in dark and
cerulean → teal → Yale in light. It is used once per page at most, on the About headline
today. It is not a body style.

**Generated cover art** for a project with no screenshot is a hash-seeded oklch gradient
clamped into the palette's hue range (140 to 260) at low chroma, so a grid of them reads
as muted art, never as neon tiles. Cards only. A project page with no cover gets no band
at all; a full-width gradient was wallpaper.

### 3.3 Type

| Role | Face | Weights | Where |
|---|---|---|---|
| Display | **Bricolage Grotesque** | 600, 700, 800 | `h1`, `h2`, `.font-display`: the name, page titles, card titles, metric values. Letter-spacing `-0.02em`. |
| Body | **IBM Plex Sans** | 400, 500, 600, 700 | Everything else. |
| Mono | **IBM Plex Mono** | 400, 700 | Code, and the loops list on the home page. |

Why Plex: the site is barcodes, thermal printers, carrier invoices, and a warehouse floor
plan, so the body face should read as the manual for a machine, not a pitch deck. Inter
was replaced on 2026-09-01 because it is the default face of the era and makes a page
read as a template before a word is read. Bricolage stayed because it is uncommon and is
the one place the site shows personality. Mono moved to Plex at the same time so prose
and code come from one superfamily.

Fonts load through Astro's font API from Fontsource, subset to latin, with real
fallback stacks. The two OG-card faces are vendored in `src/fonts/` so the build never
fetches a font over the network.

Sizes are Tailwind's scale used directly. The recurring ones: hero name `text-5xl` →
`text-8xl` at `lg` with `leading-[0.95]`; page `h1` `text-4xl` → `text-6xl`; card title
`text-lg` to `text-2xl`; body `text-[0.975rem]` in tiles and `prose-lg` in write-ups;
meta `text-xs` uppercase with `tracking-[0.12em]` to `[0.18em]`.

### 3.4 Measure, shape, and depth

| Token or class | Value | Use |
|---|---|---|
| `--container-reading` | `46rem` | Every paragraph, the write-up body, the contract tiles. |
| `--container-wide` | `72rem` | Page shells, headers, grids, the flagship card. |
| `.tile` | radius `1.25rem`, 1px border, `--surface`, lift 2px + cast shadow + a top-edge accent line on hover | The one card surface. Flagship, project cards, metric tiles, contract tiles, subsystem cards. |
| `.btn` | radius `0.75rem`, padding `0.7rem 1.15rem`, weight 600 | `.btn-primary` is accent fill; `.btn-ghost` is a bordered transparent. Presses down 1px. |
| `rounded-xl` | Figures, demo frames, the AI aside, metric tiles inside the flagship | Everything rectangular that is not a tile. |
| `rounded-full` | Status pills, the Featured badge, the Playable pill | Anything that is a label. |
| `rounded-md` / `rounded-lg` | Stack chips, nav items, the mode switch | Small controls. |
| Shadow | None at rest. `0 18px 40px -24px var(--shadow-cast)` on tile hover; `shadow-xl` on the project-page cover only. | Depth is a hover reward, not a resting state. |

### 3.5 Motion

| Token | Value | Use |
|---|---|---|
| `--dur-fast` | 120ms | Button press. |
| `--dur` | 200ms | Colour, border, and transform transitions. |
| `--dur-slow` | 600ms | Reveals, the nameplate word morph. |
| `--ease` | `cubic-bezier(0.4, 0, 0.2, 1)` | Everything that is not an entrance. |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | Entrances. |

Rules:

- **`.reveal`** is the only scroll effect: opacity plus a 12px rise. Two implementations,
  chosen once at boot. Where the browser supports `animation-timeline: view()` the
  animation is driven by scroll position off the compositor and no JavaScript runs on
  the scroll path. Otherwise an IntersectionObserver adds `.is-in` and transitions do the
  work, with a scroll-position sweep as a safety net. Content staying invisible is the
  one failure this effect is never allowed to have.
- **`.reveal-load`** is the above-the-fold case: a timed entrance with `--reveal-delay`
  set in the markup (60ms, 120ms, 180ms across the hero), never by script.
- **Choreography runs once, on load, under two seconds, in pure CSS on server-rendered
  markup**, and the static styles are the finished state. The loops list files itself in
  ~1.7s (`200ms + i × 90ms` to file, `1000ms + i × 140ms` to tick). With animations off,
  no JS, reduced motion, or print, the finished list simply renders.
- **Reduced motion zeroes everything**: durations, iteration counts, scroll-timeline
  animations switched off outright, and the loops' delays set to 0 so nothing pops in
  one by one. This matters most for the demos and games.
- **No typewriter effects.** A typewriter is a template tell and delays the reader. The
  only cursor on the site is on the line that is genuinely unwritten.
- **Cross-page View Transitions** are on for every page except `bare` ones. Every script
  that binds to the DOM listens for `astro:page-load`, because a bundled module runs
  once and top-level setup goes dead after the first soft navigation. Every script that
  starts a loop cleans up on `astro:before-swap`.

### 3.6 Theme

Dark is the default and the server renders `data-theme="dark"`. A visitor's toggle wins
over the OS in both directions and is stored in `localStorage`. The theme is applied by an
inline, blocking script before first paint, and re-applied on `astro:after-swap` because
a View Transitions swap copies the incoming document's `<html>` attributes onto the live
one. Deferring this script is what causes the white flash on a dark reload.

Because the theme is an explicit toggle, `prefers-color-scheme` is the wrong question
everywhere except `<meta name="theme-color">`. Screenshots swap on `[data-theme]` via the
`dark:` variant, not on a `<picture>` media query.

### 3.7 The contrast gate

`scripts/check-contrast.mjs` parses the two token blocks in `global.css` and fails
`npm run check` if any pair drops below its threshold. Keep hex values in those two
blocks; the parser reads nothing else.

| Pair | Minimum |
|---|---|
| `ink`, `ink-muted`, `ink-faint` on `bg` and `surface` (and `ink` on `surface-raised`) | 4.5:1 |
| `accent` on `bg` and `surface`; `accent-ink` on `accent` | 4.5:1 |
| `nav-ink` and `nav-muted` on `nav`; `tab-active-ink` on `tab-active` | 4.5:1 |
| `ok` and `danger` on `surface` | 4.5:1 |
| `border-strong` on `bg` | 3:1 |

The gate scores opaque tokens. Anything painted at partial opacity over another colour
(the nav bar, status pills at 15%) resolves to something the gate did not check, which
is why those opacities are pinned in comments where they are used.

### 3.8 Social cards

Generated per page by `src/pages/og/[...route].ts`: graphite gradient ground, a 12px
lime stripe on the inline-start edge, title in Bricolage, description in Plex. The dark
theme's own palette, where the only colour is the accent stripe. Every published page,
subsystems included, gets one; a link with no card is a grey box in Slack.

---

## 4. Page grammar

Each page has a fixed shape. New pages pick one of these shapes or add a row to this table.

| Page | Shape | Chrome |
|---|---|---|
| `/` | Three sections: **nameplate** (name, discipline · location · timezone, the two-register sentence, three buttons, the loops on the right at `lg`), **the work** (one flagship tile with a real screenshot, then text rows, then one link to all projects), **contact** (one paragraph, one primary button, email and two profile links). One contact exit, not four. | Full |
| `/projects` | Top-level projects only, as cards. Subsystems are reached through their parent. | Full |
| `/projects/<slug>` | Fixed order, every time: breadcrumb or back link → status · date · role → `h1` → `blurb` → stack chips → Live / Source / External write-up buttons → metric tiles → cover (or nothing) → **The problem** and **What was unique** tiles → **Where AI fit in** aside → **Inside it** (subsystem cards, before the long read) → body → **What I learned** → previous / next within the same set. | Full |
| `/about` | Eyebrow, gradient headline, then a two-column grid: the path (dated stops with `id`s the loops deep-link to) and the principles beside it. | Full |
| `/resume` | Rendered from `site.ts`. The print stylesheet is the PDF; one page, US Letter, checked by `pdfinfo`. No phone, no street address, on the page or in the PDF. | Full, hidden in print |
| `/contact` | The form (Turnstile, Resend), with the email as the fallback. No reply-time promise. | Full |
| `/desk` | Help Desk mode: the whole portfolio re-served as a ticket queue. Own name, own mark, no vendor branding. One static page, panels switched by hash; without JS the panels stack and it reads as a document. Chrome is played straight, content is not. | Bare, own router |
| `/play/<slug>` | The demo, fullscreen. | Bare |
| `/404` | Short. | Full |

Recurring grammar inside pages:

- **Cards for things with a picture, rows for things without.** A grid of cards demands a
  thumbnail for every entry, and a generated gradient standing in for a screenshot is
  what makes a portfolio look padded. The home page shows one card and the rest as rows;
  `/projects` shows cards because every card there has a slot to fill.
- **The same fact once per page.** The nav bar has no wordmark because the home page
  opens with the name at full size. The flagship card's generated cover carries the
  headline metric, so the row below it skips that metric.
- **Facts about the system sit on the system, not on the person.** The four stats moved
  from the hero onto the MHLHUB card, where they are facts about software rather than a
  boast about an author.
- **Four short nav links, no hamburger.** A hamburger for four items is a tap the visitor
  should not have to make. Labels shorten on mobile (`Plain` / `Tech`) rather than hide.
- **Every heading level is real.** `h1` once, `h2` for the contract sections and the
  write-up's sections, `h3` for card titles. Eyebrows are `p` or a styled `h2` with the
  eyebrow class, never a fake heading.

---

## 5. Content model

### 5.1 One source of truth for facts

`src/lib/site.ts` holds anything that appears on more than one page: name, title, role,
employer, location, contact, links, nav, the four stats and their as-of date, résumé
data, skills, principles. Components never hard-code these. When a fact changes (a job,
a number, a link going live), it changes in one place, and the comments on each field say
what depends on it.

`src/lib/loops.ts` holds the hero's five loops and the two-register nameplate sentence.
Every line there is a fact that already appears on `/about` or a write-up. Nothing on the
home page is true only on the home page.

### 5.2 Projects

Frontmatter is enforced by the schema in `src/content.config.ts`; every field has a
comment there saying what it is for. The parts that shape the site:

- **`featured`** orders listings (higher first, then date). Current bands: MHLHUB 100,
  its subsystems 90 / 80 / 65 / 60 / 0, agent fleet 70, second brain 50, receipt splitter
  40, ERP test automation 30, Galaxy Defense 25, this site 10. A new project picks a slot
  in that order; the flagship on the home page is whatever is highest. Subsystem ranks
  share the number line with top-level ones but never the same listing, so a tie between
  the two is harmless — a collision is only confusing to read here.
- **`parent`** makes a project a subsystem: full write-up, own URL, own social card, but
  never in a top-level listing. It is reached through its parent's **Inside it** section.
  The file lives at `<parent>/<slug>/index.mdx` so the id, the URL, and the listing all
  say the same thing. Five sibling cards describing one codebase read as "this person has
  had one job"; one system with named parts reads as a system.
- **`status`** is `live`, `wip`, or `archived`, and the pill colour follows it. Archived is
  not a lesser state; Galaxy Defense and the SDET work are archived and shown.
- **`draft`** is visible in `astro dev` and excluded from listings *and routes* in the
  build, through the one query every surface uses. A draft hidden from the index but live
  at its URL would still be indexed.
- **`metrics`** are outcome and scale only. See §1.
- **`links.source`** is omitted for private work; the UI renders no button. An empty
  `links:` key parses as null and fails the schema, so omit the key entirely.

### 5.3 Moved URLs never die

The three ERP subsystems were top-level projects once. `astro.config.mjs` carries a 301
from each old path. Anything already linking to an old URL, a sent résumé, a search
result, a message, must still land on the write-up. Moving a project means adding a
redirect in the same commit.

### 5.4 The `code/` tree

Thirteen sanitized excerpts from the ERP and the agent fleet. Readable excerpts, not
installable packages; each folder has its own README saying what problem it solves and
which sharp edges it encodes. Identifiers, fixtures, endpoints, and customer data were
replaced, and the tree was copied out clean rather than pruned from a private repo,
because git history keeps everything ever committed. It is the third-party evidence the
GitHub link points at, now that the profile is more than two repos.

---

## 6. Demos, media, and screenshots

### 6.1 Demo lanes

Two lanes, chosen in frontmatter, neither costing a reader anything until they click.

- **`island`**: `src/demos/<name>/index.ts` exporting `mount(el) => cleanup`. Framework-free
  by contract; `.ts`, never `.tsx` (the React Fast Refresh preamble is missing for a
  dynamic import and the demo dies in dev). Mount is cheap; expensive work (a loop,
  audio, WASM) starts only after an explicit click; `prefers-reduced-motion` is honoured;
  the cleanup stops every timer it started. Galaxy Defense is the reference.
- **`iframe`**: a prebuilt export under `public/demos/<slug>/`, injected on click into a
  sandboxed frame (`allow-scripts allow-same-origin allow-pointer-lock allow-popups`) so
  a 40 MB bundle never enters the site's build graph. Camera is opt-in per demo, never per
  lane. Cloudflare caps a single static asset at 25 MiB. The receipt splitter is the
  reference.

Adding a game is a frontmatter change, not an architecture change. The seam exists so the
second game is as cheap as the first.

### 6.2 Screenshots

A screenshot is the one thing on the page that cannot follow the theme, so:

- **Ship a light and a dark capture** (`cover` and `coverDark`, `src` and `srcDark`)
  when the product has a dark theme. CSS picks one on `[data-theme]`; only the visible one
  is fetched because both are lazy. A product with no dark theme, or theme-less art like
  a game canvas, ships one file and renders it in both.
- **Frame the two identically.** They swap in place; a different crop reads as the page
  jumping.
- **Redact in the browser before capture**, with a CSS blur on the leaf elements whose
  text matches the other legal entities, then screenshot. Blurring in the page survives
  re-capture and cannot miss an occurrence that scrolled; boxes drawn on a PNG can.
- **Never ship**: a customer name, a price, a vendor identifier, a storefront name that is
  not already public, or a page whose job is revenue or margin (the channel P&L page is
  off the site for that reason, not because of what happened to be on it that day).
- **`coverAlt` describes the picture as evidence**: what the screen is, what it shows,
  the numbers visible in it. It is the caption a screen reader gets and the description
  a reviewer skims.
- **Fix the product before using it as an exhibit.** A page that renders three of its
  seven rules twice is not a screenshot yet.

### 6.3 Video and code

Video is never committed: GitHub rejects files over 100 MB, Cloudflare caps assets at
25 MiB, and `.gitignore` blocks the extensions. `<Video>` renders a poster and injects
the player on click. Code samples use `<CodeFile>`, which reads the real file at build
time; a sample cannot drift from the code it describes, and if the file moves the build
fails instead of showing something that used to be true.

---

## 7. Engineering decisions

The reasoning for each lives as a comment next to the code. This table is the index.

| Decision | Why | Where the reasoning lives |
|---|---|---|
| Astro 7, static output, Tailwind 4, MDX, Cloudflare Workers | A content site that can also run games. Every page prerenders; only `/api/contact` runs in the Worker, so delivery is free and unlimited. | `astro.config.mjs`, README |
| No React runtime | A two-state toggle is fifteen lines of vanilla JS; shipping React for it defeats the stack. Demos are framework-free by contract. | `ThemeToggle.astro`, `Demo.astro` |
| `format: 'file'` and `trailingSlash: 'never'` | Astro's default emitted `/projects/index.html`, which cost every internal link a 307. Canonical URLs are computed from the served path, not the output filename. | `astro.config.mjs`, `Base.astro` |
| `prerenderEnvironment: 'node'` | workerd forbids runtime WASM, which breaks the Shiki highlighter and OG image generation. Prerendered pages never execute in the Worker anyway. | `astro.config.mjs` |
| `ProjectData` exported from the schema | Astro's inferred type resolved to `any` and silently removed type safety from every consumer. | `content.config.ts`, `content.ts` |
| One query for listings, one for routes | Draft exclusion has to gate route generation too, or a draft is live at its URL. Subsystems are hidden from listings, not from the site. | `content.ts` |
| Contrast gate in `npm run check` | Colour is the easiest thing to get quietly wrong; a nudged token drifts and nobody notices until someone cannot read the site. | `scripts/check-contrast.mjs` |
| Theme set before first paint, re-set after swap | Deferred, it flashes white on a dark reload. Without the after-swap re-apply a light-mode reader is flipped to dark by their next click. | `Base.astro` |
| Scroll reveal on a CSS scroll timeline, observer fallback | A debounced scroll handler is still a scroll handler and is what drops frames on a mid-range phone. | `global.css`, `Base.astro` |
| Every DOM script binds on `astro:page-load` | View Transitions keep the JS context; a module runs once, so top-level setup dies after the first navigation. Demos also clean up on `astro:before-swap` or a game loop runs forever behind the reader. | `Header.astro`, `Demo.astro`, `Nameplate.astro` |
| `/desk` and `/play` are `bare` | The desk runs its own hash router; the player wants the whole viewport. Astro falls back to a full navigation for pages that opted out. | `Base.astro`, `desk.astro` |
| The résumé PDF is a print of the page | Two documents drift; a build artefact cannot. The script fails if the PDF exceeds one page or the text does not survive extraction. | `scripts/build-resume-pdf.sh`, `global.css` `@media print` |
| Push to `main` deploys | Public repos run Actions free (measured `billable.UBUNTU` 0 ms). Typecheck and build overlap; the deploy still refuses without a passing check. | `.github/workflows/deploy.yml`, README |
| A Mac deploy script still exists | A push can only ship `main` as pushed. The script owns `--build-only`, `--ref`, redeploys without a commit, and the case where Actions is down. It builds in Linux because this Mac's filesystem is case-insensitive and Cloudflare's is not. | `scripts/deploy-from-mac.sh`, README |
| `SITE_URL` is never set | The workers.dev fallback is what every shipped build has used. Setting it would silently change every canonical URL and the sitemap. `\|\|` not `??`, because CI passes an empty string. | `astro.config.mjs`, README |
| OG fonts vendored | The library fetched Noto Sans from a third party at build time and had already failed a deploy with `ECONNRESET`. | `og/[...route].ts` |
| Structured data names CYDEO only | GMU was coursework without a conferred degree, and `alumniOf` reads as a completion claim to the parsers that consume it. | `Base.astro` |
| Analytics off | Cloudflare Web Analytics is wired but commented out until a token is pasted. Cookie-less, no banner. | `Base.astro` |

---

## 8. Checklists

### 8.1 Adding a project

1. `src/content/projects/<slug>/index.mdx`, or `<parent>/<slug>/index.mdx` with
   `parent:` set if it is part of something already here.
2. Frontmatter: `title` in the house shape (§2.3), `blurb` ≤160 in Engineer register,
   `plainBlurb` ≤200 in business words, `role`, `status`, `stack` most-used first,
   `featured` in the current band order (§5.2), `date`.
3. The contract: `problem`, `unique`, `learned` (with a number or a specific failure),
   `aiNote` (what was decided, verified, thrown away).
4. `metrics`: outcome and scale only, values as strings, dated somewhere in the body if
   they will drift.
5. Body: a `<PlainOnly>` story and an `<EngOnly>` account, figures outside both. `## `
   headings, no `#`. `<Takeaway>` for at most one or two lessons worth interrupting for.
6. Cover: a real screenshot, redacted in-browser, light and dark if the product has both,
   identical framing, `coverAlt` written as evidence. Or no cover; never a placeholder
   image.
7. Links: `source` only if public; omit the key otherwise. `live` if it runs somewhere.
8. If the project has a demo, §8.2. If it moves or renames an existing URL, a redirect
   in the same commit.
9. Check: `npm run check` clean, `npm run build` clean, the page read once in each
   register and each theme, at 375px and 1280px. The social card at `/og/projects/<slug>.png`.
10. If any fact on it also appears in `site.ts` or the résumé, change those too,
    regenerate the PDF, commit the PDF with the change.

### 8.2 Adding a demo or game

- Island: `src/demos/<name>/index.ts`, `mount(el) => cleanup`, start gate before any
  expensive work, reduced motion honoured, every timer stopped in cleanup. `.ts` only.
- Iframe: export under `public/demos/<slug>/`, under 25 MiB per asset, `camera: true`
  only if the demo genuinely needs it.
- Frontmatter `demo:` block; `label` in the imperative (*Play Galaxy Defense*).
- Confirm the fullscreen route at `/play/<slug>` mounts (it has no View Transitions
  router, so the bind path is different).

### 8.3 Changing the design

1. Change the token, not the component. If a component needs a colour that has no
   token, the design system is missing a token, so add one to both theme blocks with a
   comment saying what it is for.
2. Run `npm run check:contrast`. If it fails, the colour changes, not the threshold.
3. Look at both themes and both registers. Look at the nav bar in light mode
   specifically; its contrast is the most fragile number on the site.
4. Look with reduced motion on. Look with JavaScript off (`curl` the built HTML): the
   plain register and every finished animation state must be present as text.
5. If it changes a rule in this file, update the rule and add a line to §9.

### 8.4 Adding a feature

- If it shows on more than one page, its data goes in `site.ts`.
- If it has a design decision in it, a change record in `docs/plans/` with the date, the
  rejected options, and the verification contract. It is public; write it that way.
- If it binds to the DOM: `astro:page-load` to bind, `astro:before-swap` to clean up,
  and it must not break on the `bare` pages.
- If it adds copy: both registers, plain as the fallback, no slogans, numbers dated.
- If it stores anything in the browser: `try`/`catch` around every read and write, and
  the page must be correct with nothing stored.
- If it costs bytes on a write-up page: it loads on click or it does not ship.

### 8.5 Changing a fact

`site.ts` first. If it is one of the four stats, update `statsAsOf`. If it is on the
résumé, `npm run build && npm run resume:pdf` and commit the PDF. If it is the employer,
the nameplate sentence in `loops.ts` and the structured data in `Base.astro` read from
`site.ts`, so check they still say something true.

---

## 9. Decision log

Dated, append-only. One line per decision that changed a rule or a shape. The reasoning
for each is in the commit, the plan, or the code comment named.

| Date | Decision |
|---|---|
| 2026-08-30 | Scaffold: Astro 7, Tailwind 4, Cloudflare Workers, MDX, the two-lane demo seam, the required contract fields. |
| 2026-08-30 | Meadow Green palette on a graphite ground, with a contrast gate that can fail the build. |
| 2026-08-30 | Recruiter-focused redesign: real work, real numbers, honest AI framing. First-person identity and an About page in Dylan's own register. |
| 2026-08-30 | Two registers (Plain English / Engineer) as a header switch; both ship in the HTML; plain is the default. |
| 2026-08-30 | The packing-slip A/B skin grew into Help Desk mode at `/desk`. Shared `?skin=slip` links redirect there. |
| 2026-08-30 | Professional tone pass on the desk; the marquee ticker and the stack marquee dropped; named ERPs generalised. |
| 2026-08-31 | The desk queue as cards: a front door that reads in five seconds. |
| 2026-08-31 | Galaxy Defense ported from block code to canvas and made playable as the reference island demo. |
| 2026-08-31 | Deploys moved to an on-demand Mac script to stop paying per push. |
| 2026-09-01 | Home page becomes a nameplate: three sections, one flagship card plus rows, one contact exit. Stats move onto the MHLHUB card. The three ERP subsystems nest under MHLHUB with redirects. About becomes the credential narrative. First redacted screenshots. ([plan](docs/plans/2026-08-31-portfolio-nameplate-and-collapse.md)) |
| 2026-09-01 | The repository went public. GitHub link, Source buttons, and the `code/` excerpt tree turned on. Push to `main` deploys again. |
| 2026-09-01 | Body and code move to IBM Plex; Bricolage stays for display. |
| 2026-09-01 | The résumé becomes a one-page ATS-shaped page with a generated PDF; the title everywhere is Software Engineer; the degree line is coursework. |
| 2026-09-01 | Audit follow-ups: outcome metrics only, a hire-me path, a one-time mode hint under the header, the fullscreen play page fixed. The reply-time promise dropped. |
| 2026-09-02 | The loops list beside the name, and the nameplate sentence that rewrites itself on the mode switch. ([plan](docs/plans/2026-09-02-portfolio-hero-loops-and-register.md)) |
| 2026-09-02 | Vendor and storefront names blurred in the browser before capture on every screenshot. |
| 2026-09-03 | Receipt splitter v2 embedded through the iframe lane; the page rewritten around "refusing is a feature". |
| 2026-09-03 | Screenshots follow the site theme: paired light and dark captures swapped on `[data-theme]`. |
| 2026-09-03 | CI overlaps the typecheck and the build; the wrangler-action probe dropped. |
| 2026-09-03 | The second-brain vault written up. |
| 2026-09-03 | This file. |
| 2026-09-03 | Printing gets its own subsystem page (`featured: 65`). The layout kit, the EPL converter and the device agent were one row each in the toolbox list; the toolbox stays the complete inventory of `code/` and links across. |

---

## 10. Parked and open

Things decided *not yet*, so they are not re-decided by accident. Move a line to §9 when
it ships or is dropped for good.

- **The ship with no loop.** A single pixel-art ship from Galaxy Defense crosses the hero
  once on load; clicking it opens the game. Approved in principle 2026-09-02, not built.
  About a quarter session.
- **A short-form `notes` / devlog collection.** The extension point is marked in
  `content.config.ts`. Same shape minus the contract fields. Waiting on content; an empty
  collection is only a build warning.
- **Cloudflare Web Analytics.** Wired and commented out in `Base.astro`. Needs a token
  pasted; nothing else.
- **A screenshot of the automation page.** Clean of data, but it renders three of its
  seven rules twice. Fix the product first.
- **A real domain.** `SITE_URL` stays unset until one is attached, and attaching one
  changes every canonical URL at once, so it is a deliberate single change, not a drift.
- **The channel P&L page** is not parked; it is off the site for good. Listed here so
  nobody re-asks.

Open questions, no decision yet:

- Whether `/desk` should keep its own visual dialect or converge on the tokens above. It
  is a parody with its own chrome on purpose; the question is how far that licence goes.
- Whether the write-up body should have a hard length ceiling. The longest is around
  1,300 words in Engineer mode; the subsystem split was the answer last time.

---

## 11. Public-repo rules

Everything tracked is public, and this file is an exhibit as much as the site is. Rules
for what goes in the repo, in the plans, and in this document:

- **Only facts already on the site.** A number that is not published on a page does not
  appear in a doc, a plan, a comment, or a commit message. Business figures beyond the
  four stats and the per-project metrics stay out.
- **No customer names, vendor identifiers, prices, or storefront names** that are not
  already public. Screenshots are redacted before they are committed, and git history
  keeps everything ever committed, so a redaction after the fact is not one.
- **No phone number and no street address**, anywhere, including the PDF.
- **Nothing from the private vault** except the shape of a line. The loops borrow its
  grammar; every fact in them is already on `/about`.
- **Private capture and access paths are described, not documented.** "Authenticated
  through the internal testing path documented in the MHLHUB repo" is the whole sentence.
- **Untracked by design**: `.playwright-mcp/` (capture scratch), `worker-configuration.d.ts`
  (generated), `.dev.vars` (secrets), `dist/`, `.astro/`, large demo bundles, and video.
  A new kind of scratch output gets a `.gitignore` line before the first capture, not
  after.
- **Plans are public decision records.** They already name rejected options and
  invariants; they must not name what a rejected option would have exposed.

How this file shows up on GitHub: a root-level Markdown file appears in the file list and
renders when clicked, with GitHub's outline button listing the headings above. Only
`README.md` renders on the repository's landing page, so the README links here from its
Design section. It is indexed by GitHub search and reachable by URL, which is the point.

---

## 12. Version history of this file

| Date | Change |
|---|---|
| 2026-09-03 | First version. Written from the code, the comments, the two plans, and the commit log as of `bc12832`. |
