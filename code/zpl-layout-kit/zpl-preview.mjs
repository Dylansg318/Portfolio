#!/usr/bin/env node
/**
 * ZPL "render-and-look" loop.
 *
 * The problem this solves: editing a ZPL document engine (wrapping, pagination,
 * card geometry) is otherwise done BLIND — you change a constant, push, print,
 * and only then see if it collided or truncated. This harness renders fixtures
 * that cover the hard cases, then sends each page to the public Labelary API at
 * 8dpmm (203 dpi — typical desktop-Zebra resolution) and writes PNGs you (or an
 * AI agent) can open and iterate against. No server, no DB, no auth — the
 * render chain is pure.
 *
 * In the private repo this drives the full JSON-layout→ZPL packing-slip engine;
 * here it drives a compact DEMO renderer (below) built on the same primitives —
 * zplTextMetrics for wrapping/fitting, docLayoutSchema for mm→dots — so the
 * loop itself is fully runnable. The fixtures keep the shapes that break ZPL
 * layouts: pathological titles, deep pagination, and the long order id whose
 * barcode wants to overrun its lane.
 *
 * Run with a TS-aware loader (the kit's modules are .ts):
 *   npx tsx zpl-preview.mjs                    # render every fixture
 *   npx tsx zpl-preview.mjs --fixture wrap     # one fixture
 *   npx tsx zpl-preview.mjs --list             # list fixtures
 *   npx tsx zpl-preview.mjs --out /tmp/foo --dpmm 12dpmm --no-lint
 *
 * Fixtures (the cases that break ZPL layouts):
 *   short         2 items, single page, nothing tricky
 *   wrap          pathological multi-line titles (3-line wrap, hard-wrapped long words)
 *   paginate      20 items — stress pagination across multiple pages
 *   orderid-long  19-char marketplace order id — the barcode module-width fit canary
 *
 * Labelary is a free public service: be polite. The free tier allows roughly
 * 3 requests/second, so the loop sleeps between pages and backs off on 429.
 *
 * Output: <out>/<fixture>-pN.png  +  <out>/<fixture>.zpl
 */

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

import { mmToDots, DEFAULT_PAGE } from './docLayoutSchema.ts';
import { ZPL_PRINT_QUALITY } from './zplPrintQuality.ts';
import {
  wrapTextToLines, shrinkFontToFit, shrinkFontToFitLines,
  alignOffset, fitBarcodeModuleW, code128Modules, textWidthRatio,
} from './zplTextMetrics.ts';

const LABELARY_BASE = 'http://api.labelary.com/v1/printers';

// ── CLI args ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (flag, def) => { const i = argv.indexOf(flag); return i >= 0 && argv[i + 1] ? argv[i + 1] : def; };
const has = (flag) => argv.includes(flag);
const OUT = path.resolve(arg('--out', path.join(os.tmpdir(), 'zpl-previews')));
const DPMM = arg('--dpmm', '8dpmm');           // 8dpmm = 203dpi (typical hardware); 12dpmm = 300dpi
const ONLY = arg('--fixture', null);
const DO_LINT = !has('--no-lint');

// The Labelary page size must match the LAYOUT, not a hardcoded 4x6 — a layout
// sized to measured stock (e.g. 160mm tall) rendered into a 6.00in preview
// silently clips the bottom band off, which is exactly the kind of thing this
// harness exists to stop you doing blind.
const sizeForLayout = (layout) =>
  `${+((layout.pageWidthMm / 25.4).toFixed(2))}x${+((layout.pageHeightMm / 25.4).toFixed(2))}`;

