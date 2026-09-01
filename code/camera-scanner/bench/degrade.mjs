// The degradation model: clean render -> simulated hand-held camera frames.
// Resize / rotate / blur, calibrated in PIXELS PER MODULE — the axis every
// measured false decode lived on (all of them between 1.9 and 3.7 px/module).
// Seeded, so a run is a fact that can be reproduced, not a dice roll.
//
// A SESSION is one operator holding one phone over one label: a pose (target
// px/module, tilt, focus quality, exposure) drawn once. A FRAME is one decoder
// callback within that session: the pose plus hand tremor (sub-degree tilt
// jitter, sub-pixel translation, small focus/exposure drift). The confirmation
// policies under test are streaks over consecutive frames, so the frame-to-
// frame correlation matters as much as the marginal quality itself.
//
// FRAME SPACING IS MODELLED AS CORRELATION, NOT AS AMPLITUDE (v2).
// The per-frame jitter amplitudes below describe a hand holding a phone. Frames
// arriving closer together are MORE ALIKE — the hand has moved less between them
// — and that matters because "a drifting hand cannot repeat a wrong read" is the
// entire premise of the <CameraScanner> confirmation streak: two nearly
// identical frames can repeat the SAME fabrication and satisfy a policy a
// drifting camera would have broken.
//
// v1 OF THIS MODEL GOT IT WRONG AND THE GATE WAS USELESS. It scaled the drawn
// deltas by `spacingMs/120`, which shrinks the MARGINAL degradation of every
// frame as well as the difference between neighbours. Marginal degradation is
// what GENERATES fabrications here, so a shorter spacing suppressed the very
// thing the gate was watching for: measured, the retired js engine went from 4
// fabrications at first-frame (120 ms) to ZERO (60 ms). A gate whose pass
// condition gets easier as the parameter under test gets more aggressive is not
// a gate. Caught in a second-model review.
//
// v2 IS AN AR(1) WALK AROUND THE SESSION POSE. Each frame's offset is
//
//     d_n = rho * d_(n-1) + sqrt(1 - rho^2) * fullAmplitudeDraw
//     rho = exp(-spacingMs / TREMOR_TAU_MS)
//
// so the STATIONARY per-frame distribution is the full calibrated amplitude at
// every spacing — fabrication incidence stays spacing-invariant — while `rho`
// carries exactly the neighbour-to-neighbour correlation the streak fears.
// rho -> 0 at wide spacing (independent frames, the v1 120 ms behaviour) and
// rho -> 1 as spacing -> 0 (a frozen pose, where a fabrication repeats forever
// and defeats a streak of ANY length). TREMOR_TAU_MS = 100 is one period of
// 10 Hz physiological tremor.
//
// The draw count per frame is unchanged, so a given seed still produces the same
// session poses and the same frame ORDER at every spacing.

import sharp from 'sharp';

/** mulberry32 — tiny seeded PRNG, good enough for a bench. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const uniform = (rng, lo, hi) => lo + rng() * (hi - lo);

/** One period of ~10 Hz physiological tremor — the decorrelation time constant. */
export const TREMOR_TAU_MS = 100;

/** AR(1) retention for frames `spacingMs` apart. 0 = independent, 1 = frozen. */
export function tremorRho(spacingMs) {
  if (!Number.isFinite(spacingMs) || spacingMs <= 0) return 1; // frozen pose
  return Math.exp(-spacingMs / TREMOR_TAU_MS);
}

/**
 * Advance one AR(1) channel. `prev` is the previous frame's offset in the same
 * units as the draw; the sqrt(1-rho^2) term is what keeps the stationary
 * variance equal to the draw's variance at EVERY rho — i.e. the marginal
 * degradation of a frame does not depend on how fast we are looking.
 */
function ar1(prev, draw, rho) {
  return rho * prev + Math.sqrt(1 - rho * rho) * draw;
}

export function makeSession(rng, band) {
  return {
    pxPerModule: uniform(rng, band[0], band[1]),
    rotate: uniform(rng, -6, 6),
    blur: uniform(rng, 0.5, 2.0),
    gain: uniform(rng, 0.6, 1.15),
    noise: uniform(rng, 4, 14),   // sensor noise sigma, 8-bit counts
    jpegQ: Math.round(uniform(rng, 35, 75)), // camera-pipeline compression
    // Foreshortening: the phone tilted around the vertical axis compresses the
    // code across the bars only. This is the ingredient that pushes effective
    // px/module below the sampled band and makes thin bars alias into OTHER
    // bars — the mechanism behind every measured wrong read.
    squeeze: uniform(rng, 0.72, 1.0),
    // AR(1) walk state, one channel per jittered quantity. Starts at 0 = the
    // session's own pose; renderFrame advances it.
    walk: { rotate: 0, blur: 0, gain: 0, squeeze: 0, shiftX: 0, shiftY: 0 },
  };
}

