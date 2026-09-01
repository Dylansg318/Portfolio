# camera-scanner — a browser barcode scanner that refuses to invent numbers

A phone-camera barcode scanner for warehouse work (React + zxing-wasm), plus
the seeded simulation bench that its accept policy was measured against.

> Extracted from a private production ERP; identifiers and fixtures have been
> sanitized. All payloads here — order numbers, UPCs, the postal GS1-128, the
> UDI DataMatrix — are synthetic, with valid shape and check digits but
> invented content.

## The problem

A hand-held phone over a small printed barcode is a hostile decode
environment: ~2 pixels per module, tilt, foreshortening, focus hunting, sensor
noise, JPEG artefacts. Under those conditions a multi-format decoder does not
just *miss* — it *fabricates*: measured over 220 simulated hand-held sessions
on the packing-slip barcode, **5.8% of accepted first-frame reads were wrong**,
including a Code 128 order number arriving as a *checksum-valid* EAN-13. A
wrong-but-plausible number in a warehouse flow is far worse than no read.

## What's here

```
src/
  decoder.ts            the one decode configuration + hand-rolled frame loop
  decoder.test.ts       engine seam: formats, GS1 wire contract, loop, cadence
  streamStub.ts         honestly-typed MediaStream/Track stubs (no `as unknown as`)
  CameraScanner.tsx     the shared camera stage: confirmation streak, torch,
                        dedupe, still-photo escalation, "hold steady" hint
  CameraScanner.test.tsx
  CameraScanner.css
bench/
  run.mjs               engine x format-set x policy sweep over degraded frames
  degrade.mjs           the hand-held camera model (sessions, frames, AR(1) tremor)
  engines.mjs           js (@zxing/library) and wasm (zxing-cpp) adapters, one shape
  render-fixtures.mjs   offline deterministic fixture renderer (bwip-js)
  decode-check.mjs      "does this PNG still scan" assertion tool
  sweep-shelf.mjs       how small can a label get before it stops being accepted
  fixtures/             committed synthetic fixtures + frozen expected payloads
BENCH.md                how to run and, more importantly, how to READ the bench
```

## Design points

**N-frame agreement, scaled to what the format set can produce.** The decoder
calls back per frame; a read is accepted only after N *consecutive* frames
return the same payload, and a blank frame resets the streak. The premise: the
false decodes are artefacts of one specific pose, and a drifting hand cannot
repeat a wrong read back-to-back. N is derived from the format set — 3 for
sets containing the EAN/UPC family (the measured fabrication mode), 2 for
narrowed sets that structurally cannot produce it. Measured, this took wrong
reads from 5.8% to 0.0% at the cost of ~15% fewer accepted sessions.

**Format allow-lists as an anti-fabrication measure.** A decoder that can read
everything can also invent anything. Each surface declares the symbologies it
can legitimately be shown ('shipping', 'product', or their union), grounded in
a census of what the operation actually prints and buys. Bare ITF is excluded
even from the widest set — it short-reads a truncated run of bars as a valid
shorter code — while check-digit-bearing ITF14 stays in.

**Decode what the operator sees.** The frame loop crops the decode region to
the `object-fit: cover` window the preview shows (~42% of a portrait frame in
a 4:3 stage), so a barcode outside the visible area can never be the thing
that scanned.

**A cadence, not a sleep.** Attempt spacing is a target gap between attempt
*starts*: decode time is paid out of the budget, a floor keeps the event loop
breathing, and a duty-ratio cap makes a slow device back off instead of
pinning its UI thread — the naive form tells exactly the weakest phone to try
hardest. The anti-storm pause is charged only on an *accepted* read; charging
it on any decoded frame is the bug that once spaced confirmation frames 800 ms
apart and added 1.6 s to every 3-confirmation read.

**Still-photo escalation.** When the live stream will not read, a file input
with `capture="environment"` hands control to the phone's own camera app
(real autofocus, full sensor resolution) and decodes a three-step crop ladder:
whole image capped at 3000 px, centre 50% at native pixels, centre 25%.

**Failure states are legible.** The negotiated track resolution is displayed
live (a label that will not read is a measurement question, not a theory); a
code that decodes *differently every frame* shows "hold steady" instead of
sitting on a stale last-read line; a blocked camera still offers the photo
path.

## The bench: modelling frame spacing as correlation, not amplitude

The differentiator lives in `bench/degrade.mjs`. Shortening the frame cadence
is a *correctness* question: frames closer together are more alike, and
"a drifting hand cannot repeat a wrong read" is the entire premise of the
confirmation streak. The bench models frame-to-frame hand tremor as an
**AR(1) walk** around the session pose:

```
d_n = ρ·d_(n−1) + √(1−ρ²)·fullAmplitudeDraw        ρ = exp(−spacingMs / 100ms)
```

The `√(1−ρ²)` term holds the stationary per-frame distribution constant at
every spacing — so fabrication *incidence* stays fixed and only
*repeatability* varies, which is exactly the thing the accept policy fears.
`--spacingMs=0` is ρ = 1: a frozen pose, where a fabrication repeats forever
and defeats a streak of any length — the irreducible-risk bound.

The v1 of this gate scaled tremor *amplitude* with spacing, which suppressed
the very fabrications it was watching for: the pass condition got *easier* as
the parameter under test got more aggressive, making the gate unfailable. That
flag is retired, its numbers are struck, and `BENCH.md` documents both the
mistake and the bench's remaining blind spots (it is honest about being
underpowered: a 0-vs-0 cell proves nothing).

## Dependencies

- **zxing-wasm** (zxing-cpp compiled to WebAssembly) — the shipped engine; the
  only import `src/decoder.ts` needs. Bundled and served same-origin (the
  `?url` import assumes Vite); never a CDN.
- **@zxing/library** — the retired pure-JS engine, kept as the bench baseline
  (it fabricates more, which makes it the column where a policy change can be
  falsified).
- **bwip-js**, **sharp** — bench-only: offline fixture rendering and the
  camera-pipeline degradation model.
- **react**, testing-library, jest — the component and its suites.

`npm install` in this directory, then `node bench/run.mjs --engine=both`.

## Regenerating fixtures

```
node bench/render-fixtures.mjs
```

renders the five committed PNGs deterministically and freezes
`fixtures/expected.json` by decoding each clean render with the baseline
engine — engine behaviour defines "right", never a hand-typed string. Verify
any rendered label still scans with:

```
node bench/decode-check.mjs bench/fixtures/slip-m2.png=12345678
```
