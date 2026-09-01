'use strict';
// Run: npx tsx --test zplTextMetrics.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  glyphAdvance, textWidthRatio, estimateWrapLines,
  wrapTextToLines, shrinkFontToFitLines, alignOffset,
  code128Modules, fitBarcodeModuleW,
  dataMatrixModules, fitDataMatrixMagnification,
  TITLE_WRAP_SAFETY, TITLE_MAX_LINES,
} from './zplTextMetrics.ts';

// Invented order ids that keep the real formats: Marketplace A ships a 19-char
// 3-7-7 hyphenated id, Marketplace B an 8-digit cart number, Marketplace C a
// 14-char hyphenated id. (Real ids from the production fixtures are not
// reproduced here; only the LENGTHS and character classes matter to the model.)
const ID_19 = '111-2345678-9012345';
const ID_8 = '60123457';
const ID_14 = '13-04567-89012';

// ── Code 128 width ──────────────────────────────────────────────────────────
// The anchor measurement, not the model's own arithmetic: Labelary at 8dpmm
// rendered a 19-char id as 244 modules (488 dots at module 2), i.e. one
// symbol per character with no subset-C collapse of its 7-digit runs. If a
// future ZPL/firmware change makes ^BC pack numerics, this test is where it
// should be re-measured — do not "optimize" the model without a fresh render.
test('code128Modules matches the measured Labelary width (one symbol per character)', () => {
  assert.equal(code128Modules(ID_19), 244);
  assert.equal(code128Modules(ID_8), 123);
  assert.equal(code128Modules(''), 0);
  assert.equal(code128Modules(null), 0);
});

test('fitBarcodeModuleW keeps the declared module when the value fits', () => {
  // 8-digit cart number at module 2 = 246 dots, inside a 292-dot (36.5mm) slot.
  assert.equal(fitBarcodeModuleW(ID_8, 292, 2), 2);
  // Never widens past the design's module, however much room there is.
  assert.equal(fitBarcodeModuleW(ID_8, 4000, 2), 2);
});

test('fitBarcodeModuleW shrinks rather than letting the bars overrun their box', () => {
  const width = 364;                                   // 45.5mm at 203dpi
  const fitted = fitBarcodeModuleW(ID_19, width, 2);
  assert.equal(fitted, 1, 'module 2 would need 488 dots — more than the lane holds');
  assert.ok(code128Modules(ID_19) * fitted <= width, 'fitted symbol fits the lane');
});

test('fitBarcodeModuleW floors at the minimum instead of returning an undrawable 0', () => {
  // Pathological: wider than any module can fit. A hard-to-scan barcode still
  // beats one printed through the neighbouring box, and beats encoding a
  // different id than the one printed beside it.
  assert.equal(fitBarcodeModuleW('X'.repeat(80), 100, 2), 1);
  assert.equal(fitBarcodeModuleW(ID_8, 0, 2), 2, 'no width budget -> leave the design alone');
});

// The values are MEASURED (printed calibration target), not chosen. Pinning
// them is the point: they were guesses for a year and the guess was 2.6x out on
// the hyphen.
test('glyphAdvance weights wide, narrow, and default glyphs apart', () => {
  assert.equal(glyphAdvance('M'), 0.757);
  assert.equal(glyphAdvance('i'), 0.258);
  assert.equal(glyphAdvance('A'), 0.553);
  assert.equal(glyphAdvance('5'), 0.480);
  assert.equal(glyphAdvance(' '), 0.295);
});

// THE TABLE IS PER-CHARACTER, NOT BUCKETED, and this is the assertion that stops
// it being re-bucketed by someone tidying up. A single "all caps" value is wrong
// for most caps — real ^A0 runs J 0.442 to W 0.812 — and the error is unbounded
// on a string that is all of one kind. That is not hypothetical: a caps-bucketed
// table under-scored N/U/H by 10% and rendered an all-caps manufacturer name
// like "SHENZHEN DONGGUAN HUANGHUA NHU GROUP" past a box it called 97% full.
test('caps are measured individually, not averaged into one bucket', () => {
  assert.equal(glyphAdvance('J'), 0.442, 'the narrowest cap');
  assert.equal(glyphAdvance('W'), 0.812, 'the widest cap');
  assert.equal(glyphAdvance('N'), 0.608);
  assert.equal(glyphAdvance('U'), 0.608);
  assert.equal(glyphAdvance('H'), 0.608);
  const spread = glyphAdvance('W') / glyphAdvance('J');
  assert.ok(spread > 1.8, `caps span ${spread.toFixed(2)}x — one bucket cannot cover that`);
});

