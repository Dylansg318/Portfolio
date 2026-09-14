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
   the ERP's commit log, the `code/` tree, or a reference check. Numbers are measured, dated
   (`statsAsOf` in `src/lib/site.ts`), and are outcome or scale figures, never size
   figures. Lines of code, table counts, and endpoint counts were removed on purpose:
   they say how big a thing is, not how well it works, and a reader who knows that
   discounts the numbers next to them.
2. **Two audiences, one page.** The site has a Plain English register and an Engineer
   register, switched in the header. Both ship in the HTML. Plain is the default and is
   what crawlers, RSS readers, and no-JS visitors get. Same facts, two vocabularies.
3. **Two columns, one accent.** Every page is a white prose column beside a dark
   response column: what a thing is in plain words on the left, its exact shape — a
   request, its real answer, an excerpt — on the right, both on screen at once. One
   blue-violet is spent on links, the active endpoint and the filled button; method
   badges carry their own semantic colour; nothing else on the light side is tinted.
   Colour reads as emphasis only when most of the page is not coloured.
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
| `title` | Sentence case. Says what the thing is or does, often as a clause after a comma or a claim with a twist. Never a product name alone unless it is a game. | *The internal ERP that runs a dental supply company* · *Repricing every minute without a race to the bottom* · *Split the check from a photo* |
| `blurb` | One sentence, ≤160 characters, Engineer register. Doubles as the meta description. | *One system for orders, inventory, repricing, shipping, service and books across six sales channels, built from scratch, about 500 orders a day.* |
| `plainBlurb` | ≤200 characters, business words only. Falls back to `blurb` when absent. | *The company sold on six websites using six different tools that never agreed. I built the one system that runs it all, about 500 orders a day.* |
| `role` | Lower case, middle-dot separated facts. | `sole engineer · 13 daily users` · `solo · side project` · `contributor · team of 10` |
| Metric `label` | Lower case, spaced with slashes for rates. Value is a string so it can carry `~`, `K`, `+`, `$`. | `{ label: orders / day, value: "~520" }` |
| Crumb | The endpoint a row is, above its heading: a method badge and a mono path. Never a decorative eyebrow — the line encodes something true about the row. | `GET /api/dylan` · `GET /api/work/{id}` · `POST /api/contact` |
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

Every token lives in the one `:root` block of `src/styles/global.css`. Components
reference semantic names only (`bg-surface`, `text-ink`, `border-border`, `text-code-dim`),
never a hex. A redesign is one file — this section was rewritten on 2026-09-14 when the
site moved from a graphite-and-green product look into an **API reference**.

### 3.1 The two columns

The page is a **white prose column** beside a **continuous dark response column**. The
prose says what a thing is in plain words; the response beside it is the exact shape —
a live request and its real answer, an excerpt of real code, the write-up's own map.
Rows abut, so the dark column runs unbroken from the header to the footer. Below 1024px
the response stacks under its prose; from 1024px the endpoint rail (14rem) sits on the
left, the prose takes the middle, and the response column is 30–34rem on the right.

| Token | Value | Role |
|---|---|---|
| `--bg`, `--surface` | `#ffffff` | The prose column. White, on purpose: a reference is read for minutes at a time. |
| `--surface-raised` | `#f6f8fa` | Quiet fills: chips, light code excerpts, hover rows, the reading-mode hint. |
| `--border` | `#e3e8ee` | Every hairline on the light side. |
| `--border-mid` | `#cfd7df` | Underlines and scrollbars — decorative, not a boundary, so it is not gated. |
| `--border-strong` | `#7f8b9b` | Bullets and real boundaries. Clears 3:1 on white. |
| `--ink` | `#0a2540` | Body text and headings. Navy, not black: it is the same hue family as the dark column. |
| `--ink-muted` | `#425466` | Secondary copy, the `.t` paragraph, job summaries. |
| `--ink-faint` | `#5b6b82` | Meta: crumbs, dates, captions, the mono labels. Still 4.5:1 on white and on the quiet fill. |
| `--code-bg` | `#0b0f19` | The response column itself. |
| `--code-surface` | `#131a2a` | A console or panel on it. |
| `--code-line` | `#263042` | Hairlines and input borders on the dark side. |
| `--code-ink` | `#d6deeb` | Code and JSON on the dark side. |
| `--code-dim` | `#7d8aa5` | Captions, punctuation, the status line, the frame note. |
| `--syn-key` / `--syn-str` / `--syn-num` | `#9ecbff` / `#a5d6a7` / `#f7c46c` | JSON keys, strings, numbers and literals; also the selected language tab, a 2xx status and a 4xx status. |

### 3.2 Accent and badges

| Token | Value | Role |
|---|---|---|
| `--accent` | `#5e56fb` | Links, the active rail entry's stripe, the filled button, Send, focus rings. A hair darker than the mock's `#635bff` so a link on the quiet fill clears 4.5:1. |
| `--accent-hover` | `#5249e6` | Hover state of the filled button. |
| `--accent-ink` | `#ffffff` | Text on an accent fill. |
| `--accent-wash` | `#eeedff` | Selection, the active rail entry, the active nav tab. |
| `--get` / `--get-bg` | `#0a6b3f` / `#e2f5ec` | The GET badge. Semantic, not the accent. |
| `--post` / `--post-bg` | `#4b43d6` / `#eeedff` | The POST badge. |
| `--ok` / `--warn` / `--danger` | `#0a6b3f` / `#8a5a00` / `#b42318` | Status text on the light side. |

**Method badges are the site's one decorative device**, and they decorate nothing: a
badge says which verb a row or a rail entry is. The old eyebrow style still exists for the
help desk's chrome and is not used on a reference page.

**Generated cover art is gone.** A project with no screenshot has no picture, on a card
or on its page. A hash-seeded gradient standing in for a screenshot is what made a
portfolio look padded.

### 3.3 Type

| Role | Face | Weights | Where |
|---|---|---|---|
| Text | **Source Sans 3** | 400, 600, 700 (+ italic) | Everything on the light side, headings included. Headings are the text face, heavier; there is no display face to pair. |
| Mono | **JetBrains Mono** | 400, 500, 600 | Paths, keys, the crumbs, dates and labels, the console, every code block. |

Why one text face: a reference does not pair a display face with its body. Source Sans
was drawn for interfaces and documentation and reads that way — open counters, a plain
italic, no personality to spend. JetBrains Mono is what most engineers already read code
in, which is the point of the response column. Bricolage Grotesque and IBM Plex left with
the old world on 2026-09-14.

