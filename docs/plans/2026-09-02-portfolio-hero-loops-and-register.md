# Portfolio: the hero shows the pattern, not the job
<!-- Decision record + scope ledger + verification contract. -->

## Decision

**Problem:** The nameplate is honest and short, but everything in it is the ERP. A reader who
sees only the fold learns "one engineer, one dental-supply system." The through-line the About
page argues — people keep handing Dylan more once they watch him work, everything he builds
started as something done by hand, he writes "unknown" rather than guess — is invisible until the
third click. The site also has a Plain English ⇄ Engineer switch that most visitors never notice,
because nothing above the fold changes when it flips.

**Approach (approved by Dylan, 2026-09-02):**
1. **The loops.** A five-line list in the brain vault's own grammar — `- [x] 2020 — …` — set in
   IBM Plex Mono beside the name. On load the lines drift in loose and unfiled, settle into
   dated rows, and tick closed in order: the high-school game with no arrays, the store the
   manager left him, hired off the restaurant floor, the spreadsheet that became the system.
   The fifth line is `2026 — unknown` with a live cursor and links to `/contact`. Each closed
   line links to the About stop or project behind it, so the animation is also navigation.
   Under two seconds, runs once, pure CSS on server-rendered markup: no JavaScript and
   reduced-motion both show the finished list.
2. **The sentence rewrites itself.** The nameplate sentence gets a Plain and an Engineer
   register. Both ship in the HTML (crawlers and no-JS get plain, as everywhere else). With JS,
   flipping the header switch diffs the two sentences word by word: shared words stay put,
   dropped words collapse, new words expand in reading order. The first sentence is identical in
   both registers so only the claim changes, which is the point — same fact, two audiences.

**Parked, noted for later (Dylan, 2026-09-02):**
3. *The ship with no loop.* A single pixel-art ship from Galaxy Defense crosses the hero once on
   load; clicking it opens `/play/galaxy-defense`. A quarter session. Not built yet — the ask was
   1 and 2 first.

**Rejected:**
- *Anything from the vault's data.* The brain repo is private by constitution and carries real
  names, an address, and payroll identities. The hero borrows its grammar; every fact on the
  page already appears on `/about` or a project write-up.
- *A live "orders today" counter.* Without a production connection it is a fabricated number,
  which the nameplate comment already forbids ("deliberately not a slogan").
- *The GS1 scan-and-parse strip.* Good animation, wrong message: it is the ERP again.
- *Typing effects.* A typewriter is a template tell and delays the reader; the list files itself
  instead, and the only cursor is on the line that is genuinely unwritten.

## Scope ledger

| File | Change |
|---|---|
| `src/lib/loops.ts` | NEW — the five loops and the two-register nameplate sentence, the single source of truth. |
| `src/components/ui/Loops.astro` | NEW — the list and its CSS choreography (drift, file, tick, cursor). |
| `src/components/ui/Nameplate.astro` | NEW — the sentence: SSR both registers, JS word-diff morph on `data-mode`. |
| `src/pages/index.astro` | Hero becomes a two-column grid on `lg`; sentence replaced by `<Nameplate>`; `<Loops>` added. |
| `src/pages/about.astro` | Each path stop gets an `id` so a loop can deep-link to it. |
| `docs/plans/…` | This record. |

Out of scope: `/resume` (print), `/desk`, the project pages, the mode hint copy (already says
"two ways to read this site", and the hero now proves it).

## Verification contract

- `npm run check` — types, Astro diagnostics, contrast gate. Must pass.
- `npm run build` — must pass; Pagefind index regenerates.
- Rendered check in a headless browser: the finished list reads correctly with animations
  complete; the sentence morphs on flip and lands on the exact Engineer text; no layout shift on
  the first sentence; light and dark themes; 375px and 1280px widths.
- No-JS: `curl` the built HTML — the list and the plain sentence are present as text.
- No second-model review: rendering and copy, visible on sight.
