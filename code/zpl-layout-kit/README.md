# zpl-layout-kit

Foundations of a production thermal-print pipeline: a measured text-metrics
model for Zebra's `^A0` font, barcode width fitting, a Floyd–Steinberg
1-bit dither for product photos, and a "render-and-look" dev loop that turns
ZPL edits from blind pushes into a seconds-long visual iteration cycle.

> Extracted from a private production ERP; identifiers and fixtures have been
> sanitized. The full JSON-layout→ZPL packing-slip renderer (~1,800 lines of
> pagination, grouping, and per-channel furniture) stays in the private repo —
> these are its foundations, published as readable excerpts rather than an
> installable package.

## The problem

ZPL has no layout engine. `^FB` (field block) wraps text, but it does not
truncate overflow — per the ZPL manual, text exceeding the line cap
**overwrites the last line**, so a quantity of `200` in a too-narrow box prints
as a bold `20` with the last `0` stamped on top: a mis-pick, not a cosmetic
defect. `^BC` (Code 128) takes no `^FB` at all and clips nothing — a long order
id simply prints through whatever sits to its right. To place anything safely,
the renderer must **predict the printed width itself**.

The first attempt was `fontSize * 0.6` per character. It was mis-tuned in both
directions: it over-reserved mixed-case titles (wasting label rows) and
under-reserved all-caps ones (printing past the box). The fixes, in order of
hard-won lessons:

1. **A per-character glyph-advance table, measured, not bucketed**
   (`zplTextMetrics.ts`). Real `^A0` capitals run from J at 0.442× the font
   size to W at 0.812×, so any "all caps ≈ 0.58" bucket is wrong for most of
   its members — and the error is unbounded on a string that is all one kind
   (an all-caps romanized manufacturer name, say). The hyphen was the single
   most wrong number: scored 0.34 in a punctuation bucket for a year, it
   really measures 0.903 — *wider than a capital* — and roughly half the
   catalogue's titles contain one. The table was measured by
   repeat-differencing (render N copies vs 2N, difference the widths), which
   cancels side bearings exactly; the naive `ink width / character count`
   method folds the bearings into every character and under-scores by 10-12%,
   the direction that prints past the box.

2. **Prediction and render asserted against each other.** `estimateWrapLines`
   (the reserve) and `wrapTextToLines` (the draw) are two implementations of
   the same greedy wrap, kept separate so a bug in one is caught by the other:
   the test suite fails unless they agree at every width the engine uses.

3. **Barcode module-width fitting** (`fitBarcodeModuleW`,
   `fitDataMatrixMagnification`). Symbol width is modelled from the symbology
   arithmetic — Code 128: 11 × (chars + 2) + 13 modules, verified against a
   real render (a 19-char order id = 244 modules exactly, so `^BC` auto mode
   does *not* subset-C-pack digit runs; assuming it does halves the predicted
   width, in the expensive direction). The DataMatrix model deliberately skips
   ECC200's digit-pairing optimization: it only holds while the id stays
   numeric, and an id that gains a letter would silently outgrow the reserved
   box. Over-reserving costs one magnification step; under-reserving prints
   the symbol through its neighbour.

4. **Dither vs threshold** (`zplThumbnail.ts` vs `zplLogo.ts`). A logo is line
   art: `threshold(180)` is exactly right, because every pixel is already
   meant to be pure black or white. The same threshold is catastrophic for a
   continuous-tone product photo — every mid-grey lands on one side of a
   single cliff and the picture becomes a silhouette. Photos get
   Floyd–Steinberg error diffusion instead, with two production lessons on
   top: **normalise first** (low-contrast product shots on off-white must be
   stretched to full range, or the dither renders mush — this one step made a
   "line art vs photo" classifier unnecessary), and **lift midtones before
   dithering** to compensate for thermal dot gain. A `crisp` hard-cut mode
   exists for photographs *of printed cartons* — flat colour and heavy type
   dither into speckle — and the choice is stored per product because two
   attempts at an automatic classifier both misfired.

5. **Printer state hygiene** (`zplPrintQuality.ts`). `^PR`/`^MD` are printer
   configuration, not format geometry — they survive `^XZ`. One carrier's
   label ZPL opens with max speed + max darkness, which then silently applied
   to every document that followed it until the next power cycle. Every
   document states its own speed/darkness, with values picked off actual
   printed comparison cards.

## The render-and-look loop

`zpl-preview.mjs` renders fixtures covering the hard cases — pathological
titles, deep pagination, the 19-char order id — and posts each page to the
[Labelary](http://labelary.com) API, writing one PNG per page plus the raw
`.zpl`. You (or an AI agent) open the PNGs, judge, edit, re-run. Labelary
proved to be a faithful width reference for real Zebra hardware (verified with
printed calibration targets), so most iterations never touch paper.

```
npx tsx zpl-preview.mjs             # render all fixtures
npx tsx zpl-preview.mjs --list      # show fixtures
npx tsx zpl-preview.mjs --fixture wrap --out /tmp/previews
```

Labelary is a free public service — the harness stays under ~3 requests/second
and backs off on 429. In this excerpt the script drives a compact demo
renderer built on the kit's primitives; in the private repo the same loop
drives the full production engine, which is the point: the preview renders the
*real* code path, so it cannot drift from what a slip prints.

## Files

| File | What it is |
| --- | --- |
| `zplTextMetrics.ts` | Measured `^A0` glyph-advance model: wrap estimation, actual line breaking, font shrink-to-fit (single-line and line-budget), align offsets, Code 128 + DataMatrix width models and fitters |
| `zplTextMetrics.test.mjs` | The invariants: reserve ≥ draw, no character ever lost, every wrapped line fits its box, barcode fits never overflow |
| `docLayoutSchema.ts` | Minimal JSON layout-profile schema + mm→dots conversion |
| `zplThumbnail.ts` | Product photo → 1-bit `^GFA`: normalise → sharpen → Floyd–Steinberg dither (or `crisp` cut), EXIF rotation, dot-gain compensation, and a preview renderer that shares the exact pixel pipeline with the print path |
| `zplThumbnail.test.mjs` | Dither/threshold contracts, `^GFA` header arithmetic, EXIF-orientation equivalence, preview-equals-ink |
| `zplLogo.ts` | Logo (line art) → `^GFA` via hard threshold |
| `zplPrintQuality.ts` | Explicit `^PR`/`^MD` so no document inherits another's printer state |
| `zpl-preview.mjs` | The render-and-look harness: demo renderer + Labelary client with rate-limit backoff and lint passthrough |

## Running it

External dependencies, deliberately few:

- **Node 20+** and [`tsx`](https://github.com/privatenumber/tsx) to run the
  `.ts` modules and tests directly (`npx tsx --test zplTextMetrics.test.mjs`)
- **[`sharp`](https://sharp.pixelplumbing.com/)** — only for the two raster
  modules (`zplThumbnail.ts`, `zplLogo.ts`) and their tests; the text metrics
  and preview harness have zero dependencies
- **Labelary** (public HTTP API) — only for the preview harness

`zplTextMetrics.ts` is unit-agnostic throughout: widths and font sizes may be
millimetres or printer dots, as long as each call keeps them in one unit.
