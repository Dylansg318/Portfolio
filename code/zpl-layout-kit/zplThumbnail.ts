'use strict';

/**
 * Product PHOTO → ZPL raster, for the 4×6 warehouse packing slip.
 *
 * Sibling of zplLogo.ts, and deliberately NOT the same code. A logo is line art:
 * `sharp.threshold(180)` is exactly right for it, because every pixel is already
 * meant to be pure black or pure white. A product photograph is continuous tone,
 * and the same threshold turns it into a silhouette — a black blob with a white
 * hole where the highlight was. Every mid-grey in the picture (which on typical
 * product shots is most of it: steel, resin, packaging) lands on one side of a
 * single cliff.
 *
 * So this dithers instead: Floyd–Steinberg error diffusion to 1-bit. The printer
 * still only has ink and no-ink, but the ERROR from each pixel is pushed into its
 * neighbours, so a 50% grey becomes a 50% pattern of dots rather than a solid
 * field. At 203 dpi and 13 mm (104 dots square) that is enough to tell a drill
 * bit from a bottle at arm's length, which is the entire job.
 *
 * NORMALISE FIRST — this is the step that actually makes it work, and it was NOT
 * obvious. Four recipes were rendered through Labelary against real channel
 * product images: plain dither, plain threshold, and each again after
 * `.normalise().sharpen()`. Plain dither alone was WORSE than a threshold on line
 * art — a stainless instrument on white came out as broken speckle, because the
 * picture has almost no midtones to diffuse (measured midtone mass 0.051) and the
 * error just scatters the outline. Plain threshold in turn destroyed the
 * continuous-tone shots: a lubricant can (midtone mass 0.159) printed as a solid
 * black slab with no cap, no label, no shape.
 *
 * Normalising first fixes both, so no per-image branching is needed. These images
 * are low-contrast subjects on off-white, and stretching the range before
 * dithering is the difference between mush and shape: after it, the instrument is
 * a clean continuous line drawing AND the can is a can. That is why the pipeline
 * is unconditional rather than a "line art vs photo" classifier — the classifier
 * was written, measured, and turned out to be unnecessary.
 *
 * WHAT THIS CANNOT FIX: the source is not always a photograph. One channel's
 * published image for a rotary-instrument product is a SHADE/SIZE CHART, and a
 * chart at 13 mm is unreadable under every recipe tried. A picture lane cannot
 * promise a picture — only the best rendering of whatever the channel published.
 *
 * THERMAL DOT GAIN. A thermal head burns a dot slightly larger than its grid
 * cell, so ink spreads and a picture that looks right on screen prints muddy.
 * `gain` lifts the midtones BEFORE dithering to compensate. It is a power curve
 * on the greyscale values and not sharp's `.gamma()`, which rejects anything
 * below 1.0 outright — the direction we need.
 *
 * Sizing is in DOTS, not mm, because that is what ZPL and the dither both work
 * in; the caller converts (203 dpi = 8 dots/mm, so 13 mm ≈ 104 dots).
 *
 * The output is the same `{ zpl, width, height }` shape zplLogo returns, so the
 * layout renderer treats a photo exactly like the logo it already knows how to
 * place — the raster is resolved by the CALLER and passed in, never fetched
 * from inside the renderer.
 */

import sharp from 'sharp';

// 13 mm at 203 dpi. Settled by printing 13/18/23 mm samples side by side: the
// larger two came back "pretty similar", i.e. the extra paper bought no
// legibility, so the smallest of the three wins on rows-per-label.
const DEFAULT_DOTS = 104;

// Midtone lift before dithering. 0.80 ≈ a half-stop; enough to stop dot gain
// filling in the shadows, gentle enough that a genuinely dark product stays dark.
const DEFAULT_GAIN = 0.8;