// An unmeasured character must be reserved WIDE, never averaged. The two
// failure directions are not symmetric: over-reserving costs a line of label,
// under-reserving prints through the QTY column.
test('an unmeasured character reserves wide rather than average', () => {
  const unknown = glyphAdvance('中');
  assert.ok(unknown >= 0.62, `unknown glyph reserved ${unknown}`);
  assert.ok(unknown > glyphAdvance('a') && unknown > glyphAdvance('A'),
    'the default must exceed the common letters, not sit among them');
});

// THE HYPHEN IS ITS OWN ASSERTION because it is the one that was most wrong and
// the one a product catalogue is full of: 800 of 1,493 titles shipped in 30 days
// contain one, it was scored 0.34 inside the `ftr()[]{}-/` class, and it really
// measures ~0.9 — confirmed on PAPER by page 4 of the calibration target, whose
// A/0/. controls landed exactly on their measured values. En- and em-dash match
// it. A regression here silently under-measures half the catalogue.
test('the dash family carries its measured width, not the narrow-punctuation guess', () => {
  assert.equal(glyphAdvance('-'), 0.903);
  assert.equal(glyphAdvance('–'), 0.903);
  assert.equal(glyphAdvance('—'), 0.903);
  assert.ok(glyphAdvance('-') > glyphAdvance('A'), 'a hyphen is WIDER than a capital in ^A0');
  // Inch marks are the other volume case — the highest-volume products here are
  // sterilization pouches distinguished by nothing but their printed size.
  assert.equal(glyphAdvance('"'), 0.480);
});

test('textWidthRatio sums per-glyph advances', () => {
  assert.equal(Number(textWidthRatio('MM').toFixed(3)), 1.514);
  assert.equal(textWidthRatio(''), 0);
  assert.equal(textWidthRatio(null), 0);
});

test('estimateWrapLines returns 1 for text that fits one line', () => {
  assert.equal(estimateWrapLines('SHORT', 100, 4), 1);
});

test('estimateWrapLines wraps at word boundaries', () => {
  // cap = 20/4 = 5 fontUnits per line. "AAAA" ~ 2.32, so ~2 words per line.
  const lines = estimateWrapLines('AAAA AAAA AAAA AAAA', 20, 4, 99);
  assert.ok(lines > 1, `expected multi-line, got ${lines}`);
});

test('estimateWrapLines is unit-agnostic — same ratio, same answer', () => {
  const inMm   = estimateWrapLines('SOME PRODUCT NAME HERE', 50, 3, 99);
  const inDots = estimateWrapLines('SOME PRODUCT NAME HERE', 400, 24, 99); // 8x both
  assert.equal(inMm, inDots);
});

test('estimateWrapLines caps at maxLines', () => {
  const long = 'WORD '.repeat(200);
  assert.equal(estimateWrapLines(long, 20, 4, 3), 3);
});

test('estimateWrapLines defaults maxLines to TITLE_MAX_LINES', () => {
  const long = 'WORD '.repeat(200);
  assert.equal(estimateWrapLines(long, 20, 4), TITLE_MAX_LINES);
});

test('constants keep their documented values', () => {
  // 0.97, not the 0.90 it once was. The old value was not slack: it was
  // covering a p99 error of 10.4% that a handful of mis-scored characters
  // created, and one real line already broke through it. With the table
  // measured, 3% is the spread actually observed on real boundary lines.
  assert.equal(TITLE_WRAP_SAFETY, 0.97);
  assert.equal(TITLE_MAX_LINES, 6);
});

// ── wrapTextToLines: the renderer's line break, now that WE own it ──────────
// estimateWrapLines predicts how many lines ^FB WOULD use; wrapTextToLines
// produces the lines the renderer actually draws. They are two implementations
// of one greedy algorithm, so these tests are what stop them drifting.

