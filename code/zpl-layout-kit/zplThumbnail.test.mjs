'use strict';
// Run: npx tsx --test zplThumbnail.test.mjs   (needs `sharp` installed)
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

import { buildThumbnailZpl, buildThumbnailPreviewPng, DEFAULT_DOTS, _internals } from './zplThumbnail.ts';
const { ditherToBits } = _internals;

/** A w×h PNG whose greyscale value ramps left→right, i.e. all midtones. */
function gradient(w, h) {
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.round((x / (w - 1)) * 255);
      const i = (y * w + x) * 3;
      raw[i] = raw[i + 1] = raw[i + 2] = v;
    }
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

function solid(w, h, v) {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: v, g: v, b: v } } }).png().toBuffer();
}

/** Parse ^GFA,<total>,<total>,<bytesPerRow>,<hex> back out. */
function parseGfa(zpl) {
  const m = /^\^GFA,(\d+),(\d+),(\d+),([0-9A-F]*)\^FS$/.exec(zpl);
  assert.ok(m, 'output must be a well-formed ^GFA block');
  return { total: Number(m[1]), total2: Number(m[2]), bytesPerRow: Number(m[3]), hex: m[4] };
}

test('bad input is a soft failure — a slip with no picture is still a working slip', async () => {
  assert.equal(await buildThumbnailZpl(null), null);
  assert.equal(await buildThumbnailZpl(Buffer.alloc(0)), null);
  assert.equal(await buildThumbnailZpl('not a buffer'), null);
  assert.equal(await buildThumbnailZpl(Buffer.from('nonsense, not an image')), null);
});

test('the ^GFA header agrees with the payload it declares', async () => {
  const out = await buildThumbnailZpl(await gradient(200, 200));
  const g = parseGfa(out.zpl);

  assert.equal(g.total, g.total2, 'ZPL repeats the byte count; both must match');
  assert.equal(g.bytesPerRow, Math.ceil(out.width / 8));
  assert.equal(g.total, g.bytesPerRow * out.height, 'declared bytes must equal rows × bytes-per-row');
  assert.equal(g.hex.length, g.total * 2, 'hex is exactly two characters per declared byte');
});

test('the image keeps its aspect ratio inside the box, so callers must read width/height back', async () => {
  const wide = await buildThumbnailZpl(await gradient(400, 100), { dots: 104 });
  assert.equal(wide.width, 104);
  assert.ok(wide.height < 104, `a 4:1 image must not be squared off (got ${wide.width}x${wide.height})`);

  const tall = await buildThumbnailZpl(await gradient(100, 400), { dots: 104 });
  assert.equal(tall.height, 104);
  assert.ok(tall.width < 104);
});

test('a small source is enlarged to fill the box, not left tiny', async () => {
  // withoutEnlargement:false — a 40px thumbnail from a channel must still fill
  // 13mm. Blurry at 104 dots beats a 5mm picture nobody can see.
  const out = await buildThumbnailZpl(await gradient(40, 40), { dots: 104 });
  assert.equal(out.width, 104);
  assert.equal(out.height, 104);
});

test('the default box is 13mm at 203dpi', () => {
  assert.equal(DEFAULT_DOTS, 104);
});

// ── the dither itself ─────────────────────────────────────────────────────────

test('pure white lays down no ink and pure black lays down all of it', () => {
  const w = 16, h = 4;
  const white = ditherToBits(new Uint8Array(w * h).fill(255), w, h, 1);
  assert.ok(white.packed.every((b) => b === 0x00), 'white paper must burn nothing');

  const black = ditherToBits(new Uint8Array(w * h).fill(0), w, h, 1);
  assert.ok(black.packed.every((b) => b === 0xff), 'black must burn every dot');
});

test('a midtone field becomes a PATTERN, which is the whole point of dithering', () => {
  // A threshold maps a flat 50% grey to one solid value — all ink or none. Error
  // diffusion has to produce a mix, or it is not doing anything a threshold
  // wasn't already doing.
  const w = 32, h = 32;
  const { packed } = ditherToBits(new Uint8Array(w * h).fill(128), w, h, 1);
  const allSame = packed.every((b) => b === packed[0]);
  assert.ok(!allSame, 'a flat midtone must dither to a mixed pattern, not a solid block');

  let ink = 0;
  for (const b of packed) for (let i = 0; i < 8; i++) if (b & (1 << i)) ink++;
  const ratio = ink / (w * h);
  assert.ok(ratio > 0.2 && ratio < 0.8, `midtone ink coverage should be mid-range, got ${ratio.toFixed(2)}`);
});