// ── Demo renderer ───────────────────────────────────────────────────────────
// A deliberately small packing-slip engine that exercises every primitive in
// zplTextMetrics the way the production renderer does:
//   · the order-id barcode is FITTED, not trusted — ^BC has no ^FB and clips
//     nothing, so a long id would otherwise print through the TOTAL box
//   · titles wrap through wrapTextToLines (bare ^FD per line, no ^FB — the
//     firmware's centred/narrow ^FB path is the one it abandons under a burst)
//   · the qty column shrinks its font via shrinkFontToFit instead of letting a
//     single-line overflow stamp its tail on its head (qty 200 → a bold "20")
//   · footers centre through alignOffset — the arithmetic ZPL will not do
//     without ^FB
// It paginates by advancing a cursor and starting a new page when the next card
// cannot fit above the footer band.
function renderDemoSlip({ order, shipTo, shipFrom, items }, layout = DEFAULT_PAGE) {
  const dpi = layout.dpi;
  const d = (mm) => mmToDots(mm, dpi);
  const PW = d(layout.pageWidthMm);          // 812 dots at 4in/203dpi
  const PH = d(layout.pageHeightMm);         // 1218 dots at 6in/203dpi
  const M = d(4);                            // page margin
  const CONTENT_W = PW - 2 * M;
  const FOOTER_H = d(8);

  const esc = (s) => String(s == null ? '' : s).replace(/[\^~\\]/g, ' ');
  const text = (x, y, f, s) => `^FO${Math.round(x)},${Math.round(y)}^A0N,${f},${f}^FD${esc(s)}^FS`;
  // A horizontal rule is a box of height = thickness: ^GB clamps a 0 height up
  // to the border width and Labelary's linter flags it, so state it explicitly.
  const rule = (x, y, w, t = 2) => `^FO${Math.round(x)},${Math.round(y)}^GB${Math.round(w)},${t},${t}^FS`;

  // ── header (page 1 only) ──────────────────────────────────────────────────
  const header = () => {
    let z = '';
    let y = M;
    z += text(M, y, 34, 'PACKING SLIP');
    // TOTAL box, right side — the thing the barcode must never print through.
    const totalLabel = 'TOTAL';
    const totalVal = String(items.reduce((n, it) => n + (it.qty || 0), 0));
    const boxW = d(18);
    z += `^FO${PW - M - boxW},${y}^GB${boxW},${d(14)},2^FS`;
    z += text(PW - M - boxW + d(2), y + d(1.5), 20, totalLabel);
    // A qty of unbounded digits shrinks rather than overflowing its box.
    const qf = Math.round(shrinkFontToFit(totalVal, boxW - d(4), 44, 20));
    z += text(PW - M - boxW + d(2) + alignOffset(totalVal, boxW - d(4), qf, 'C'), y + d(5.5), qf, totalVal);
    y += d(9);
    z += text(M, y, 24, `ORDER ${order.channel_order_id}`);
    y += d(5);
    z += text(M, y, 20, `DATE ${order.order_date}`);
    y += d(5);

    // The order-id barcode. The lane runs from the left margin to the TOTAL
    // box; fitBarcodeModuleW shrinks the module width rather than letting the
    // bars overrun (Code 128 draws as wide as the data needs — nothing clips).
    const lane = PW - 2 * M - boxW - d(4);
    const moduleW = fitBarcodeModuleW(order.channel_order_id, lane, 2);
    const barW = code128Modules(order.channel_order_id) * moduleW;
    if (barW <= lane) {
      z += `^FO${M},${y}^BY${moduleW},3,${d(11)}^BCN,${d(11)},N,N,N^FD${esc(order.channel_order_id)}^FS`;
      y += d(13);
    } else {
      // Even module 1 can't fit the lane: give the id its own full-width row
      // instead of printing through the neighbour. (The production engine does
      // exactly this for 19-char marketplace ids.)
      y += d(1);
      const fullModule = fitBarcodeModuleW(order.channel_order_id, CONTENT_W, 3);
      const fullW = code128Modules(order.channel_order_id) * fullModule;
      z += `^FO${Math.round(M + (CONTENT_W - fullW) / 2)},${y}^BY${fullModule},3,${d(11)}^BCN,${d(11)},N,N,N^FD${esc(order.channel_order_id)}^FS`;
      y += d(14);
    }

    // Ship-to / ship-from, two columns of bare ^FDs.
    const lines = (blk) => [blk.name, blk.addr1, blk.addr2, `${blk.city}, ${blk.state} ${blk.zip}`].filter(Boolean);
    let yy = y;
    z += text(M, yy, 20, 'SHIP TO:'); yy += d(4);
    for (const ln of lines(shipTo)) { z += text(M, yy, 22, ln); yy += d(4.2); }
    let y2 = y;
    const fromX = M + Math.round(CONTENT_W * 0.55);
    z += text(fromX, y2, 20, 'FROM:'); y2 += d(4);
    for (const ln of lines(shipFrom)) { z += text(fromX, y2, 18, ln); y2 += d(3.6); }
    y = Math.max(yy, y2) + d(2);
    z += rule(M, y, CONTENT_W, 3);
    return { zpl: z, y: y + d(2) };
  };

  // ── one item card ─────────────────────────────────────────────────────────
  // Measured first (so pagination can ask "does it fit?"), drawn second.
  const card = (it, x, y, draw) => {
    const qtyW = d(12);
    const titleW = CONTENT_W - qtyW - d(2);
    const titleFont = Math.round(shrinkFontToFitLines(it.name, titleW, 28, 3, 20));
    const lines = wrapTextToLines(it.name, titleW, titleFont);
    const lineH = Math.round(titleFont * 1.15);
    let h = lines.length * lineH + d(1);
    h += d(4.5);                                        // detail row
    h += d(2.5);                                        // rule + gap
    if (!draw) return h;

    let z = '';
    // QTY gutter: single-line, so the font must SHRINK to fit — a one-line ^FB
    // does not truncate overflow, it overwrites (qty 200 → a bold "20").
    const qv = String(it.qty);
    const qf = Math.round(shrinkFontToFit(qv, qtyW, 40, 18));
    z += text(x + alignOffset(qv, qtyW, qf, 'C'), y, qf, qv);
    // Title: bare ^FD per wrapped line — we own the line break, not ^FB.
    let yy = y;
    for (const ln of lines) { z += text(x + qtyW + d(2), yy, titleFont, ln); yy += lineH; }
    yy = Math.max(yy, y + d(6)) + d(1);
    const detail = [`SKU: ${it.sku}`, it.location ? `LOC: ${it.location}` : null].filter(Boolean).join('   ');
    z += text(x + qtyW + d(2), yy, 20, detail);
    yy += d(4.5);
    z += rule(x, yy, CONTENT_W, 1);
    return { zpl: z, h };
  };

  // ── paginate ──────────────────────────────────────────────────────────────
  const pages = [];
  let body = '';
  let y = 0;
  const bottom = PH - M - FOOTER_H;
  const newPage = () => { pages.push(body); body = ''; y = M; };

  const h0 = header();
  body += h0.zpl;
  y = h0.y;
  for (const it of items) {
    const need = card(it, M, y, false);
    if (y + need > bottom) newPage();
    const drawn = card(it, M, y, true);
    body += drawn.zpl;
    y += drawn.h;
  }
  pages.push(body);

  // ── assemble, with a centred PAGE n/m footer per page ─────────────────────
  return pages.map((p, i) => {
    const label = `PAGE ${i + 1}/${pages.length}`;
    const fx = M + alignOffset(label, CONTENT_W, 22, 'C');
    return `^XA${ZPL_PRINT_QUALITY}^PW${PW}^LL${PH}${p}`
      + text(fx, PH - M - d(5), 22, label)
      + '^XZ';
  }).join('\n');
}

