// How small can a printed label get in the camera frame before it stops being
// accepted? Sweeps px/module through the bench's own degradation model and
// decodes with the production wasm engine + the 'universal' format set.
//
// Built to decide a Code 128 -> DataMatrix swap on the shelf-label renderer,
// and kept so the numbers in that renderer's comments can be re-derived
// instead of trusted.
//
//   node bench/sweep-shelf.mjs <manifest.json>
//
// Manifest: [{ id, file, nativePx, moduleMm, labelIn, want }, ...]
//   nativePx  px per module in the render (at 8dpmm, 1 px = 1 printer dot, so
//             this is the ^BY module width or the ^BX magnification)
//   moduleMm  the printed module — nativePx / 203 * 25.4
//   labelIn   media WIDTH in inches
//   want      the payload a correct decode returns
//
// TWO NUMBERS, because they answer different questions:
//
//   FRAME    per-frame decode rate — one look, one answer.
//   SESSION  the real <CameraScanner> accept policy: 2 agreeing frames in a row
//            somewhere in a session of FRAMES looks. This is what an operator
//            experiences.
//
// THESE FIXTURES ARE WHOLE LABELS, NOT CROPPED SYMBOLS, and that is the one
// thing to hold on to when comparing against a cropped-symbol table, which can
// find the opposite ordering. The decoder here must LOCATE the symbol among
// the text before it can read it, and the degrade model scales the ENTIRE
// label to hit the target px/module — so a 3x2 sticker at 2.5 px/module is a
// 138px-wide image of a whole sticker, not a tight crop of a square. Measured
// both ways, the accept policy is NOT what separates the two tables:
// DataMatrix trails Code 128 per px/module here under the per-frame AND the
// 2-in-a-row policy. The localisation task is the remaining difference.
// Neither table is wrong; they measure different jobs, and this one is the
// shelf label's job.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { makeRng, makeSession, renderFrame } from './degrade.mjs';
import { makeWasmEngine } from './engines.mjs';

const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error('usage: node bench/sweep-shelf.mjs <manifest.json>');
  process.exit(2);
}
const CASES = JSON.parse(await readFile(manifestPath, 'utf8'));
const BASE = path.dirname(path.resolve(manifestPath));

const STEPS = [1.5, 2, 2.5, 3, 4, 5, 6, 8];
const SESSIONS = Number(process.env.S || 30);
const FRAMES = Number(process.env.F || 6);
const ACCEPT = 0.95;

/** The production accept policy: N agreeing frames in a row. */
function acceptedBy(seq, needed) {
  let run = 0; let last = null;
  for (const p of seq) {
    if (p && p === last) run += 1; else { run = p ? 1 : 0; last = p; }
    if (p && run >= needed) return p;
  }
  return null;
}

const eng = await makeWasmEngine('universal');
const out = [];
for (const c of CASES) {
  const png = await readFile(path.resolve(BASE, c.file));
  const row = { ...c, cells: [] };
  for (const px of STEPS) {
    const rng = makeRng(97 * STEPS.indexOf(px) + c.id.length);
    let frameOk = 0; let frames = 0; let sessOk = 0; let sessWrong = 0;
    for (let s = 0; s < SESSIONS; s += 1) {
      const sess = makeSession(rng, [px, px]);
      const seq = [];
      for (let i = 0; i < FRAMES; i += 1) {
        const hit = await eng.decode(await renderFrame(png, c.nativePx, sess, rng, 120));
        seq.push(hit?.payload ?? null);
        frames += 1;
        if (hit?.payload === c.want) frameOk += 1;
      }
      const accepted = acceptedBy(seq, 2);
      if (accepted === c.want) sessOk += 1;
      else if (accepted) sessWrong += 1;
    }
    row.cells.push({ px, frame: frameOk / frames, session: sessOk / SESSIONS, wrong: sessWrong });
  }
  const moduleIn = c.moduleMm / 25.4;
  const pass = row.cells.filter((x) => x.session >= ACCEPT).map((x) => x.px);
  row.minPx = pass.length ? Math.min(...pass) : null;
  // px/module = (1920 * frac / labelIn) * moduleIn, solved for frac.
  row.minFrac = row.minPx ? (row.minPx * c.labelIn) / (1920 * moduleIn) : null;
  out.push(row);
  console.error(`done ${c.id}`);
}

const W = Math.max(...out.map((r) => r.id.length)) + 2;
for (const metric of ['frame', 'session']) {
  console.log(`\n${metric === 'frame' ? 'PER-FRAME' : `SESSION (2 in a row of ${FRAMES})`} — px/module →`);
  console.log(''.padEnd(W) + STEPS.map((s) => String(s).padStart(7)).join(''));
  for (const r of out) {
    console.log(r.id.padEnd(W) + r.cells
      .map((c) => (`${(c[metric] * 100).toFixed(0)}%` + (metric === 'session' && c.wrong ? '!' : '')).padStart(7))
      .join(''));
  }
}
console.log(`\n${'label'.padEnd(W)}${'module'.padStart(9)}${`  accepts@${ACCEPT * 100}% from`.padStart(21)}   label may shrink to`);
for (const r of out) {
  console.log(r.id.padEnd(W) + `${r.moduleMm.toFixed(3)}mm`.padStart(9)
    + (r.minPx ? `${r.minPx} px/mod` : 'never').padStart(21)
    + (r.minFrac ? `   ${(r.minFrac * 100).toFixed(1)}% of frame width` : '   —'));
}
console.log('\n`!` marks a cell where a WRONG payload was accepted.');
