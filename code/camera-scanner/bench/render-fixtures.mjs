// Render the bench fixtures, deterministically and offline, and freeze the
// expected payloads by decoding each CLEAN render with the baseline engine —
// current engine behaviour defines "right", never a hand-typed string (a
// hand-copied expectation drifts; a frozen decode cannot).
//
// The source project's first bench rendered the packing-slip ZPL through the
// Labelary web API. This uses bwip-js so the bench needs no network and
// re-renders byte-identically. The symbology and module geometry are what
// matter to the degradation model, and both are preserved: bwip-js `scale` is
// exactly pixels-per-module, mirroring Labelary's dot==pixel at 8dpmm with
// ^BY<n>.
//
// EVERY PAYLOAD BELOW IS SYNTHETIC — a made-up order number, a textbook UPC,
// an invented postal GS1-128 and an invented UDI GTIN+serial. They keep the
// SHAPE of the real classes (symbology, module size, AI structure, check
// digits) without carrying any real identifier.
//
// Run: node bench/render-fixtures.mjs   (rewrites bench/fixtures/)

import { mkdir, writeFile } from 'fs/promises';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import { makeJsEngine } from './engines.mjs';

const req = createRequire(import.meta.url);
const bwipjs = req('bwip-js');
const sharp = (await import('sharp')).default;

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

// pxPerModule: what one module measures in the clean render (bwip scale).
// band: the pixels-per-module range the degradation samples per session.
//   Linear fixtures use the measured false-decode band (1.9–3.7). The
//   DataMatrix band is higher — small glossy UDI squares fail by blur and
//   cell size, not by the thin-bar aliasing that manufactures wrong numbers.
// formatSets: which ScanFormatSets the sweep runs for this fixture. 'all' only
//   where the original measurements exist to compare against (the slip).
const FIXTURES = [
  {
    id: 'slip-m2',
    note: 'packing-slip barcode, old geometry: Code 128 order number, module 2, 8mm — the fabrication case',
    bwip: { bcid: 'code128', text: '12345678', scale: 2, height: 8 },
    pxPerModule: 2,
    band: [1.9, 3.7],
    formatSets: ['all', 'shipping', 'universal'],
  },
  {
    id: 'slip-m3',
    note: 'packing-slip barcode, current geometry: module 3, 10mm — what prints today',
    bwip: { bcid: 'code128', text: '12345678', scale: 3, height: 10 },
    pxPerModule: 3,
    band: [1.9, 3.7],
    formatSets: ['shipping', 'universal'],
  },
  {
    id: 'postal-impb',
    note: 'postal GS1-128: AI(420) ZIP9 + FNC1 + package identifier — the ]C1/GS wire-contract fixture (synthetic digits)',
    bwip: { bcid: 'gs1-128', text: '(420)123456789(92)00123456789012345675', scale: 2, height: 12 },
    pxPerModule: 2,
    band: [1.9, 3.7],
    formatSets: ['shipping', 'universal'],
  },
  {
    id: 'upca-retail',
    note: 'UPC-A retail box code (textbook example digits) — the class the first bench missed; '
      + 'zxing-cpp reports it as EAN-13 with a leading zero, the js engine as 12-digit UPC-A, '
      + 'so comparison runs through payloadKey GTIN padding',
    bwip: { bcid: 'upca', text: '012345678905', scale: 2, height: 10 },
    pxPerModule: 2,
    band: [1.9, 3.7],
    formatSets: ['product', 'universal'],
  },
  {
    id: 'dm-udi',
    note: 'GS1 DataMatrix UDI (synthetic GTIN+serial) — the weak spot of the js engine',
    bwip: { bcid: 'gs1datamatrix', text: '(01)00012345678905(21)DEMO123456', scale: 2 },
    pxPerModule: 2,
    band: [2.5, 6.0],
    formatSets: ['product', 'universal'],
  },
];

await mkdir(OUT, { recursive: true });
const expected = [];

for (const f of FIXTURES) {
  const png = await bwipjs.toBuffer({
    ...f.bwip,
    includetext: false,
    paddingwidth: 12,  // bwip units are mm-ish points; enough quiet zone + rotate margin
    paddingheight: 8,
    backgroundcolor: 'FFFFFF',
  });
  const file = `${f.id}.png`;
  await writeFile(path.join(OUT, file), png);

  // Freeze expectation from the baseline engine on the clean render.
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const clean = { data: new Uint8ClampedArray(data), width: info.width, height: info.height };
  const primarySet = f.formatSets.find((s) => s !== 'all') ?? 'all';
  const hit = makeJsEngine(primarySet).decode(clean);
  if (!hit) throw new Error(`${f.id}: baseline engine cannot decode its own clean render — fixture unusable`);

  expected.push({
    id: f.id,
    file,
    note: f.note,
    pxPerModule: f.pxPerModule,
    band: f.band,
    formatSets: f.formatSets,
    expectedPayload: hit.payload,
    expectedFormat: hit.format,
  });
  console.log(`${f.id}: ${info.width}x${info.height}  ${hit.format}  ${JSON.stringify(hit.payload)}`);
}

await writeFile(path.join(OUT, 'expected.json'), `${JSON.stringify(expected, null, 2)}\n`);
console.log(`\nWrote ${expected.length} fixtures + expected.json to ${OUT}`);