// Invented titles that keep the character-class shapes of the production corpus
// (dash-heavy, inch marks, all-caps runs, unbroken long words, bare digits).
const WRAP_CORPUS = [
  'Meadowlark Flow FO2 - Low Viscosity A1 Syringe - Flowable Repair Material, 1 - 2',
  'MAPPED TO: Prep-Rite(TM) Surface Etching Gel - 38% Acid Solution Jumbo Refill: 2x25 mL (69 gm)',
  'MAPPED TO: Tempshape Two-Part Temporary Molding Material - 10:1 Cartridge of 50 mL Refill',
  'Example Brand Ultra Polishing Angle Handpiece, 1/Pk',
  'Self-Sealing Sterilization Pouch 5.25" x 11"',
  'Hybrid Points FG #557 Grinding Tip, 4 mm Head Length 1/Pk. Regular Grit',
  'A',
  'SUPERCALIFRAGILISTICEXPIALIDOCIOUSANDTHENSOMEMOREWITHOUTANYSPACESATALL',
  'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW',
  'TOTAL PIECES', 'PAGE 1/1', '* LOW', '200', '1000', '24000',
];
// The box widths this engine actually renders wrapping text into. The narrow
// gutters (80/112) are excluded on purpose — they only ever hold 1-5 characters,
// and forcing prose through them is where the two implementations legitimately
// diverge (the estimate's `cur -= cap` arithmetic vs real carved chunks).
const WRAP_WIDTHS = [298, 494, 616, 756, 812];
const WRAP_FONTS = [19, 20, 22, 28, 33, 35];

test('wrapTextToLines never loses a character', () => {
  const strip = (s) => s.replace(/\s/g, '');
  for (const s of WRAP_CORPUS) {
    for (const w of [...WRAP_WIDTHS, 80, 112]) {
      for (const f of WRAP_FONTS) {
        const joined = strip(wrapTextToLines(s, w, f).join(''));
        assert.equal(joined, strip(s),
          `w=${w} f=${f} lost characters from ${JSON.stringify(s.slice(0, 40))}`);
      }
    }
  }
});

test('wrapTextToLines agrees with estimateWrapLines at every width the engine uses', () => {
  for (const s of WRAP_CORPUS) {
    for (const w of WRAP_WIDTHS) {
      for (const f of WRAP_FONTS) {
        assert.equal(wrapTextToLines(s, w, f).length, estimateWrapLines(s, w, f, 9999),
          `w=${w} f=${f}: render and reserve disagree on ${JSON.stringify(s.slice(0, 40))}`);
      }
    }
  }
});

// ── the LABEL engine's reservation invariant ────────────────────────────────
// The product-label engine reserves lines with `estimateWrapLines(text, W *
// TITLE_WRAP_SAFETY, f)` and then emits `^FB${W},${lines}` — the printer wraps
// at FULL width. A MULTI-line ^FB does not truncate its overflow, it OVERWRITES
// the last line (see the block comment in zplTextMetrics.ts), so if the
// reservation is ever SMALLER than what the printer draws, a product label
// stamps its tail on its own last line. Nothing asserted that invariant until a
// review pointed out that raising the shared TITLE_WRAP_SAFETY from 0.90 to
// 0.97 cut that engine's margin from 10% to 3% — a margin the then-bucketed
// table could exceed. The table is measured now and the margin holds, but the
// invariant is what actually makes it safe, so assert the invariant rather
// than the constant.
test('the label engine can never reserve fewer lines than the printer draws', () => {
  // Usable widths across the label sizes the label engine renders (1.5x1 ..
  // 4x6) and the fonts its scale ladder reaches.
  for (const s of WRAP_CORPUS) {
    for (const w of [240, 355, 560, 760, 790]) {
      for (const f of [18, 22, 26, 30, 36, 44, 56]) {
        const reserved = estimateWrapLines(s, w * TITLE_WRAP_SAFETY, f, Number.MAX_SAFE_INTEGER);
        const drawn = wrapTextToLines(s, w, f).length;
        assert.ok(reserved >= drawn,
          `w=${w} f=${f}: reserved ${reserved} < drawn ${drawn} — ^FB would overwrite on ${JSON.stringify(s.slice(0, 40))}`);
      }
    }
  }
});

test('every wrapped line fits the box it was wrapped into', () => {
  for (const s of WRAP_CORPUS) {
    for (const w of WRAP_WIDTHS) {
      for (const f of WRAP_FONTS) {
        for (const line of wrapTextToLines(s, w, f)) {
          assert.ok(textWidthRatio(line) * f <= w,
            `w=${w} f=${f}: line "${line}" measures ${(textWidthRatio(line) * f).toFixed(0)} dots`);
        }
      }
    }
  }
});

test('shrinkFontToFitLines meets a line budget by shrinking, never by dropping words', () => {
  const long = WRAP_CORPUS[1];
  // At 616/28 this already fits 2 lines, so 2 would not bind. Ask for 1.
  assert.equal(wrapTextToLines(long, 616, 28).length, 2, 'premise: it is a 2-line string here');
  const f = shrinkFontToFitLines(long, 616, 28, 1, 0);
  assert.ok(f < 28, `it must shrink to force a 2-line string onto 1 line, got ${f}`);
  assert.ok(wrapTextToLines(long, 616, f).length <= 1, 'and the result must actually fit the budget');
  const strip = (s) => s.replace(/\s/g, '');
  assert.equal(strip(wrapTextToLines(long, 616, f).join('')), strip(long), 'with every character intact');
});

