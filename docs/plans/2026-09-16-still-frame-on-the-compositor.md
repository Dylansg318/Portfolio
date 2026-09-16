# The still frame on the compositor: a phone gets the frame back
<!-- Decision record + scope ledger + verification contract. Slice detail added JIT. -->

## Decision
**Problem:** The home page's still frame stuttered on Dylan's iPhone 16 Pro Max. Measured
(WebKit as that phone): the script costs under 1ms a frame; what stutters is delivery — iOS
hands scroll events to the page after the compositor has already scrolled, at its own cadence,
and every visible motion in the frame was set from those events. `4fa0792` turned the frame off
for touch screens as the stop-gap. Dylan wants the frame back on phones, properly.

**Approach:** Keep the frame's model in `still-frame.ts` (the segments, the settle, the jumps,
the address, the rail, the drawer) and move only the *motion* — each row's fade out, fade in and
scroll-inside-the-frame — to CSS scroll-driven animations on the document timeline
(`animation-timeline: scroll(root)`), which Safari 26.4+ and Chrome run on the compositor
thread. `measure()` writes each row's three ranges as absolute scroll offsets (inline
`animation-range`) plus its overflow as `--ov`; the keyframes read `--ov`. Three animations per
element, in list order *in, scroll, out*, `fill-mode: forwards`, `replace` composition, so the
later range wins while in effect and the earlier fill holds between. The first row has no *in*,
the last no *out*, a row that fits has no *scroll* (`none` in that slot). The script keeps
rendering inline styles only where the compositor can't (no `animation-timeline` support, or
reduced motion, where the rows swap in a step and a beat of lag is invisible). On a touch screen
the frame runs only when the compositor drives it. The settle-to-row waits for the finger to
lift.

**Rejected:**
- Three stacked animations per column (in, scroll, out) with `fill-mode: forwards` holding
  the row between them — the first cut. Correct on desktop WebKit and Chromium, blank between
  fades on the iPhone, whose compositor runs in another process and dropped the fill.
- Trim the handler (cache the frame's top, defer `replaceState`) — it is already under 1ms a
  frame; the lag is the engine's, so no trim fixes it.
- Drive `visibility` from the keyframes too — WebKit accelerates an animation only when every
  property in it is accelerable, and a main-thread discrete flip would lag the fade-in and pop the
  row in. `inert` from the script (a beat late, hit-through) does the job; the JS path keeps its
  `visibility: hidden`.
- Native sections with `scroll-snap` on phones — a different design (nested scrollers, no
  fade), and Dylan's decision was the frame.
- Leave it off on phones — the stop-gap; Dylan chose otherwise.

**Invariants that must hold (the project's own):** animate `opacity` and `transform`, nothing
else per frame (§3.5); reduced motion zeroes everything; without JavaScript the home page is the
ordinary reference; the address follows the row and Back leaves the page; a row taller than the
frame scrolls inside it first, nothing cut off; below 1024px the response is a drawer; the game
panel holds the frame's scroll; both gates green before a push; no new facts on the page.

**Facts tested first (WebKit 2336 as iPhone 16 Pro Max, and Chromium):** px `animation-range`
values are scroll offsets; a changed `--ov` inside a running keyframe applies live; a changed
`animation-range` applies live; `none` in an `animation-name` slot drops that animation.

## Verification contract
| # | Slice | Proof command | Expected observable |
|---|---|---|---|
| 1 | CSS path | `node scratch/parity.mjs` (WebKit, iPhone descriptor): sample ~60 scroll offsets, read computed opacity/transform of every row's prose and stick on the CSS path and on the JS path (supports() stubbed false) | every sample within 0.06 opacity and 3px translate; `still-css` on root; no inline opacity/transform on the CSS path |
| 1 | CSS path | `node scratch/measure.mjs /` | frame on for the touch descriptor; rAF max ≤ 1ms; no hitch > 34ms after the first frame |
| 2 | Touch settle | `node scratch/touch.mjs`: dispatch `touchstart`, scroll mid-fade, wait 400ms | scrollY unchanged while touching; settles within 1s of `touchend` |
| 3 | Docs + header | `grep -n "still-css\|pointer: fine" DESIGN_SYSTEM.md src/scripts/still-frame.ts` | §3.5, §4, §7, §9, §12 updated; the pointer gate is gone from the rule |
| all | Gates | `npm run check && npm run build` | 0 errors / 0 warnings / 0 hints, contrast pass, build ok |
| all | Live | `gh run list --limit 1`; Dylan flicks through `/` on the phone | deploy success; smooth by his hand — the emulation cannot prove feel |

## Scope ledger
- [x] 1. The motion moves to CSS: keyframes + `.still-css` rules in `global.css`; `still-frame.ts` writes ranges, paints only on the JS path, gates touch on compositor support   DONE — same commit
- [x] 2. The settle waits for the finger: `touchstart`/`touchend` in `still-frame.ts`   DONE — same commit
- [x] 3. Docs: `DESIGN_SYSTEM.md` §3.5, §4, §7, §9, §12; the file header   DONE — same commit
- [x] 4. Gates, parity + measure + touch proofs, screenshots, push, deploy check   DONE — parity 0 mismatches on Desktop Safari, Desktop Chrome, iPhone 16 Pro Max, Pixel 7 (65 offsets each); touch settle held/released; check + build green; shipped in the commit that carries this record
- [x] 5. Work and About blank on the phone (`44c47c4` live): the compositor there dropped a finished animation's fill. One animation per column, keyframes generated per row in px, both ends the rest state, first row's range from 0 and last row's past the end; no `var()` in keyframes, no `none` slots. Proofs re-run (parity 0 mismatches ×4 devices, `robust.mjs`: every animation's ends equal rest or its range can't be left, touch, behaviour, cost, paths); pushed   DONE — same commit

## Slice detail — slice 1: the motion moves to CSS
**Files:** `src/styles/global.css` (still-frame block), `src/scripts/still-frame.ts`
**Change:** `global.css`: `@keyframes still-in` (opacity 0→1, `translateY(var(--rise))`→none),
`still-scroll` (none→`translateY(calc(var(--ov) * -1px))`), `still-out` (opacity 1→0,
`translateY(calc(var(--ov) * -1px))`→`calc(var(--ov) * -1px - var(--rise))`); under
`.still-css`, prose and stick get `animation-name: none; animation-timeline: scroll(root block);
animation-fill-mode: forwards; animation-timing-function: cubic-bezier(.45,0,.55,1), linear,
cubic-bezier(.45,0,.55,1)` (the JS `ease` is quad in-out), rows after the first start at
`opacity: 0`, and `[inert] { visibility: hidden }` is scoped to `.still:not(.still-css)`.
`still-frame.ts`: `sda = CSS.supports('animation-timeline: scroll()')`; `css = sda && !reduce`;
`fits = innerHeight ≥ 480 && (fine || sda || reduce)`; `enable()` adds `still-css` when `css`;
`measure()` on the CSS path computes `base = ref.top + scrollY − headH` and per row writes
`--ov`, `animation-name` and `animation-range` for prose (in 0.55–1, scroll, out 0–0.45 of
`fade`) and stick (in 0.62–1, out 0.05–0.5); `paintRow` writes styles only when `!css`;
`disable()` clears all of it; a `ResizeObserver` on `document.body` re-measures when anything
above the frame changes height (the first-visit hint being dismissed).
**Proves it:** the parity and measure rows of the contract.