/** Greyscale → 0/255, Floyd–Steinberg. Mutates a copy, returns packed 1-bit rows. */
function ditherToBits(grey, width, height, gain) {
  // Float working copy: error diffusion needs values that can leave 0..255, and
  // a Uint8 buffer would clip them silently — which shows up as banding in the
  // shadows rather than as an error.
  const buf = new Float32Array(width * height);
  for (let i = 0; i < buf.length; i++) {
    // Power curve toward white. gain < 1 lifts midtones (see the header).
    buf[i] = 255 * Math.pow(grey[i] / 255, gain);
  }

  const bytesPerRow = Math.ceil(width / 8);
  const packed = Buffer.alloc(bytesPerRow * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const old = buf[i];
      const next = old < 128 ? 0 : 255;
      const err = old - next;
      buf[i] = next;

      // 1 = ink in ZPL, and 0 is black in our greyscale, so an ink dot is `next === 0`.
      if (next === 0) {
        packed[y * bytesPerRow + (x >> 3)] |= 1 << (7 - (x & 7));
      }

      // Standard Floyd–Steinberg kernel: 7/16 right, 3/16 down-left,
      // 5/16 down, 1/16 down-right. Edge neighbours are simply dropped —
      // wrapping the error to the next row smears the right edge into the left.
      if (x + 1 < width)                 buf[i + 1]             += err * 7 / 16;
      if (y + 1 < height) {
        if (x > 0)                       buf[i + width - 1]     += err * 3 / 16;
                                         buf[i + width]         += err * 5 / 16;
        if (x + 1 < width)               buf[i + width + 1]     += err * 1 / 16;
      }
    }
  }
  return { packed, bytesPerRow };
}

// ── The two ways to get from grey to one bit ─────────────────────────────────
//
// DITHER (Floyd-Steinberg, above) is built for CONTINUOUS TONE. It trades
// resolution for apparent greys, which is right for a photograph of a scene and
// wrong for a photograph of a printed carton: flat colour blocks and heavy type
// on white come back as a field of speckle.
//
// CRISP is a plain cut — ink or paper, nothing in between. Measured through this
// renderer on real catalogue images: a printed pouch carton, a blister pack and
// a boxed face-mask carton all go from unreadable to legible, and the blister's
// printed size panel and its six instrument handles appear at all for the first
// time.
//
// IT IS NOT UNIVERSALLY BETTER, AND NO NUMBER I COULD COMPUTE TELLS THEM APART.
// Two classes lose: a full-frame macro with no white background inks 80-94% of
// the tile and prints as a black square, and a white product on a white ground
// (gauze) INKS SOLID where the dither at least showed its shape. TWO attempts
// at an automatic classifier both misfired — the second passed the gauze as
// safe, which is the clearest failure on the list — so the choice is stored PER
// PRODUCT and defaulted by PROVENANCE instead: a slip picture somebody
// photographed is framed tight on a printed face and gets CRISP (the stored
// column default); a legacy catalogue image has no per-product slip-image
// record at all and therefore keeps the dither, by construction rather than by
// anyone remembering.
const DITHER = 'dither';
const CRISP = 'crisp';
const RENDER_MODES = [DITHER, CRISP];
// 200 of 255, on the NORMALISED image. Swept 180/200/220 over eight real
// products: 180 loses the pouch carton's printed swoosh and empties the gauze
// entirely, 220 fills the blister's blue band solid and swallows its white text
// panels. 200 is the middle of the only band that worked for all of them.
const CRISP_LEVEL = 200;

/** Read a render mode off opts, tolerating absent/garbage and defaulting to today's. */
function renderMode(opts: any = {}) {
  const m = String(opts && opts.mode || '').trim().toLowerCase();
  return m === CRISP ? CRISP : DITHER;
}

/**
 * Grey -> 1-bit by a plain threshold. Same packed-row contract as ditherToBits
 * (MSB first, rows byte-padded) so the ^GFA header maths is identical and the
 * two are interchangeable at the call site.
 */