test('gain below 1 lifts midtones — less ink, which is the dot-gain compensation', () => {
  const w = 32, h = 32;
  const grey = new Uint8Array(w * h).fill(120);
  const countInk = (p) => { let n = 0; for (const b of p) for (let i = 0; i < 8; i++) if (b & (1 << i)) n++; return n; };

  const plain  = countInk(ditherToBits(grey, w, h, 1).packed);
  const lifted = countInk(ditherToBits(grey, w, h, 0.8).packed);
  assert.ok(lifted < plain, `gain 0.8 must burn fewer dots than gain 1.0 (${lifted} vs ${plain})`);
});

test('rows are byte-padded and error never wraps between them', () => {
  // 12 px = 1.5 bytes → 2 bytes per row. The 4 pad bits must stay clear, or the
  // right edge prints a phantom stripe.
  const w = 12, h = 3;
  const grey = new Uint8Array(w * h).fill(255);
  const { packed, bytesPerRow } = ditherToBits(grey, w, h, 1);
  assert.equal(bytesPerRow, 2);
  assert.equal(packed.length, 6);
  for (let y = 0; y < h; y++) {
    assert.equal(packed[y * bytesPerRow + 1] & 0x0f, 0, 'padding bits must never carry ink');
  }
});

test('the payload can never carry a ZPL control prefix', async () => {
  // `^` and `~` START a ZPL command, so a payload containing either would be
  // parsed as one and silently truncate the rest of the label (this bit us once
  // already, on a hand-rolled escape that stripped `^` but not `~`). Hex output
  // makes that structurally impossible — assert it, so a future "optimisation"
  // to a denser encoding has to confront the question.
  const out = await buildThumbnailZpl(await solid(120, 120, 90), { dots: 104 });
  const { hex } = parseGfa(out.zpl);
  assert.ok(hex.length > 0);
  assert.match(hex, /^[0-9A-F]+$/, 'payload must be plain uppercase hex');
});

// ── EXIF orientation (added the day a phone camera reached this pipeline) ─────
//
// Every picture this rendered before was a file someone made on a desktop, and
// those carry no Orientation tag, so nothing here had to care. A phone does:
// it writes the sensor's pixels plus a tag saying which way is up. Without the
// .rotate() in rasterise(), a portrait photograph of a carton reaches sharp
// lying on its side and prints that way — and the operator's preview, which
// shares rasterise(), would show the same sideways box and look correct.