test('shrinkFontToFitLines respects its floor rather than shrinking without limit', () => {
  const f = shrinkFontToFitLines(WRAP_CORPUS[1], 616, 28, 1, 20);
  assert.ok(f >= 20, `floor must win, got ${f}`);
});

// ── alignOffset — the arithmetic ZPL will not do without ^FB ────────────────
test('alignOffset centres and right-aligns, and never returns a negative offset', () => {
  assert.equal(alignOffset('X', 100, 10, 'L'), 0, 'left is always flush');
  assert.equal(alignOffset('II', 100, 10, 'C'), (100 - textWidthRatio('II') * 10) / 2);
  assert.equal(alignOffset('II', 100, 10, 'R'), 100 - textWidthRatio('II') * 10);
  // A string WIDER than its box starts at the box edge, never to the left of it
  // — an overrun must be visible, not shifted off the label.
  assert.equal(alignOffset('WWWWWWWWWWWWWWWWWWWW', 10, 10, 'C'), 0);
  assert.equal(alignOffset('WWWWWWWWWWWWWWWWWWWW', 10, 10, 'R'), 0);
});

// ── DataMatrix reservation ───────────────────────────────────────────────────
// The ANCHOR is the real ^BX render, not this model's arithmetic: measured
// through Labelary at 8dpmm, ECC200 sizes the real id shapes at 10 modules
// (5-char), 12 (8-digit), 14 (13/15-digit) and 16 (14-char and 19-char). The
// model deliberately reserves MORE than that — it assumes one codeword per
// character, where ASCII encoding packs a pair of consecutive digits into one.
// If a future ^BX/firmware change makes the real symbol LARGER than these
// numbers, this is where to re-measure.
test('dataMatrixModules reserves at least what ^BX actually renders', () => {
  // [id, modules ^BX really used]. The model must be >= each, never below.
  const MEASURED = [
    ['13267', 10],
    [ID_8, 12],
    ['5678901234567', 14],
    [ID_14, 16],
    ['104567890123456', 14],
    [ID_19, 16],
  ];
  for (const [id, real] of MEASURED) {
    const reserved = dataMatrixModules(id);
    assert.ok(reserved >= real,
      `${id}: reserved ${reserved} modules is UNDER the ${real} ^BX renders — `
      + 'under-reservation prints the symbol past its box');
  }
  assert.equal(dataMatrixModules(''), 0);
  assert.equal(dataMatrixModules(null), 0);
});

test('dataMatrixModules climbs the ECC200 ladder and never returns a non-square size', () => {
  const LADDER = [10, 12, 14, 16, 18, 20, 22, 24, 26, 32, 36, 40, 44, 48, 52];
  let prev = 0;
  for (let len = 1; len <= 200; len += 1) {
    const m = dataMatrixModules('X'.repeat(len));
    assert.ok(LADDER.includes(m), `length ${len} produced ${m}, not an ECC200 square size`);
    assert.ok(m >= prev, `length ${len} produced ${m}, smaller than length ${len - 1}'s ${prev}`);
    prev = m;
  }
});

test('fitDataMatrixMagnification never lets the reserved square overflow its box', () => {
  for (const id of ['13267', ID_8, ID_14, ID_19, 'X'.repeat(60)]) {
    for (const box of [40, 80, 128, 142, 200, 400]) {
      const mag = fitDataMatrixMagnification(id, box, 10);
      assert.ok(mag >= 1, `${id} @ ${box}: magnification must stay drawable`);
      // The floor is a last resort: below it we accept an overflow rather than
      // an undrawable 0, exactly like fitBarcodeModuleW. Assert the fit holds
      // wherever the box can actually contain the symbol at the floor.
      if (dataMatrixModules(id) * 2 <= box) {
        assert.ok(dataMatrixModules(id) * mag <= box,
          `${id} @ ${box} dots: ${dataMatrixModules(id)} x ${mag} overflows`);
      }
    }
  }
});

test('fitDataMatrixMagnification honours the declared ceiling and leaves a no-budget box alone', () => {
  // Never widens past the design's magnification, however much room there is.
  assert.equal(fitDataMatrixMagnification(ID_8, 4000, 10), 10);
  assert.equal(fitDataMatrixMagnification(ID_8, 0, 10), 10, 'no width budget -> leave the design alone');
});