// ── Fixtures ────────────────────────────────────────────────────────────────
// All names, addresses, and order ids are INVENTED. `channel_order_id` is the
// id the marketplace and the customer know — distinct from any internal
// auto-increment, which never appears on a printed document.
const SHIP_TO = { name: 'Alex Morgan', addr1: 'Example Clinic', addr2: '450 Commerce Way', city: 'Springfield', state: 'IL', zip: '62701' };
const SHIP_FROM = { addr1: '100 Industrial Pkwy, Suite 200', addr2: '', city: 'Springfield', state: 'IL', zip: '62703' };

const item = (qty, name, sku, loc = '') => ({ qty, name, sku, location: loc });

const baseOrder = (over = {}) => ({
  channel_order_id: '13-04567-89012',   // 14-char hyphenated marketplace id
  order_date: '2026-05-12',
  ...over,
});

const FIXTURES = {
  short: {
    desc: '2 items, single page, nothing tricky',
    order: baseOrder({ channel_order_id: '60123457' }),
    shipTo: SHIP_TO, shipFrom: SHIP_FROM,
    items: [
      item(1, 'Cotton Rolls #2 Medium Non-Sterile box of 2000', '110-0042', 'A-01-01'),
      item(4, 'Disposable Bibs 3-Ply Blue 500 count', '110-0099', 'A-01-02'),
    ],
  },
  wrap: {
    desc: 'pathological multi-line titles (forces 3-line wrap + hard-wrapped long words)',
    order: baseOrder(),
    shipTo: SHIP_TO, shipFrom: SHIP_FROM,
    items: [
      item(1, 'Premium Self-Etching Light-Cure Nano-Hybrid Universal Repair System Intro Kit with Bonding Agent and Shade Guide', '900-0001', 'C-12-04 BACK STOCKROOM SECOND SHELF FROM TOP'),
      item(2, 'Handpiecereplacementcartridgeassemblyimpossiblylongsingleword', '900-0002', 'D-02-01'),
      item(200, 'Micro Applicator Brushes Regular Blue Box of 400', '220-0311', 'A-03-07'),
    ],
  },
  paginate: {
    desc: '20 items — stress pagination across multiple pages',
    order: baseOrder({ channel_order_id: '60123999' }),
    shipTo: SHIP_TO, shipFrom: SHIP_FROM,
    items: Array.from({ length: 20 }, (_, i) =>
      item((i % 4) + 1, `Test Product Line Item Number ${i + 1} With A Reasonably Long Descriptive Name`, `700-${1000 + i}`, `A-${String(i + 1).padStart(2, '0')}-05`)),
  },
  // The header barcode has NO ^FB, so ZPL draws it as wide as the data needs
  // and nothing clips it: a long id runs right through the TOTAL box and off
  // the label. A 19-char 3-7-7 marketplace id is the longest shape handled, so
  // it is the width canary for the barcode fit — look at THIS one after any
  // change to the module width or the header geometry. An id that cannot reach
  // a readable module in the header lane moves to its own full-width row and
  // the content below shifts down. Check both here: the row clears the TOTAL
  // box, and the ship-to band moved down instead of overprinting.
  'orderid-long': {
    desc: '19-char marketplace order id — full-width barcode row + TOTAL box clearance canary',
    order: baseOrder({ channel_order_id: '111-2345678-9012345' }),
    shipTo: SHIP_TO, shipFrom: SHIP_FROM,
    items: [
      item(1, 'Cotton Rolls #2 Medium Non-Sterile box of 2000', '110-0042', 'A-01-01'),
      item(2, 'Disposable Bibs 3-Ply Blue 500 count', '110-0099', 'A-01-02'),
    ],
  },
};