/** A picture with an unmistakable top: a black band across the top quarter. */
function bandedTop(w, h) {
  const raw = Buffer.alloc(w * h * 3, 255);
  for (let y = 0; y < Math.floor(h / 4); y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      raw[i] = raw[i + 1] = raw[i + 2] = 0;
    }
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

test('an EXIF Orientation tag is obeyed — a phone photo does not print sideways', async () => {
  const upright = await bandedTop(160, 120);

  // Orientation 6 = "the display copy is this, rotated 90° clockwise". So the
  // bytes below, once honoured, must render identically to the same picture
  // rotated by hand and carrying no tag at all.
  const tagged = await sharp(upright).withMetadata({ orientation: 6 }).png().toBuffer();
  const rotatedByHand = await sharp(upright).rotate(90).png().toBuffer();

  const fromTag = await buildThumbnailPreviewPng(tagged, { dots: 136, zoom: 1 });
  const fromPixels = await buildThumbnailPreviewPng(rotatedByHand, { dots: 136, zoom: 1 });
  const ignoringTag = await buildThumbnailPreviewPng(upright, { dots: 136, zoom: 1 });

  assert.ok(fromTag && fromPixels && ignoringTag);
  assert.deepEqual(
    Buffer.compare(fromTag, fromPixels), 0,
    'honouring Orientation 6 must give the same ink as rotating the pixels by hand'
  );
  // The guard that makes the assertion above mean something: if .rotate() were
  // dropped, `fromTag` would collapse onto `ignoringTag` and the test above
  // would still pass against a `fromPixels` that had also stopped rotating.
  assert.notDeepEqual(
    Buffer.compare(fromTag, ignoringTag), 0,
    'the tagged and untagged pictures must NOT render alike — that is the bug'
  );
});

test('the operator preview and the printed ZPL rotate together', async () => {
  // The preview only earns its place by being the same ink. A rotation applied
  // in one renderer and not the other would hand someone an upright preview of
  // a sideways print, which is worse than no preview.
  const upright = await bandedTop(160, 120);
  const tagged = await sharp(upright).withMetadata({ orientation: 6 }).png().toBuffer();
  const rotatedByHand = await sharp(upright).rotate(90).png().toBuffer();

  const a = await buildThumbnailZpl(tagged, { dots: 136 });
  const b = await buildThumbnailZpl(rotatedByHand, { dots: 136 });
  assert.ok(a && b);
  assert.equal(a.zpl, b.zpl, 'the ZPL path must honour Orientation exactly as the preview does');
});

// ── crisp vs dither ──────────────────────────────────────────────────────────

test('crisp lays down NO grey — every pixel is ink or paper, unlike the dither', async () => {
  // The distinction is the whole feature. A midtone field is the case that
  // separates them: the dither must PATTERN it, crisp must resolve it one way.
  const grey = await sharp({ create: { width: 60, height: 60, channels: 3, background: { r: 150, g: 150, b: 150 } } })
    .png().toBuffer();
  const d = await buildThumbnailZpl(grey, { dots: 48 });
  const c = await buildThumbnailZpl(grey, { dots: 48, mode: 'crisp' });
  assert.ok(d && c, 'both modes must render');
  const bits = (z) => {
    const hex = z.zpl.match(/\^GFA,\d+,\d+,\d+,([0-9A-F]+)\^FS/)[1];
    const buf = Buffer.from(hex, 'hex');
    let ones = 0;
    for (const b of buf) for (let i = 0; i < 8; i++) if ((b >> i) & 1) ones++;
    return { ones, total: buf.length * 8 };
  };
  const D = bits(d), C = bits(c);
  // The dither turns a flat midtone into a MIXTURE; crisp turns it into one or
  // the other. Asserting "not all and not none" for the dither and "all or
  // none" for crisp states the contract without pinning either to a count that
  // a gain tweak would move.
  assert.ok(D.ones > 0 && D.ones < D.total, `dither must pattern a midtone, got ${D.ones}/${D.total}`);
  assert.ok(C.ones === 0 || C.ones === C.total, `crisp must resolve a flat midtone one way, got ${C.ones}/${C.total}`);
});

test('an unknown or missing mode renders exactly as today', async () => {
  // A stored value nobody recognises must not change what prints. The dither is
  // the conservative answer because it is what every slip printed before the
  // render mode existed.
  const img = await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 120, g: 120, b: 120 } } })
    .png().toBuffer();
  const base = await buildThumbnailZpl(img, { dots: 40 });
  for (const mode of [undefined, null, '', 'CRISPY', 'nonsense', 42]) {
    const got = await buildThumbnailZpl(img, { dots: 40, mode });
    assert.equal(got.zpl, base.zpl, `mode ${JSON.stringify(mode)} must fall back to the dither`);
  }
  // …and the one value that IS recognised must differ, or the fallback above is
  // asserting nothing.
  const crisp = await buildThumbnailZpl(img, { dots: 40, mode: 'crisp' });
  assert.notEqual(crisp.zpl, base.zpl, 'crisp must actually render differently');
});

test('crisp is case- and space-insensitive, because it round-trips through a query string', async () => {
  const img = await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 120, g: 120, b: 120 } } })
    .png().toBuffer();
  const want = (await buildThumbnailZpl(img, { dots: 40, mode: 'crisp' })).zpl;
  for (const m of [' crisp', 'CRISP', 'Crisp ']) {
    assert.equal((await buildThumbnailZpl(img, { dots: 40, mode: m })).zpl, want, `"${m}" must read as crisp`);
  }
});

test('the PREVIEW honours the mode too — or the operator judges the wrong ink', async () => {
  // The preview and the print share rasterise(); this pins that the mode gets
  // that far. A preview that ignored it would show one rendering and store the
  // other, which is the exact failure the whole preview exists to prevent.
  const img = await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 120, g: 120, b: 120 } } })
    .png().toBuffer();
  const d = await buildThumbnailPreviewPng(img, { dots: 40 });
  const c = await buildThumbnailPreviewPng(img, { dots: 40, mode: 'crisp' });
  assert.ok(d && c);
  assert.ok(!d.equals(c), 'the two modes must produce different preview pixels');
});

test('crisp never inks pure white, whatever the level', async () => {
  // cutToBits uses `<`, not `<=`. At level 255 a `<=` would ink the entire tile
  // — the failure mode is a solid black square, which is what this whole feature
  // exists to avoid, and a level is a hand-editable knob.
  const { cutToBits } = _internals;
  const white = Buffer.alloc(64, 255);
  const { packed } = cutToBits(white, 8, 8, 255);
  assert.ok(packed.every((b) => b === 0), 'pure white must lay down no ink at any level');
});