/**
 * Render one frame of a session. Order is deliberate: tremor-shift and tilt at
 * native resolution first, THEN the downscale to the session's px/module (the
 * downscale is where thin bars alias into wrong ones), then focus blur and
 * exposure — the same order a real camera pipeline degrades in.
 */
export async function renderFrame(basePng, nativePxPerModule, session, rng, spacingMs = 120) {
  // Every channel is drawn at FULL amplitude and then walked, so the marginal
  // degradation of this frame is the calibrated one regardless of spacing; only
  // its similarity to the previous frame changes. See the AR(1) note in the
  // header. Draw count per frame is fixed, so the seed still pins the sequence.
  const rho = tremorRho(spacingMs);
  const w = session.walk;
  w.rotate = ar1(w.rotate, uniform(rng, -0.6, 0.6), rho);
  w.blur = ar1(w.blur, uniform(rng, -0.3, 0.3), rho);
  w.gain = ar1(w.gain, uniform(rng, -0.06, 0.06), rho);
  w.squeeze = ar1(w.squeeze, uniform(rng, -0.03, 0.03), rho);
  // ZERO-MEAN DRAWS ONLY. ar1()'s sqrt(1-rho^2) preserves the stationary
  // VARIANCE, not the mean: feeding it the old uniform(0,4) would give a
  // stationary mean of 2*sqrt(1-rho^2)/(1-rho) — 2.7 px at 120 ms but 3.7 px at
  // 60 ms — so the sub-pixel resample shift, which is the aliasing driver behind
  // every fabrication, would get systematically larger at shorter spacing and
  // reintroduce the v1 bias on the one channel that matters most. Draw centred
  // and re-add the offset below.
  w.shiftX = ar1(w.shiftX, uniform(rng, -2, 2), rho);
  w.shiftY = ar1(w.shiftY, uniform(rng, -2, 2), rho);

  const rotate = session.rotate + w.rotate;
  const blur = Math.max(0.3, session.blur + w.blur);
  const gain = session.gain + w.gain;
  const squeeze = Math.min(1, session.squeeze + w.squeeze);
  // Re-centred on 2 (the old uniform(0,4) mean) and clamped to the 0..3 the
  // extend() below budgets for. The walk is continuous; the resample grid only
  // moves in whole pixels.
  const shiftX = Math.min(3, Math.max(0, Math.round(2 + w.shiftX)));
  const shiftY = Math.min(3, Math.max(0, Math.round(2 + w.shiftY)));
  const scale = session.pxPerModule / nativePxPerModule;

  const base = sharp(basePng).flatten({ background: '#ffffff' });
  const meta = await base.metadata();
  const degraded = await base
    .extend({ top: shiftY, left: shiftX, bottom: 4 - shiftY, right: 4 - shiftX, background: '#ffffff' })
    .rotate(rotate, { background: '#ffffff' })
    .resize({
      width: Math.max(16, Math.round((meta.width + 4) * scale * squeeze)),
      height: Math.max(16, Math.round((meta.height + 4) * scale)),
      fit: 'fill', // anisotropic on purpose — squeeze hits the bar axis only
      kernel: rng() < 0.5 ? 'nearest' : 'cubic', // sensor-grid aliasing half the time
    })
    .blur(blur)
    .sharpen({ sigma: 0.8 }) // the ISP's unsharp mask — edge overshoot on thin bars
    .linear(gain, 128 * (1 - gain)) // exposure drift pivoting around mid-grey
    .toBuffer();

  // Sensor noise (seeded Box-Muller), then a JPEG round-trip for the camera
  // pipeline's compression artefacts — the two ingredients a synthetic render
  // lacks and a phone frame never does.
  const { data: rgb, info: pre } = await sharp(degraded).raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < rgb.length; i += pre.channels) {
    const n = Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng()) * session.noise;
    for (let c = 0; c < 3 && i + c < rgb.length; c += 1) {
      const v = rgb[i + c] + n;
      rgb[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
  const { data, info } = await sharp(
    await sharp(rgb, { raw: { width: pre.width, height: pre.height, channels: pre.channels } })
      .jpeg({ quality: session.jpegQ }).toBuffer(),
  ).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  return { data: new Uint8ClampedArray(data), width: info.width, height: info.height };
}