Fonts load through Astro's font API from Fontsource, subset to latin, with real fallback
stacks. The two OG-card weights of Source Sans are vendored in `src/fonts/` so the build
never fetches a font over the network.

The body is 17px from 640px up (16px below), line-height 1.6. The scale: the home page's
`h1` `clamp(2.5rem, 5.5vw, 3.75rem)`; every other page's `h1.page` `clamp(1.875rem,
3.6vw, 2.5rem)`; row `h2` 1.75rem; item `h3` 1.1875rem; `.lead` 1.1875rem; body 1rem;
`.t` and list copy 0.9375rem; meta and crumbs 0.8125rem; console text 0.8125rem mono;
captions 0.6875rem uppercase with `0.1em` tracking.

### 3.4 Measure, shape, and depth

| Token or class | Value | Use |
|---|---|---|
| `--container-reading` | `44rem` | The prose column's maximum width. |
| `--container-wide` | `80rem` | The reading-mode hint's shell; nothing else is boxed — the grid is full-bleed. |
| `.ref` / `.rail` / `.ep` / `.ep-prose` / `.ep-code` | The grid, the endpoint rail, one row, its prose, its response | The page grammar in CSS. Every reference page is `.ref` → `.rail` + rows. |
| `.cx` | radius 8px, 1px `--code-line`, `--code-surface` | The try-it console. Bar (method, path, languages) → parameters → request → Send → response. |
| `.ep-code .panel` | same surface as `.cx` | Anything else on the dark side: an excerpt, the write-up's map, a static response. Scoped to the column — the help desk has a `.panel` of its own. |
| `.btn` | radius 6px, padding `0.6rem 1rem`, weight 600 | `.btn-primary` is the accent fill with a soft cast; `.btn-ghost` is a mid border. Presses down 1px. |
| `.item` / `.job` / `.stops li` / `.subs li` | hairline-separated rows | Lists inside a row. A thumbnail sits in a 13rem right column from 640px. |
| `.tile` | 1px `--border`, radius 6px, no lift | Kept for the help desk and the MDX asides. Not a reference-page device. |
| Shadow | None at rest anywhere on the light side; the filled button carries a soft accent cast. | Depth belongs to the dark column, which is a different surface, not a lifted one. |

### 3.5 Motion

| Token | Value | Use |
|---|---|---|
| `--dur-fast` | 120ms | Button press. |
| `--dur` | 240ms | Colour, border and background transitions. |
| `--dur-slow` | 600ms | The nameplate word morph; the help desk's reveals. |
| `--ease` / `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | Everything. |

Rules:

- **The reference pages render at rest.** Nothing on them waits for a scroll to become
  readable: every console shows its real response on load, every list is visible. The
  `.reveal` scroll effect survives only for the help desk and the demos.
- **The console streams.** A Send types the response in a line at a time (6–40ms per
  line, scaled to length), then the status line lands and, if the answer names a page,
  the page opens after 500ms. With reduced motion the whole answer appears at once and
  the page opens immediately.
- **The nameplate morphs.** On the reading-mode switch the one-sentence summary rewrites
  word by word (LCS diff; shared words stay put). It is the only text animation on the
  site and it shows the two registers being the same fact.
- **Reduced motion zeroes everything**: durations, iteration counts, scroll-timeline
  animations switched off outright. This matters most for the demos and games.
- **No typewriter effects on prose.** The console's stream is a response arriving, not
  copy being typed.
- **Cross-page View Transitions** are on for every page except `bare` ones. Every script
  that binds to the DOM listens for `astro:page-load`, because a bundled module runs
  once and top-level setup goes dead after the first soft navigation. Every script that
  starts an observer or a loop cleans up on `astro:before-swap`.

### 3.6 One theme

The site has one theme, on purpose. The light/dark split is between the two columns,
not between two modes of the page, so there is no theme toggle, no `data-theme`, no
`prefers-color-scheme` branch, and no dark twin of any screenshot. `<meta
name="theme-color">` is white. The games and the help desk paint their own worlds on
top of the tokens.

What survives from the old two-theme machinery: the **reading mode** (`data-mode` on
`<html>`, `plain` or `eng`) is still set by an inline blocking script before first
paint and re-applied on `astro:after-swap`, because a View Transitions swap copies the
incoming document's `<html>` attributes onto the live one.

### 3.7 The contrast gate

`scripts/check-contrast.mjs` parses the `:root` block in `global.css` and fails
`npm run check` if any pair drops below its threshold. Keep hex values in that block;
the parser reads nothing else.

| Pair | Minimum |
|---|---|
| `ink`, `ink-muted`, `ink-faint` on `bg` and `surface-raised` | 4.5:1 |
| `accent` on `bg` and `surface-raised`; `accent-ink` on `accent` | 4.5:1 |
| `nav-ink` and `nav-muted` on `nav`; `tab-active-ink` on `tab-active` | 4.5:1 |
| `ok`, `warn`, `danger` on `bg` | 4.5:1 |
| `get` on `get-bg`; `post` on `post-bg` | 4.5:1 |
| `code-ink` and `code-dim` on `code-bg` and `code-surface`; `syn-*` on `code-surface`; `code-bg` on `syn-key` (the selected tab) | 4.5:1 |
| `border-strong` on `bg` | 3:1 |
| `code-line` on `code-surface` | 1.2:1 (visible, not text) |

### 3.8 Social cards

Generated per page by `src/pages/og/[...route].ts`: a white-to-quiet gradient ground, a
12px accent stripe on the inline-start edge, title in Source Sans Bold, description in
Source Sans Regular — the prose column's own palette, so the card is the page. Every
published page, subsystems included, gets one; a link with no card is a grey box in
Slack. A demo's `/play` page uses its composed `shareCard` instead (§6).

---

## 4. Page grammar

