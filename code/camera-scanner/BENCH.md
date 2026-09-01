# bench/ — the camera scanner's degradation bench

Measures a decode engine against simulated hand-held phone frames, with the
same accept policies `<CameraScanner>` runs in production. Built to gate an
engine swap (`@zxing/library` → `zxing-wasm`); kept because the earlier bench
that measured the fabricated-number bug was never committed and had to be
rebuilt from its notes.

```
node bench/run.mjs --engine=js            # the retired pure-JS engine
node bench/run.mjs --engine=wasm          # what the app ships
node bench/run.mjs --engine=both          # same frames through both
#   --sessions=220 --frames=14 --seed=1 --fixture=slip-m2 --spacingMs=120
node bench/render-fixtures.mjs            # re-render fixtures/ (offline)
```

## `--spacingMs` — the gate for any change to how fast frames arrive

`startScanLoop`'s `attemptMs` is how often the loop looks while the operator is
aiming; it is also how far apart the frames of a **confirmation streak** sit
(they used to be `successPauseMs` = 800 ms apart, because the loop paused after
any frame that DECODED rather than after an accepted one). Frames closer
together are **more alike**, and *a drifting hand cannot repeat a wrong read*
is the entire premise of the streak — so shortening either number is a
correctness question, not a performance one.

`--spacingMs=N` models that as an **AR(1) walk** around the session pose:

```
d_n = ρ·d_(n−1) + √(1−ρ²)·fullAmplitudeDraw        ρ = exp(−N / 100ms)
```

The `√(1−ρ²)` term holds the **stationary per-frame distribution constant at
every spacing**, so fabrication *incidence* does not move and only
*repeatability* does. `--spacingMs=0` is ρ = 1: geometry frozen, the pessimistic
bound. **Read the WRONG column, not the speed one.**

### The v1 flag was worthless — do not cite `--cadenceMs` numbers

v1 scaled per-frame tremor **amplitude** by N/120. Amplitude is what *generates*
fabrications in this model, so a shorter spacing suppressed the very thing the
gate watched for: the js engine went from **4** fabrications at first-frame
(120 ms) to **zero** (60 ms). A gate whose pass condition gets easier as the
parameter under test gets more aggressive is not a gate. Caught by a
second-model review; every `--cadenceMs` figure in older notes is retired.

### Known limits — this gate is UNDERPOWERED

- **The wasm engine fabricates almost nothing on these fixtures**, so a wasm-only
  run is close to a free pass. Use `--engine=both`; the js column is where a
  cadence change can actually be falsified.
- **"WRONG = 0" is not proof of safety when the baseline is also 0.** The AR(1)
  model is less severe than v1: at 120 ms and 60 ms it produces no fabrications at
  all, so those cells cannot distinguish "no increase" from "an increase below
  detection". Get the baseline producing fabrications before trusting a pass —
  raise `--frames`, or use a fixture nearer the px/module cliff.
- **ρ = 1 freezes GEOMETRY, not the frame.** Sensor noise and the resample kernel
  still vary per frame (as on any real camera), so the degenerate
  "byte-identical frames repeat a fabrication forever" case is untested. Measured
  side-effect: per-frame noise alone is enough to break a fabrication streak.
- **A fabrication count of 1–4 out of ~180 accepted is not a significance test.**
  Telling 0% from 0.8% needs roughly 1,500 accepted sessions.

## How to read the table

One **session** = one operator holding one phone over one label (a pose:
px/module, tilt, focus, exposure, foreshortening — drawn once, seeded). One
**frame** = one decoder callback within it (pose + hand tremor). `answered` =
sessions where the policy accepted a payload; `WRONG` = the accepted payload
was not the label's. The three policies are the real `<CameraScanner>` streak
logic (blank frame breaks the streak): `first frame wins` is the pre-fix
behaviour, `2 in a row` / `3 in a row` are what production runs (derived from
the surface's `ScanFormatSet`: 3 for the wide sets, 2 narrowed).

**A cell is comparable to another cell** because every engine × format-set ×
policy sees the *identical* degraded frames per session (one generation per
session, seeded RNG throughout).

## The model, and what it is calibrated against

Clean render → tremor shift → tilt → anisotropic downscale to the session's
px/module (foreshortening squeezes the bar axis only; kernel alternates
cubic/nearest for sensor-grid aliasing) → focus blur → ISP-style sharpen →
exposure drift → seeded sensor noise → JPEG round-trip. Calibration target:
the original in-app measurements at the real packing bench's ~2.1 px/module —
first-frame-wins reads ~60-80% of sessions and fabricates several percent of
them (checksum-valid wrong payloads, e.g. Code 128 bars arriving as an
EAN-13); confirmation streaks + narrowed formats take fabrications to zero.
Treat the SHAPE as solid and absolute rates as approximate — that caveat comes
from the original measurement notes themselves.

## Fixtures (`fixtures/`, committed)

Rendered offline and deterministically by `render-fixtures.mjs` (bwip-js — a
deliberate deviation from the first bench's Labelary fetch; `scale` = px/module
exactly as Labelary's dot=pixel at 8dpmm). **Every payload is synthetic** — a
made-up order number, textbook UPC digits, and invented postal / UDI payloads
with valid shape. `expected.json`'s `expectedPayload` is frozen from the
BASELINE engine decoding the clean render — engine behaviour defines "right",
never a hand-typed string. Note the two GS1 forms it freezes: GS1-128 carries
`]C1` + GS separators; GS1 DataMatrix arrives from zxing-js as a LEADING GS
with no `]d2`. The server-side GS1 parser accepts both anchors and parses them
to identical lookup keys — so engine-payload equality is required for Code 128
forms and parser-equivalence, not byte equality, for DataMatrix (see
`payloadKey` in run.mjs).

## Engines (`engines.mjs`)

Both resolve from `node_modules` — in the source app they resolved from the
app's own dependency tree so the bench measured the exact versions the app
ships. The `js` adapter copies the old decoder's hints (TRY_HARDER, ASSUME_GS1,
POSSIBLE_FORMATS); if `src/decoder.ts` changes its options, change the adapter
in the same commit. The `wasm` adapter mirrors the shipped payload
composition: GS1 results get `symbologyIdentifier` prefixed, everything else
stays bare.