function cutToBits(grey, width, height, level) {
  const bytesPerRow = Math.ceil(width / 8);
  const packed = Buffer.alloc(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // A SET bit prints ink, so dark pixels set. `<` not `<=`: pure white at
      // 255 must never ink, and at level 255 the whole tile would otherwise go
      // black — a profile knob is hand-editable and should fail empty, not solid.
      if (grey[y * width + x] < level) packed[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { packed, bytesPerRow };
}

/**
 * Render an image buffer as a ^GFA block sized to fit `dots` × `dots`.
 *
 * @param {Buffer} buf            - any format sharp reads (jpg/png/webp/avif/gif).
 * @param {object} [opts]
 * @param {number} [opts.dots]    - bounding box, in printer dots. Square box, but
 *                                  the image keeps its aspect ratio inside it, so
 *                                  the returned width/height are what to lay out
 *                                  against — never assume the box.
 * @param {number} [opts.gain]    - midtone lift before dithering (see header).
 * @param {string} [opts.mode]    - 'dither' (default) | 'crisp'. See the block
 *                                  above cutToBits for why this is a per-product
 *                                  stored choice and not something we detect.
 * @returns {Promise<{zpl:string,width:number,height:number}|null>} null on any
 *   unreadable input — a slip that prints without a picture is a working slip,
 *   so every failure here is a soft one.
 */
async function buildThumbnailZpl(buf, opts: any = {}) {
  const r = await rasterise(buf, opts);
  if (!r) return null;
  const { packed, bytesPerRow, width, height } = r;
  const totalBytes = packed.length;
  return {
    zpl: `^GFA,${totalBytes},${totalBytes},${bytesPerRow},${packed.toString('hex').toUpperCase()}^FS`,
    width,
    height,
  };
}

/**
 * The SAME pipeline, handed back as a PNG instead of ZPL — so an operator
 * previewing a slip drawing sees the ink the printer will actually lay down,
 * not the artwork they uploaded. A preview built any other way would be a
 * different picture, which is worse than no preview: the whole reason drawings
 * exist is that this dither destroys photographic detail, and a preview that
 * hides that would let someone upload a shaded render and believe it worked.
 *
 * @returns {Promise<Buffer|null>} 1-bit-looking PNG at print size, or null.
 */
async function buildThumbnailPreviewPng(buf, opts: any = {}) {
  const r = await rasterise(buf, opts);
  if (!r) return null;
  const { packed, bytesPerRow, width, height } = r;
  // Unpack the 1-bit rows back to 8-bit grey. A ZPL ^GFA bit that is SET prints
  // ink, so 1 -> black.
  const out = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const bit = (packed[y * bytesPerRow + (x >> 3)] >> (7 - (x & 7))) & 1;
      out[y * width + x] = bit ? 0 : 255;
    }
  }
  const scale = Math.max(1, Math.round(Number(opts.zoom) || 1));
  return sharp(out, { raw: { width, height, channels: 1 } })
    .resize({ width: width * scale, height: height * scale, kernel: 'nearest' })
    .png()
    .toBuffer();
}

/** Shared front half: decode → fit → 1-bit. Both renderers MUST use this. */
async function rasterise(buf, opts: any = {}) {
  if (!buf || !Buffer.isBuffer(buf) || !buf.length) return null;
  const dots = Math.max(24, Math.round(Number(opts.dots) || DEFAULT_DOTS));
  const gain = Number.isFinite(Number(opts.gain)) ? Number(opts.gain) : DEFAULT_GAIN;

  let resized;
  try {
    resized = await sharp(buf)
      // EXIF orientation, applied BEFORE the resize (sharp requires that order).
      // Every drawing uploaded from a desktop lacks the tag entirely, so this was
      // a no-op — until the phone camera arrived. A phone writes the sensor's
      // pixels and an Orientation tag saying which way is up, so a portrait shot
      // of a carton reaches sharp lying on its side and printed that way. It
      // stays inside rasterise() precisely because both renderers go through
      // here: rotating in only one of them would make the operator's preview
      // stop being the ink.
      .rotate()
      // Product shots are overwhelmingly PNG-on-transparent or JPEG-on-white.
      // Flattening onto white first means a transparent background becomes
      // paper, not ink — without it the alpha channel dithers into a black box.
      .flatten({ background: '#ffffff' })
      .resize({ width: dots, height: dots, fit: 'inside', withoutEnlargement: false })
      .greyscale()
      // The two steps that make the dither legible — see the header. normalise()
      // stretches these low-contrast-on-off-white product shots to full range;
      // sharpen recovers the edges the downscale to ~104px softened. Order
      // matters: both run AFTER the resize, so they work on the pixels that will
      // actually be printed rather than on detail about to be thrown away.
      .normalise()
      .sharpen({ sigma: 0.6 })
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch (_e) {
    return null;
  }

  const { data, info } = resized;
  const { width, height } = info;
  if (!width || !height) return null;

  const { packed, bytesPerRow } = renderMode(opts) === CRISP
    ? cutToBits(data, width, height, CRISP_LEVEL)
    : ditherToBits(data, width, height, gain);
  return { packed, bytesPerRow, width, height };
}

export {
  buildThumbnailZpl, buildThumbnailPreviewPng, renderMode,
  DEFAULT_DOTS, DEFAULT_GAIN, DITHER, CRISP, RENDER_MODES,
};
export const _internals = { ditherToBits, cutToBits };