Every reference page is the same object: the **endpoint rail** on the left (the site map
in the API's own terms — six endpoints plus `GET /api`), then **rows**. A row is one
endpoint: prose on the left, a try-it console on the right rendered with that endpoint's
real response, and the prose never says a fact the console does not carry. New pages pick
one of these shapes or add a row to this table.

| Page | Rows | Chrome |
|---|---|---|
| `/` | `GET /api/dylan` (the name, the two-register nameplate sentence, the facts list, See the work / Resume / About me) → `GET /api/work` (one at work, one for myself, one on the side, with an excerpt of a real hook beside the console) → `GET /api/experience` (the three jobs) → `GET /api/away-from-work` (the first program, still playable; the help desk) → `POST /api/contact` (what I'm looking for; the console sends). Person first, then the work, then the path, then the rest of life, then how to reach me. | Full |
| `/projects` | `GET /api/work` (h1, category tabs bound to `?category=` and to the console's parameter, every top-level project as an item row with its thumbnail where one exists) → `GET /api/work/internal-erp?fields=subsystems` (Inside the ERP). | Full |
| `/projects/<slug>` | Fixed order, every time: back link or breadcrumb → `GET /api/work/{id}` (status · date · role, `h1`, the two-register blurb, stack chips, Play / Source / External write-up, the metrics list, the cover) → `?fields=problem,unique,ai` (**The problem**, **What was unique**, **Where AI fit in**) → `?fields=subsystems` (**Inside it**, when there are parts) → the write-up body, with its own section map in the dark column → `?fields=learned` (**What I learned**, previous / next within the same set). | Full |
| `/about` | `GET /api/experience` (the short version, the stops, the jobs bound to `?since=`, education) → `GET /api/work/internal-erp?fields=problem,unique` (What it ran on before, Who I work with) → `GET /api/dylan?fields=principles,open_to,looking_for` (How I work, Right now, Off the clock) → `GET /api/resume?fields=skills,certifications` (the toolkit, the facts, Get in touch). | Full |
| `/resume` | One row: `GET /api/resume`. Rendered from `site.ts`; the print stylesheet hides the rail and the column and is the PDF — one page, US Letter, checked by `pdfinfo`. No phone, no street address, on the page or in the PDF. | Full, hidden in print |
| `/contact` | `POST /api/contact` (Say hello, the email, what to include; the console validates for real and hands the message to the mail app) → `GET /api/work/internal-erp?fields=problem,metrics` (the problem I solve, for the owner or office manager who is not hiring an engineer). | Full |
| `/desk` | Help Desk mode: the whole portfolio re-served as a ticket queue. Own name, own mark, own light palette, no vendor branding. One static page, panels switched by hash; without JS the panels stack and it reads as a document. Chrome is played straight, content is not. | Bare, own router |
| `/play/<slug>` | **The demo on its own, as a page you can send someone.** The game is the first and only thing on the first screen; the credit, the write-up link (*How it works*), the rest of the work and a Share button sit in a footer under it. Indexable, in the sitemap, and its social card is the project's real cover art. | Bare |
| `/404` | One row: the requested path as a crumb, a short sentence, and the API's own `404 Not Found` body in the dark column. | Full |
| `/api`, `/api/*` | Not pages: JSON, from the Worker. See §5.5. | — |

Recurring grammar inside pages:

- **The console is the Engineer register.** The prose column speaks whichever register
  the switch says; the response beside it is always the exact shape. A reader never has
  to flip a switch to see the other register — the site's oldest rule, now structural.
- **A parameter is one control in three places.** The tabs on `/projects`, the
  `?category=` in the address and the console's `category` select are one state; the
  same for `?since=` on `/about`. Any of them changing moves the other two.
- **`fields` shows up when a row is about a subset.** The full record's console has no
  `fields` box; the contract row's console has `fields=problem,unique,ai` filled in. The
  parameter is real everywhere and visible only where it is doing something.
- **Rows for everything; a thumbnail only where there is a real one.** An item is a
  hairline-separated row; a project with a screenshot gets it in a 13rem column. There
  are no cards and no generated art.
- **The same fact once per page.** The header has no wordmark because the home page
  opens with the name. The rail lists the endpoints once; the crumb above each row names
  the one the row is.
- **Four short nav links, no hamburger.** A hamburger for four items is a tap the visitor
  should not have to make. Labels shorten on a phone (`Plain` / `Tech`) rather than hide.
- **Every heading level is real.** `h1` once, `h2` per row and per contract section,
  `h3` for items. The crumb is a `p`; nothing is a fake heading.

---

## 5. Content model

### 5.1 One source of truth for facts

`src/lib/site.ts` holds anything that appears on more than one page: name, title, role,
employer, location, contact, links, nav, the four stats and their as-of date, résumé
data, skills, principles, the path here (the stops on `/about`), the away-from-work line
and the looking-for line. Components never hard-code these, and neither does the API:
`src/lib/api.ts` builds every `/api/*` record from `site.ts` and the content collection,
and the pages render each console's response by calling the same functions. When a fact
changes it changes in one place and the page, the console and the endpoint all follow.

`src/lib/loops.ts` holds the two-register nameplate sentence and the tokenizer the word
morph runs on. Nothing on the home page is true only on the home page.

### 5.2 Projects

Frontmatter is enforced by the schema in `src/content.config.ts`; every field has a
comment there saying what it is for. The parts that shape the site:

- **`featured`** orders listings (higher first, then date). Current bands: the ERP 100,
  its subsystems 90 / 80 / 75 / 65 / 60 / 0, agent fleet 70, second brain 50, receipt splitter
  40, ERP test automation 30, Galaxy Defense 25, this site 10. A new project picks a slot
  in that order; the home page's three are curated by hand for breadth (one at work, one
  for myself, one on the side), not taken from the top of this order. Subsystem ranks
  share the number line with top-level ones but never the same listing, so a tie between
  the two is harmless — a collision is only confusing to read here.
- **`parent`** makes a project a subsystem: full write-up, own URL, own social card, but
  never in a top-level listing. It is reached through its parent's **Inside it** section.
  The file lives at `<parent>/<slug>/index.mdx` so the id, the URL, and the listing all
  say the same thing. Five sibling cards describing one codebase read as "this person has
  had one job"; one system with named parts reads as a system.
- **`status`** is `live`, `wip`, or `archived`, shown as a word in the status line.
  Archived is not a lesser state; Galaxy Defense and the SDET work are archived and shown.
- **`draft`** is visible in `astro dev` and excluded from listings *and routes* in the
  build, through the one query every surface uses. A draft hidden from the index but live
  at its URL would still be indexed.
- **`metrics`** are outcome and scale only. See §1.
- **`links.source`** is omitted for private work; the UI renders no button. An empty
  `links:` key parses as null and fails the schema, so omit the key entirely.
- **`cover`** is one capture, in the product's own light theme. The site has one theme
  (§3.6), so the `coverDark` twin and the `srcDark` figure prop were removed on
  2026-09-14 along with their files.

### 5.3 Moved URLs never die

The three ERP subsystems were top-level projects once, and the ERP itself was renamed on
2026-09-14 — its product name meant nothing to a reader and was one more identifying
detail in a public repository, so it is now "the internal ERP" at
`/projects/internal-erp`. `astro.config.mjs` carries a 301 from every old path: the old
slug, each of its six subsystems (listed by hand — Astro only accepts a dynamic redirect
whose destination is itself a route pattern), and the three older aliases. Anything
already linking to an old URL, a sent résumé, a search result, a message, must still land
on the write-up. Moving or renaming a project means adding a redirect in the same commit.
The old name stays in git history; that is not a leak the current tree can fix.

### 5.4 The `code/` tree

Thirteen sanitized excerpts from the ERP and the agent fleet. Readable excerpts, not
installable packages; each folder has its own README saying what problem it solves and
which sharp edges it encodes. Identifiers, fixtures, endpoints, and customer data were
replaced, and the tree was copied out clean rather than pruned from a private repo,
because git history keeps everything ever committed. It is the third-party evidence the
GitHub link points at, now that the profile is more than two repos.

---

### 5.5 The API is the same facts

`/api` is a read-only JSON API over the site's own facts, served by the Worker at
request time so a query string means something: `GET /api/dylan?view=engineer`,
`GET /api/work?category=game`, `GET /api/work/{id}?fields=problem,learned`,
`GET /api/experience?since=2022`, `GET /api/resume?format=pdf`,
`GET /api/away-from-work?playable=true`, and one write, `POST /api/contact`. `GET /api`
is the index and describes itself from `src/lib/endpoints.ts` — the same list every
console on the site is rendered from.

Rules the endpoints keep:

- **Every record carries `page`**, the absolute address of the page it describes. A
  console's Send opens it when it is not the page the reader is on; a same-site `page` is
  followed relative, so a preview or a local build stays on its own host.
- **`?fields=a,b` is a sparse fieldset** on every GET. An unknown field is a 400 that
  lists the real ones; `page` always comes back.
- **Errors are bodies, not silence.** A bad `category` is 400 with the allowed values; an
  unknown id is 404 with a hint; the wrong method is 405 with `Allow`.
- **A 200 is cacheable for five minutes; nothing else is.** `access-control-allow-origin: *`
  on everything — it is public and read-only.
- **`POST /api/contact` never claims success it did not have.** Until `RESEND_API_KEY` and
  `CONTACT_TO` are set it validates the message and answers 503 with a `mailto:` carrying
  it, which the console opens. Set the secrets and the same console delivers.
- **Only facts already on the site.** The API reads `site.ts` and the content collection
  and nothing else. Adding a fact to the site adds it to the API; there is no second list.

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

A screenshot sits on the white prose column, so:

- **Ship one capture, in the product's light theme** (`cover`, or `src` on a `<Figure>`).
  The site has one theme (§3.6); the paired dark twins were removed on 2026-09-14. Art
  that has no theme — a game canvas — ships as it is.
- **Frame it for a 44rem column.** It renders at the prose measure on the project page
  and in a 13rem column on a list; a capture that only reads at full width reads nowhere.
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
| Astro 7, static output, Tailwind 4, MDX, Cloudflare Workers | A content site that can also run games. Every page prerenders; only `/api/*` runs in the Worker, so page delivery is free and unlimited and a query string still means something. | `astro.config.mjs`, README |
| No React runtime | The console is a few hundred lines of vanilla TypeScript; the reading-mode switch is fifteen. Shipping React for either defeats the stack. Demos are framework-free by contract. | `scripts/console.ts`, `Header.astro`, `Demo.astro` |
| The API and the pages share one set of functions | `src/lib/api.ts` builds a record; the Worker route returns it and the page inlines it as the console's at-rest response. The body on the page IS the body the endpoint returns, so "200 OK" on the page is true before anyone clicks. | `lib/api.ts`, `components/ref/Console.astro`, `pages/api/*` |
| The console renders complete on the server | Request in cURL, real response, coloured — all in the HTML. The script only makes it move (parameters, languages, Send). A reader with JavaScript off still sees the endpoint, the request and the answer. | `components/ref/Console.astro`, `lib/console-render.ts` |
| One endpoint list feeds three things | `endpoints.ts` is what `GET /api` returns, what every console is rendered from, and what the routes implement. Adding an endpoint is one entry plus one route; a console for it is one component call. | `lib/endpoints.ts` |
| Same-site `page` links are followed relative | Records carry absolute URLs on the canonical host so a pasted record still points home; the console rewrites a same-site one to the current origin, so a preview or a local `wrangler dev` never jumps to production. | `scripts/console.ts`, `Console.astro` |
| Content collections at request time | The Worker routes call `getCollection` through the same `content.ts` queries the pages use; Astro bundles the data store into the server build, so no snapshot file and no second source of truth. Verified on `wrangler dev` before the first deploy. | `lib/api.ts`, `pages/api/work/[...id].ts` |
| One theme | The light/dark split is between the columns, not between modes of the page. Two themes would double every new surface and weaken the signature. The toggle, `data-theme`, the `dark:` variant and the dark screenshot twins went together. | `global.css`, `Base.astro`, `Cover.astro`, `Figure.astro` |
| `format: 'file'` and `trailingSlash: 'never'` | Astro's default emitted `/projects/index.html`, which cost every internal link a 307. Canonical URLs are computed from the served path, not the output filename. | `astro.config.mjs`, `Base.astro` |
| `prerenderEnvironment: 'node'` | workerd forbids runtime WASM, which breaks the Shiki highlighter and OG image generation. Prerendered pages never execute in the Worker anyway. | `astro.config.mjs` |
| `ProjectData` exported from the schema | Astro's inferred type resolved to `any` and silently removed type safety from every consumer. | `content.config.ts`, `content.ts` |
| One query for listings, one for routes | Draft exclusion has to gate route generation too, or a draft is live at its URL. Subsystems are hidden from listings, not from the site. | `content.ts` |
| Contrast gate in `npm run check` | Colour is the easiest thing to get quietly wrong; a nudged token drifts and nobody notices until someone cannot read the site. It caught the first accent (4.41:1 on the quiet fill) the day the world changed. | `scripts/check-contrast.mjs` |
| The dark panel and chip styles are scoped to their column | `.panel` and `.chips` are class names the help desk also uses for its own light chrome; unscoped, the reference styles painted the desk's tickets dark. | `global.css`, `desk.astro` |
| Reading mode set before first paint, re-set after swap | Deferred, the Engineer copy flashes in after the Plain copy on a reload. Without the after-swap re-apply a reader in Engineer is flipped back by their next click. | `Base.astro` |
| Scroll reveal on a CSS scroll timeline, observer fallback | A debounced scroll handler is still a scroll handler and is what drops frames on a mid-range phone. Only the help desk and the demos still use it; the reference pages render at rest. | `global.css`, `Base.astro` |
| Every DOM script binds on `astro:page-load` | View Transitions keep the JS context; a module runs once, so top-level setup dies after the first navigation. Demos also clean up on `astro:before-swap` or a game loop runs forever behind the reader. | `Header.astro`, `Demo.astro`, `Nameplate.astro` |
| `/desk` and `/play` are `bare` | The desk runs its own hash router; the player wants the whole viewport. Astro falls back to a full navigation for pages that opted out. | `Base.astro`, `desk.astro` |
| `/play/<slug>` is a destination, not a projection | A demo is the one thing here that gets forwarded for its own sake. It was `noindex` and out of the sitemap, with a *Back to write-up* bar on top and the site's default card — so a shared link unfurled as somebody's portfolio and opened onto portfolio chrome. It now indexes, unfurls as a picture of the game, and puts the way back into the site beneath the game rather than above it. | `pages/play/[...slug].astro`, `astro.config.mjs` |
| The share slip carries the URL | A Wordle-style score that does not say where the game is cannot spread; whoever it is pasted to has no way to play. Built from `location.origin`, so a slip copied in dev does not send people to production. | `demos/shotcall/index.ts` |
| A demo's share card is composed, not captured | `cover` is a screenshot of the thing running: right above a write-up, anonymous in a group chat, where the picture is all anyone sees. `shareCard` puts the game's name and hook on its own art, in the game's own faces. Built by a script from a committed composer so it cannot drift from the game. | `scripts/build-share-cards.sh`, `scripts/share-cards/` |
| Every board swap is reversible | "Rack another" used to be one-way: the day's board, its score and its slip came back only on a page reload, which on the write-up also throws the reader to the top of the article. The table now racks BACK, by handing `rerack` the day's geometry — kept as a copy at mount, because a re-rack reassigns all four board variables. | `demos/shotcall/index.ts` |
| The table stands up on a phone | A pool table is landscape and a phone is not: fitted to a 393px screen it was 314x238 in an 852px viewport, a quarter of the glass. Upright it is 356x470 — 2.2x the playing surface — which is why every pool game on a phone does this. Done by rotating ONE group, not by transposing the projection: the chalk line is persisted in user units, so a line drawn on a phone has to line up with the same board opened on a desktop. Letters counter-rotate; pointer input reads the stage's matrix, not the svg's. | `demos/shotcall/index.ts` |
| The work index filters by category, not stack | A stack filter grows one chip per library; at eight projects it was forty tags and a keyword cloud, and nobody comes to a portfolio looking for *Gherkin*. `category` is a closed enum in one module, required on every top-level project so a game cannot be filed under Work by omission, and the tab row is derived from what is actually filed. Adding a kind of work — animations, writing — is one line and a label. | `lib/categories.ts`, `content.config.ts`, `pages/projects/index.astro` |
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
   `plainBlurb` ≤200 in business words, `role`, `status`, `category` (what it *is*:
   `work`, `tool`, `game` — a new kind is one line in `lib/categories.ts`), `stack`
   most-used first, `featured` in the current band order (§5.2), `date`.
3. The contract: `problem`, `unique`, `learned` (with a number or a specific failure),
   `aiNote` (what was decided, verified, thrown away).
4. `metrics`: outcome and scale only, values as strings, dated somewhere in the body if
   they will drift.
5. Body: a `<PlainOnly>` story and an `<EngOnly>` account, figures outside both. `## `
   headings, no `#`. `<Takeaway>` for at most one or two lessons worth interrupting for.
   A quick read: about 1,200 words in Engineer mode at most, Plain in a couple of
   minutes. The rest of the reasoning goes in code comments, the plan, or §9.
6. Cover: a real screenshot in the product's light theme, redacted in-browser,
   `coverAlt` written as evidence. Or no cover; never a placeholder image.
7. Links: `source` only if public; omit the key otherwise. `live` if it runs somewhere.
8. If the project has a demo, §8.2. If it moves or renames an existing URL, a redirect
   in the same commit.
9. Check: `npm run check` clean, `npm run build` clean, the page read once in each
   register at 390px and 1440px, every console on it showing a real response, and
   `GET /api/work/<slug>` answering on `wrangler dev`. The social card at
   `/og/projects/<slug>.png`.
10. If any fact on it also appears in `site.ts` or the résumé, change those too,
    regenerate the PDF, commit the PDF with the change.

### 8.2 Adding a demo or game

- Island: `src/demos/<name>/index.ts`, `mount(el) => cleanup`, start gate before any
  expensive work, reduced motion honoured, every timer stopped in cleanup. `.ts` only.
  The gate guards expense, not arrival: a demo with no loop, no audio and no listener
  outside its element may skip it and must give the reason in its header (see
  `src/demos/shotcall/`). Everything else in that list still applies.
- Iframe: export under `public/demos/<slug>/`, under 25 MiB per asset, `camera: true`
  only if the demo genuinely needs it.
- Frontmatter `demo:` block; `label` in the imperative (*Play Galaxy Defense*).
- Confirm the fullscreen route at `/play/<slug>` mounts (it has no View Transitions
  router, so the bind path is different).
- Give the project a real `cover` capture, and for anything people will forward, a
  composed `shareCard` as well (`scripts/share-cards/`, `npm run share:cards`). The
  card is the whole of what a link shows in a chat.
- Anything that swaps the board must be reversible. A player who leaves the day's
  board has to be able to get back to it without reloading the page.

### 8.3 Changing the design

1. Change the token, not the component. If a component needs a colour that has no
   token, the design system is missing a token, so add one to the `:root` block with a
   comment saying what it is for — and, if text sits on it, a pair in the gate.
2. Run `npm run check:contrast`. If it fails, the colour changes, not the threshold.
3. Look at both columns and both registers, on a phone width and at 1440. A console's
   status line, the language tabs and a long JSON body are the fragile spots on the dark
   side; a link on the quiet fill is the fragile number on the light side.
4. Look with reduced motion on. Look with JavaScript off (`curl` the built HTML): the
   plain register, every console's request and response, and every list must be present
   as text.
5. If it touches the help desk's chrome, open `/desk` — it shares the tokens but not the
   classes, and a new global class name can collide with one of its own.
6. If it changes a rule in this file, update the rule and add a line to §9.

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

`site.ts` first; the pages, the consoles and `/api` all follow from it. If it is one of
the four stats, update `statsAsOf`. If it is on the résumé, `npm run build && npm run
resume:pdf` and commit the PDF. If it is the employer, the nameplate sentence in
`loops.ts` and the structured data in `Base.astro` read from `site.ts`, so check they
still say something true. If it is a fact the API should expose under a new key, add it
in `api.ts` and it appears in the console that shows that record.

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
| 2026-09-01 | Home page becomes a nameplate: three sections, one flagship card plus rows, one contact exit. Stats move onto the ERP card. The three ERP subsystems nest under it with redirects. About becomes the credential narrative. First redacted screenshots. ([plan](docs/plans/2026-08-31-portfolio-nameplate-and-collapse.md)) |
| 2026-09-01 | The repository went public. GitHub link, Source buttons, and the `code/` excerpt tree turned on. Push to `main` deploys again. |
| 2026-09-01 | Body and code move to IBM Plex; Bricolage stays for display. |
| 2026-09-01 | The résumé becomes a one-page ATS-shaped page with a generated PDF; the title everywhere is Software Engineer; the degree line is coursework. |
| 2026-09-01 | Audit follow-ups: outcome metrics only, a hire-me path, a one-time mode hint under the header, the fullscreen play page fixed. The reply-time promise dropped. |
| 2026-09-02 | The loops list beside the name, and the nameplate sentence that rewrites itself on the mode switch. ([plan](docs/plans/2026-09-02-portfolio-hero-loops-and-register.md)) |
| 2026-09-02 | Vendor and storefront names blurred in the browser before capture on every screenshot. |
| 2026-09-03 | Receipt splitter v2 embedded through the iframe lane; the page rewritten around "refusing is a feature". |
| 2026-09-03 | Screenshots follow the site theme: paired light and dark captures swapped on `[data-theme]`. |
| 2026-09-11 | Carom ships as the second island demo: a daily bounce puzzle with a year of boards generated at build time. The start gate is qualified — it guards expense, not arrival, so a demo with no loop may skip it with a stated reason. One reflection rule is shared by the generator, the physics gate and the demo, and the gate now replays the committed `boards.json` through it. |
| 2026-09-11 | Carom renamed to **Shotcall**, with no redirect: the old URL was live for 47 minutes, had no inbound links and was never shared, and a redirect that protects nobody is permanent clutter in the config. (The `repricer`/`quickbooks` rows above are the opposite case — months live and linked from a résumé.) Three reasons, found by checking rather than guessing: another daily browser puzzle is already called Carom; carom billiards is specifically the *pocketless* discipline, and this table has fourteen pockets; and carom/carrom is a well-known disc-flicking board game. Shotcall is the call-shot rule the game actually implements — nominate the pocket, and the cushions on the way. Verify a game name against the daily-puzzle field before building the art around it. |
| 2026-09-11 | `/play/<slug>` becomes a shareable page rather than a fullscreen view of the write-up. Indexed and in the sitemap, social card is the project's cover art re-encoded to 1200px, description is the Plain English blurb, and the *Back to write-up* bar is replaced by a footer under the game carrying the credit, *How it works*, the rest of the work and a Share button (native sheet where there is one, clipboard otherwise). Shotcall's score slip now ends with the game's URL. The reasoning: a demo is the only thing on this site that gets forwarded for its own sake, and every part of that page was built for a reader arriving from the write-up instead. |
| 2026-09-11 | Shotcall gets a composed share card and a way back to the day's board. The card is the game's art with its name and question set over it in the game's own faces, rendered from `scripts/share-cards/shotcall.html` by `npm run share:cards`; the raw cover unfurled as an unnamed green rectangle, which is what a link in a group chat cannot afford. Frontmatter gains `shareCard`, ahead of `cover` and the generated text card. Separately, "Rack another" gained its inverse: a practice rack no longer strands the day's result behind a page reload. |
| 2026-09-11 | Shotcall's table turns upright at 560px and under, and the play page goes edge to edge there. Measured before changing anything: 314x238 of table on a 393x852 screen, 20% of the width spent on gutters. After: 356x470, 2.2x the surface. The rotation is a transform on one group rather than a transposed projection, so every stored coordinate — the chalk line above all — stays in one space and a board drawn on a phone still reads on a desktop. Turning the device rebuilds the board and keeps the round. |
| 2026-09-11 | Shotcall's demo generates its own boards past the daily one, so what makes a board fair moved out of the build script into `src/demos/shotcall/board.mjs` — one `evaluate`, called by both the enumerator and the browser. A demo that ships generated content may generate at runtime only through the same module the build uses, and the gate must audit the runtime path by re-deriving the rules rather than trusting the function that enforces them. |
| 2026-09-11 | The work index filters by **category** (Work · Tools · Games) instead of by stack. The stack row had reached forty chips for eight projects: a tag cloud that grew with every library and answered a question no visitor asks. A category says what the thing is; the set is a closed enum, required on top-level projects, and a tab appears only once something is filed under it. Future kinds (animations, writing) are one line each. |
| 2026-09-12 | Shotcall's mobile pass, from an audit driven on a phone-sized viewport. The table svg is `role="group"` rather than `role="img"`: an img's children are presentational by spec and the table carries fourteen buttons. The audit first called this a screen-reader defect on the strength of the browser pane's DOM walker, which does not list the pockets under either role; Chromium's real tree, read over the DevTools protocol, exposes all fourteen under both, because focusable descendants override the presentational rule. The role change stays as the honest one; the defect claim was withdrawn. The pocket focus ring was a brass box, because the generic `:focus-visible` rule was declared after the pocket's `outline: none` at equal specificity. The re-rack's cloth panels are clipped to the cloth (they were painted across the rail on the way in). The ball rolls at one speed derived from distance rather than a budget per leg, eases in, and shrinks into the pocket with a ring from the rim instead of vanishing between frames. The first phone screen holds the table and the verdict line: `Demo` gains a `flush` prop the play page passes, which drops the section margin and the card chrome under `sm`, and the game's own phone margins were trimmed (verdict measured at 828px in an 852px viewport, under Safari's bars). Smaller: the aim arrow fades once the ball has left, a ruled-out pocket's X is drawn on rather than stamped, Wipe stays put greyed until the eraser finishes, and the card blanks when a re-rack starts. Rules: a demo's audit is done at the width most of its players use, with the real pointer, not by reading the code; and an accessibility claim is checked against the browser's own accessibility tree, never against a tool's walk of the DOM. |
| 2026-09-12 | Shotcall says what to do with itself. Three findings from watching a first-time player: the fourteen pockets look like furniture, so the first tap goes to the ball; the scorecard's keys are a 1.5px outline on paper sitting seven pixels from a tally box, which is a 1px outline on paper, so the card reads as four blanks and two more blanks; and the card sat under the fold, so the one line that says *pick a pocket* was never read. Fixes: the rims breathe **cue blue** (`--cue` / `--cue-lit`, the only blue the room did not already own — `--chalk` is the X on a ruled-out pocket, the player's line and the focus ring) for six cycles, all fourteen in unison, retiring on the first pointer, the first pocket focus or the first guess, so the invite and an X are never on the table together; reduced motion keeps the blue and drops the movement, because turning the animation off must not turn the message off. The keys get a 2.5px hard ink shadow and travel when pressed — nothing else on the card has a shadow, so a shadow now means pressable. The sign above the cloth is the title and one instruction, centred: *Choose the landing hole*. The date, the bounce count and *each miss reveals one* came off; the date is on the scorecard where a scorecard's date belongs, and the bounce count is taught by the first miss (*Bounce 1 of 3*). That is 68px of chrome, and the whole card now lands on the first screen at 393×750, 440×782 and 375×600. Rules: a game canvas may spend a colour on an affordance, but never one already carrying a meaning on the same surface; and a hint retires on the first sign the player understood it, because a hint that never gives up is a nag. |
| 2026-09-12 | Shotcall gets a **Hard** key: the same table off the grid. Any entry angle, two to six bounces climbing through the week in *ranges*, the count never printed, and a miss with no bounce left to show rolls the ball in and ends the day. The physics is a second function in `trace.mjs`, `freeContacts` — constant velocity, first surface, flip the perpendicular — which the gate proves reproduces the stepping tracer bit for bit on all 25,448 lattice boards, so the daily's tracer is untouched and the two share one rule. The board is not shipped: `board.mjs`'s `hardBoardFor` makes it from the date with a seeded PRNG on the player's device, and the gate makes 373 of them from fixed seeds and re-derives every margin. Exactness becomes margins there, and each is a physical thing (answer within 0.3 of the mouth's centre, other contacts a dot from any mouth, nothing within 0.6 of a corner); the write-up's "no tolerance anywhere" is now scoped to the daily. Sight diamonds go on the RAILS for hard boards only, one per dot: the daily kept its dots off the cloth so the angle would be seen not counted, and at a free angle the eye needs a scale — on the wood, not the cloth. The hard board keeps its own record (`shotcall:<date>:hard`) and its own slip (`· hard`, never the count), and the key goes both ways with nothing spent. Rules: a mode that relaxes the engine's guarantees states, in the gate, what replaces each one; a generator whose rejection rate depends on the thing it is drawing draws that thing once, outside the loop; and a scale added for one mode is drawn on the furniture that mode owns, never on the shared surface. |
| 2026-09-12 | Follow-up from playing the hard mode on the live site. The Hard toggle becomes **Today's hard**, the mirror of *Today's board*: each is shown when its board is not on the table and hidden when it is, so there is no pressed state to read and no question of how to get back. The scorecard's keys split into two rows by what they are about — the tallies row keeps Wipe and Chalk (this game), a second row holds Today's board, Today's hard and Rack another (which board) — because four keys on one wrapping row broke wherever the width fell. The sight diamonds move from a hard-only layer into the furniture, on every board: the owner wanted them on the daily, they are what a real table has, and the "no dots" decision was about the cloth, which stays bare. And the hard daily survives a reload the way the regular always has (`shotcall:<date>:on`). Rule: two keys that swap two things are two named keys, not one toggle. |
| 2026-09-12 | The chalk line in a capture has to be a real call. `cover.png` carried a freehand swoosh that banked off nothing and ended nowhere, which on the share card — the whole of what a pasted link shows — read as a stray mark rather than as the feature working. Recaptured by driving the real game: the day's true path is computed from `trace.mjs` first, then the stroke is drawn against it with real pointer events, banking short at each rail and putting the block deflection low, so it lands on the bottom rail beside K while the ball drops into L. Still freehand and still wobbly — the chalk tool is unchanged, and the point is a hand that was close and wrong. Framing held at the previous capture's 67.5% of frame width by 95% of height so the card composer's crop still lands. Rule: a capture shows the feature doing its job on real data, and a placeholder gesture in a shipped image is a bug, not a detail. |
| 2026-09-14 | Shotcall's write-up cut to about half — Engineer mode from ~2,350 words to ~1,200, Plain from ~720 to ~370 — and recalibrated to the register in the 2026-09-10 entry below. What went: the authored epigrams ("Opacity isn't a reset", "furniture that looks like it matters"), the closed-form and transition-bug detours, the sight-diamond paragraph, one lesson of five. Every number stayed; the code comments and the decision log still hold the reasoning that left the page. Rule: a write-up is a quick read, not the full account — around 1,200 words in Engineer mode is the ceiling, and Plain should be readable in a couple of minutes. Detail past that lives in the code comments, the plan, or this log. |
| 2026-09-14 | The same pass over every other write-up, both registers. Plain mode totals went from 10,547 words to 9,428 across the 15 pages and Engineer from 15,795 to 13,966; the big cuts were second-brain (1,914 → 1,405 Engineer), printing (1,809 → 1,414), inventory (1,348 → 1,049) and Galaxy Defense (1,515 → 1,247). Every `<Takeaway>` folded into prose (a pull-quote is an authored epigram by construction), every "does not / cannot / it is" contracted, one lesson dropped from each five-item list, and the contact page's pitch paragraph contracted too. Numbers, blurbs, figures and component tags untouched. Two traps for next time: a `: ` inside an unquoted `learned` item is a YAML mapping and fails the schema; and a blurb that praises the work ("cleverest parts") breaks §2.2 as surely as a body paragraph does. |
| 2026-09-03 | CI overlaps the typecheck and the build; the wrangler-action probe dropped. |
| 2026-09-03 | The second-brain vault written up. |
| 2026-09-03 | This file. |
| 2026-09-03 | Printing gets its own subsystem page (`featured: 65`). The layout kit, the EPL converter and the device agent were one row each in the toolbox list; the toolbox stays the complete inventory of `code/` and links across. |
| 2026-09-04 | Inventory gets its own subsystem page (`featured: 75`), built on the ABC-classifier ranking bug and the scan-anchoring rule. Six subsystems is the ceiling for the **Inside it** grid; a seventh reads as a table of contents. |
| 2026-09-14 | [Impeccable](https://impeccable.style) installed as a global Claude Code skill, with a project hook left untracked. `PRODUCT.md` is its product record: users, purpose, constraints and evidence, no visual rules. This file stays the design authority; a variant that ships is recorded here, not in a generated `DESIGN.md`. Its decision rounds and comps live in `.impeccable/` — `config.json` (code-first builds) and the surface briefs are tracked; mocks, review captures and question logs are ignored. First use: three home-page mockups in one claude.ai artifact, listed in §10. |

---

### 2026-09-10 — Person-first homepage

The homepage now introduces Dylan's professional background before presenting work.
This supersedes the earlier three-section homepage and employer-only nameplate rules:
name and role → short background → selected projects → experience → personal interests
→ contact. The first nameplate sentence still stays identical in both registers.

Selected work is curated for breadth: the ERP, agent tooling, and the independent receipt
splitter. Each preview explains what the work demonstrates, uses a real screenshot where
available, and links to the complete case study. The catalog stays on /projects. No ERP
metrics appear in the introduction. The career timeline uses site.experience so dates
and titles agree with the résumé. Existing interests and the playable high-school game
supply personal detail without inventing a new biography. Search descriptions introduce
the person rather than the dental distributor.

---

### 2026-09-10 — The homepage says it the way Dylan says it

The person-first structure of the entry above is unchanged; only the wording is. The
first pass wrote that structure in template English — "Explore my work", "What I bring
to the work", "Let's work together", "Building and operating a complete business
system" — which reads like every other portfolio and contradicts §2.2 (say what
happened, not what I am; no slogans; short words for hard things).