// ── Labelary ────────────────────────────────────────────────────────────────
function countPages(zpl) {
  return (zpl.match(/\^XZ/g) || []).length || 1;
}

// Labelary renders in MEDIA coordinates, so a ^POI payload comes back upside
// down — correct for the printer, useless for eyeballing a design. Ask Labelary
// to rotate the IMAGE back 180° so the preview shows the document the way a
// person holds it. This rotates the PICTURE only: the ZPL posted is
// byte-for-byte the payload, so what the printer does is unchanged and a
// missing ^POI still shows up as a preview that is suddenly upside down.
function viewRotationFor(zpl) {
  return /\^POI/i.test(String(zpl || '')) ? '180' : '0';
}

async function renderPage(zpl, index, size, attempt = 0) {
  const url = `${LABELARY_BASE}/${DPMM}/labels/${size}/${index}/`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'image/png',
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Rotation': viewRotationFor(zpl),
      ...(DO_LINT ? { 'X-Linter': 'On' } : {}),
    },
    body: zpl,
  });
  if (res.status === 429 && attempt < 4) {            // free tier: back off and retry
    await new Promise((r) => setTimeout(r, 900 * (attempt + 1)));
    return renderPage(zpl, index, size, attempt + 1);
  }
  const warnings = (res.headers.get('x-warnings') || '').trim();
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Labelary ${res.status}: ${text.slice(0, 300)}`);
  }
  return { buffer: Buffer.from(await res.arrayBuffer()), warnings };
}

async function run() {
  if (has('--list')) {
    for (const [k, fx] of Object.entries(FIXTURES)) console.log(`  ${k.padEnd(14)} ${fx.desc}`);
    return;
  }
  fs.mkdirSync(OUT, { recursive: true });

  const names = ONLY ? [ONLY] : Object.keys(FIXTURES);
  console.log(`Rendering ${names.length} fixture(s) at ${DPMM} → ${OUT}\n`);

  for (const name of names) {
    const fx = FIXTURES[name];
    if (!fx) { console.error(`! unknown fixture: ${name} (try --list)`); continue; }

    const zpl = renderDemoSlip(fx);
    fs.writeFileSync(path.join(OUT, `${name}.zpl`), zpl);
    const pages = countPages(zpl);
    const size = sizeForLayout(DEFAULT_PAGE);

    let firstWarn = '';
    const written = [];
    for (let i = 0; i < pages; i++) {
      try {
        const { buffer, warnings } = await renderPage(zpl, i, size);
        const file = path.join(OUT, `${name}-p${i + 1}.png`);
        fs.writeFileSync(file, buffer);
        written.push(file);
        if (warnings && !firstWarn) firstWarn = warnings;
      } catch (e) {
        console.error(`  ${name} p${i + 1}: ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, 350)); // Labelary free tier ~3 req/s — stay under it
    }
    console.log(`✓ ${name.padEnd(14)} ${pages} page(s)  ${fx.desc}`);
    for (const f of written) console.log(`    ${f}`);
    if (firstWarn) console.log(`    ⚠ lint: ${firstWarn.slice(0, 200)}`);
  }
  console.log(`\nDone. Open the PNGs above to review. Raw ZPL saved alongside as <fixture>.zpl`);
}

run().catch((e) => { console.error(e); process.exit(1); });