The copy was recalibrated against how Dylan actually writes, rather than against how
portfolio sites usually sound. The rules that came out of it, which this page now
follows:

- **Fact first, no runway.** The sentence opens on the thing, not on a frame around
  the thing. "I ran a phone store, then a restaurant floor", not "My background spans
  retail management and hospitality".
- **Concrete nouns over abstractions.** A register, a POS, a count that never matched
  the shelf — never "a complete business system" or "production ownership".
- **No adjectives about himself.** He never describes his own qualities. Headings state
  what a thing is ("One at work, one for myself, one on the side"), never what it proves.
- **Plain courtesy, not brochure warmth.** His professional register is "If that's what
  you're hiring for, let me know" — direct and brief. Not "Let's work together."
- **Honest hedges stay.** "Mostly backend", "about", "usually". A qualifier he would
  actually say is not weakness; deleting it to sound certain is the drift.

The same pass then ran over `/about`, which was closer to begin with but carried the
two tells this rule exists to catch: authored epigrams ("Subtly wrong is worse than
obviously broken", "The app is the work, not a view of it") and formal non-contracted
forms ("It is where", "It was not for lack of trying") that Dylan never uses. The three
`site.principles` now lead with the situation rather than the maxim. Two paragraphs
that had come to duplicate the home page — the by-hand line and the off-the-clock tile
— were rewritten to say something the other page does not; check both pages together
when either one changes.

One trap worth naming, because it will come up again: an agent calibrating this voice
must not calibrate on its own prior output. Long-form writing that passed through an
agent reads as the agent's register, not Dylan's, and feeding it back in tightens the
loop instead of correcting it. Short, unedited writing is the reference. Whatever the
reference, §11 still governs which facts may appear.

---
| 2026-09-14 | The ERP loses its product name: "the internal ERP" at `/projects/internal-erp`, every old URL redirected, the name retired from the current tree (history untouched). |
| 2026-09-14 | The site moves into the API-reference world (mockup C): white prose column beside a continuous dark response column, Source Sans 3 and JetBrains Mono, one blue-violet accent, method badges; every page is a rail plus endpoint rows. One theme — the toggle, `data-theme` and the dark screenshot twins go. §1.3, §3 and §4 rewritten; the eyebrow leaves the reference pages. |
| 2026-09-14 | A real read-only API under `/api/`, served by the Worker from `site.ts` and the content collection, with `fields`, honest errors and `page` on every record; every console on the site renders its endpoint's real response at build time and Sends for real. `POST /api/contact` answers 503 with a `mailto:` until delivery is configured rather than claiming success. |
| 2026-09-14 | The résumé PDF regenerated from the page in the new type: one page, no product name. |

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
- **Mail delivery for `POST /api/contact`.** The route is live and honest: 503 with a
  `mailto:` until `RESEND_API_KEY` and `CONTACT_TO` exist. Setting them turns the console
  into a real send; if `TURNSTILE_SECRET` is set too, the console needs the Turnstile
  widget before it can pass the check. Dylan's call, in the Cloudflare dashboard.
- **Mockups A and B.** The interview and Release notes stay in the private artifact the
  three were decided from; C shipped. They are not candidates any more, only records.
- **A console for a subsystem's siblings.** A subsystem page's `GET /api/work/{id}`
  console lists every id; a `parent`-scoped list would be a nicer default. Small.
- **The channel P&L page** is not parked; it is off the site for good. Listed here so
  nobody re-asks.

Open questions, no decision yet:

- None about the visual world. `/desk` keeps its own dialect — decided 2026-09-14 when the
  reference world shipped around it and the parody read better for the contrast.

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
  through the internal testing path documented in the ERP's repo" is the whole sentence.
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
| 2026-09-14 | §9 gains the impeccable row; §10 parks the three home-page mockups. |
| 2026-09-14 | The API-reference world: §1.3, §3, §4 rewritten; §5.1–5.3 updated and §5.5 (the API) added; §7, §8.3, §8.5 updated; four §9 rows; §10 re-parked. |
