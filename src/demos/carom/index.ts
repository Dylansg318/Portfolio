/**
 * CAROM — the island lane of the demo seam.
 *
 * A daily bounce puzzle. A ball enters a billiards table at 45 degrees, reflects
 * off the rails and off one block bolted to the cloth, and drops into the first
 * pocket it reaches. Fourteen pockets, four tries, and every miss rolls the ball
 * one more bounce — so a wrong guess buys information instead of just costing a
 * life.
 *
 * WHERE THE BOARD COMES FROM
 *   ./boards.json, a year of boards dealt at build time by scripts/carom-boards.mjs
 *   out of the 1,037 that survive its filters. Nothing is solved at request time;
 *   the file is static and the site is prerendered.
 *
 * WHY THE ANSWER IS NOT IN THAT FILE
 *   Because this has to trace the path anyway to animate it, so the pocket index
 *   would be redundant data that also happens to be tomorrow's answer. It is
 *   derived here instead, by the same rule the generator used and the physics gate
 *   proved: ./trace.mjs, one copy, imported by all three.
 *
 *   Being straight about the limit: a static site with no server ships the whole
 *   year's *boards* to anyone who opens the demo, so a determined reader can
 *   compute next Tuesday for themselves. That is inherent — the alternative is a
 *   request-time solver, which this architecture does not have and a puzzle for
 *   fun does not need.
 *
 * NO START GATE, DELIBERATELY — and DESIGN_SYSTEM 8.2 asks for one, so here is
 * the reason. The gate exists to stop a demo burning frames and capturing the
 * keyboard before a reader asks for it. This has no loop to gate: the table is
 * static SVG, nothing animates until a pocket is clicked, and no listener is
 * bound outside `el`. Putting a "Start" curtain over a still picture would hide
 * the one thing that explains the game. Reduced motion is honoured in shoot(),
 * and cleanup still cancels the only frame request that exists.
 *
 * Contract: export mount(el) => cleanup. See src/components/mdx/Demo.astro.
 */

import { contacts } from './trace.mjs';
import data from './boards.json';

/** One day's board, as scripts/carom-boards.mjs emits it. Arrays, not objects, because
 *  365 of these ship and the key names would outweigh the values. */
type Day = {
  /** table size, [W, H], in dots */
  s: number[];
  /** entry point [x, y], always on the rim */
  e: number[];
  /** the inward diagonal, [dx, dy], each +1 or -1 */
  d: number[];
  /** the block, [bx, by, bx2, by2], strictly interior */
  b: number[];
  /** the pockets, clockwise from the top-left rail */
  p: number[][];
  /** difficulty tier, 0 easiest through 6 hardest */
  t: number;
};

const DAYS = data.days as Record<string, Day>;
const DATES = Object.keys(DAYS).sort();
const BOUNCES = data.bounces;
const TRIES = data.tries;
const CONTACTS = BOUNCES + 1; // three bounces, then the pocket

/** No I — at this size it reads as a 1. */
const LETTERS = 'ABCDEFGHJKLMNP';

/* ------------------------------------------------------------ which board */

/** The visitor's own date, not UTC: a board that changes at midnight GMT would
 *  change mid-evening in New York. */
const localISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Today's board, or a stable stand-in.
 *
 * The dealt year runs out, and a prerendered site outlives its own JSON — so a
 * date outside the range gets a board chosen by hashing the date (FNV-1a) rather
 * than a 404 or an empty table. It is off the weekday difficulty ladder, which is
 * the only thing lost, and it is the same board for that date for everyone.
 */
function pickDay(iso: string): { day: Day; dealt: boolean } {
  const dealt = DAYS[iso];
  if (dealt) return { day: dealt, dealt: true };

  let h = 2166136261;
  for (let i = 0; i < iso.length; i++) {
    h ^= iso.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return { day: DAYS[DATES[(h >>> 0) % DATES.length]]!, dealt: false };
}

/* ---------------------------------------------------------------- styling */

/**
 * One committed world: a dark room, a lit cloth, a paper scorecard.
 *
 * No light/dark variants, per DESIGN_SYSTEM 6.2 — a game canvas is theme-less
 * art, so every colour here is explicit and the panel holds on either ground.
 * Everything is scoped under .carom so nothing reaches the page around it, and
 * the one thing borrowed from the site is --font-mono, which is already loaded.
 */
const STYLE_ID = 'carom-style';
const CSS = `
.carom {
  --room: #15100d; --room-deep: #0b0806;
  --brass: #b08d57; --brass-lit: #e8c27a;
  --chalk: #eaf4f9;
  --stock: #e8e0cd; --stock-ink: #332c24; --ruled: #b5534a;
  --warm: #c8b394; --warm-dim: #8a7a63;
  --ball-face: "Arial Black", "Arial Bold", Arial, Helvetica, sans-serif;
  --body-face: Arial, Helvetica, "Helvetica Neue", sans-serif;
  --card-face: var(--font-mono, ui-monospace, monospace);

  background:
    radial-gradient(120% 85% at 50% 6%, #221a14 0%, var(--room) 42%, var(--room-deep) 100%)
    var(--room);
  color: var(--warm);
  font-family: var(--body-face);
  font-size: 16px;
  line-height: 1.55;
  padding-inline: 22px;
  padding-block: 26px 30px;
}
.carom * { box-sizing: border-box; }

/* the sign above the table */
.carom-sign {
  display: flex; align-items: baseline; gap: 14px;
  border-bottom: 1px solid rgba(200, 179, 148, 0.22);
  padding-bottom: 9px; margin-bottom: 20px;
}
.carom-name {
  font-family: var(--ball-face); font-weight: 900;
  font-size: clamp(1.5rem, 5vw, 2.1rem); line-height: 1;
  letter-spacing: -0.018em; color: #f2e7d3;
  text-shadow: 0 1px 0 #000, 0 0 22px rgba(232, 194, 122, 0.16);
}
.carom-date {
  margin-left: auto; font-family: var(--ball-face); font-weight: 900;
  font-size: 0.78rem; letter-spacing: 0.04em;
  color: var(--warm-dim); white-space: nowrap;
}
.carom-ask {
  margin: 0 0 5px; font-size: clamp(1rem, 3.2vw, 1.15rem);
  font-weight: 700; letter-spacing: -0.008em; color: #f0e6d4;
}
.carom-rule {
  margin: 0 0 18px; font-size: 0.76rem;
  letter-spacing: 0.08em; color: var(--warm-dim);
}

/* the table */
.carom-felt { margin: 0 0 24px; }
.carom-table { display: block; width: 100%; height: auto; max-width: 100%; }
.carom-pk { cursor: pointer; }
.carom-pk.spent { cursor: default; }
.carom-pk:not(.spent):hover circle.lip { stroke: var(--brass-lit); stroke-width: 3.4; }
.carom-pk:focus { outline: none; }
.carom-pk:focus-visible circle.lip { stroke: var(--chalk); stroke-width: 3.4; }

/* the scorecard: paper in the room, not a UI panel */
.carom-card {
  position: relative; font-family: var(--card-face);
  background: var(--stock); color: var(--stock-ink);
  max-width: 25rem; padding: 16px 20px 15px;
  transform: rotate(-0.5deg);
  box-shadow: 0 14px 30px -14px rgba(0, 0, 0, 0.85), 0 2px 0 rgba(0, 0, 0, 0.3);
  background-image: repeating-linear-gradient(
    to bottom, transparent 0 27px, rgba(51, 44, 36, 0.09) 27px 28px);
}
.carom-card::before {  /* punch hole, as if it hung on a nail */
  content: ""; position: absolute; top: 9px; left: 10px;
  width: 9px; height: 9px; border-radius: 50%;
  background: var(--room); box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.6);
}
.carom-card-head {
  font-size: 0.68rem; letter-spacing: 0.2em; text-transform: uppercase;
  color: #6d6154; margin: 0 0 10px; padding-left: 16px;
  border-bottom: 1px solid var(--ruled); padding-bottom: 7px;
}
.carom-stamp {
  position: absolute; top: 12px; right: 12px;
  font-size: 0.6rem; letter-spacing: 0.18em; font-weight: 700;
  color: var(--ruled); opacity: 0.65;
  border: 1.5px solid var(--ruled); border-radius: 2px;
  padding: 2px 6px; transform: rotate(4deg);
}
.carom-tallies { display: flex; gap: 7px; align-items: center; margin: 0 0 9px; }
.carom-tally {
  width: 26px; height: 30px; border: 1px solid rgba(51, 44, 36, 0.35);
  display: grid; place-items: center;
  font-size: 1.05rem; font-weight: 700; line-height: 1; color: var(--ruled);
}
.carom-tally.hit { color: #2f6b3d; }
.carom-verdict { margin: 0; font-size: 0.88rem; min-height: 1.5em; }
.carom-verdict b { font-family: var(--ball-face); font-weight: 900; font-size: 1.02em; }
.carom-verdict.win b { color: #2f6b3d; }
.carom-verdict.miss b { color: var(--ruled); }

.carom-again {
  font: inherit; font-size: 0.72rem; font-weight: 700;
  letter-spacing: 0.14em; text-transform: uppercase; margin-top: 11px;
  background: none; color: var(--stock-ink);
  border: 1.5px solid var(--stock-ink); border-radius: 2px;
  padding: 0.36rem 0.75rem; cursor: pointer;
}
.carom-again:hover { background: var(--stock-ink); color: var(--stock); }

/* the share slip */
.carom-slip {
  margin-top: 22px; max-width: 25rem;
  border: 1px dashed rgba(200, 179, 148, 0.4); padding: 13px 16px;
  display: flex; align-items: center; gap: 14px;
}
.carom-slip pre {
  margin: 0; flex: 1 1 auto; min-width: 0;
  font-family: var(--card-face); font-size: 0.82rem; line-height: 1.65;
  color: var(--warm); white-space: pre-wrap; word-break: break-word;
}
.carom-copy {
  font: inherit; font-size: 0.7rem; font-weight: 700;
  letter-spacing: 0.14em; text-transform: uppercase;
  background: var(--brass); color: #201509;
  border: 0; border-radius: 2px; padding: 0.42rem 0.7rem;
  cursor: pointer; flex: none;
}
.carom-copy:hover { background: var(--brass-lit); }

.carom [hidden] { display: none !important; }
.carom :focus-visible { outline: 2px solid var(--brass-lit); outline-offset: 3px; }

@media (max-width: 560px) {
  .carom { padding-inline: 15px; }
  .carom-sign { flex-wrap: wrap; }
  .carom-date { margin-left: 0; width: 100%; }
  .carom-card, .carom-slip { max-width: none; }
  .carom-slip { flex-wrap: wrap; }
}
@media (prefers-reduced-motion: reduce) {
  .carom * { transition-duration: 0ms !important; }
}
`;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const tag = document.createElement('style');
  tag.id = STYLE_ID;
  tag.textContent = CSS;
  document.head.appendChild(tag);
}

/* -------------------------------------------------------------- geometry */

const CELL = 38;
const RAIL = 20;
const PAD = 26;
/**
 * The invisible tap target on a pocket.
 *
 * Not eyeballed. The generator keeps every pair of pockets at least 2 dots apart —
 * measured at exactly 2.000 across all 365 shipped boards — so a radius under 38
 * units cannot overlap its neighbour and steal its taps. 32 is the largest round
 * number under that.
 *
 * What that renders as, measured on the write-up page at a 400px viewport (the
 * narrowest case, since the page's own gutters leave the table 321px): 44px across
 * on an 11-dot board, and 38px on a 13-dot one, which is the floor. Wider viewports
 * and the /play route are all more generous.
 */
const HIT_R = 32;

const NS = 'http://www.w3.org/2000/svg';

function node(tag: string, attrs: Record<string, string | number> = {}): SVGElement {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, String(attrs[k]));
  return n;
}

/* ------------------------------------------------------------------ mount */

export function mount(el: HTMLElement): () => void {
  ensureStyle();

  const today = new Date();
  const iso = localISO(today);
  const { day, dealt } = pickDay(iso);

  const W = day.s[0]!;
  const H = day.s[1]!;
  const BLOCK = { bx: day.b[0]!, by: day.b[1]!, bx2: day.b[2]!, by2: day.b[3]! };
  const ENTRY = { x: day.e[0]!, y: day.e[1]! };
  const DIR = { x: day.d[0]!, y: day.d[1]! };
  const POCKETS = day.p.map(([x, y]) => ({ x: x!, y: y! }));

  // The path, and therefore the answer, derived rather than read. See the header.
  const hits = contacts(W, H, BLOCK, ENTRY, DIR, CONTACTS);
  const PATH = [ENTRY, ...hits.map((c) => ({ x: c.x, y: c.y }))];
  const LAST = PATH.length - 1;
  const finalPoint = PATH[LAST]!;
  const ANSWER = POCKETS.findIndex((p) => p.x === finalPoint.x && p.y === finalPoint.y);

  if (ANSWER === -1) {
    // Impossible for a shipped board — scripts/carom-physics.mjs replays all 365
    // and fails the build otherwise. Handled anyway so a bad board degrades to a
    // sentence instead of a silent unwinnable table.
    el.innerHTML =
      `<p class="p-4 text-sm text-ink-muted">Carom could not trace ${iso} to a pocket.</p>`;
    return () => {
      el.innerHTML = '';
    };
  }

  const dateLabel = (() => {
    try {
      return today.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    } catch {
      return iso;
    }
  })();

  /* ---- shell ------------------------------------------------------- */

  el.innerHTML = `
    <div class="carom">
      <div class="carom-sign">
        <span class="carom-name">Carom</span>
        <p class="carom-date">${dateLabel}${dealt ? '' : ' · off-calendar board'}</p>
      </div>

      <p class="carom-ask">Which pocket does it drop into?</p>
      <p class="carom-rule">${BOUNCES} bounces off anything solid &middot; each miss reveals one</p>

      <div class="carom-felt">
        <svg class="carom-table" data-table role="img" aria-label="A billiards table
          ${W} by ${H} dots, with ${POCKETS.length} pockets around the rim and a solid
          block on the cloth. The ball enters at a marked point on the rim at forty-five
          degrees."></svg>
      </div>

      <div class="carom-card">
        <span class="carom-stamp">Tier ${day.t + 1}/7</span>
        <p class="carom-card-head">Scorecard &middot; ${dateLabel}</p>
        <div class="carom-tallies" data-tallies aria-label="Tries used"></div>
        <p class="carom-verdict" data-verdict aria-live="polite">Pick a pocket. No bounces shown yet.</p>
        <button class="carom-again" type="button" data-again hidden>Rack again</button>
      </div>

      <div class="carom-slip" data-slip hidden>
        <pre data-slip-text></pre>
        <button class="carom-copy" type="button" data-copy>Copy</button>
      </div>
    </div>
  `;

  const svg = el.querySelector<SVGSVGElement>('[data-table]')!;
  const talliesBox = el.querySelector<HTMLElement>('[data-tallies]')!;
  const verdictEl = el.querySelector<HTMLElement>('[data-verdict]')!;
  const againBtn = el.querySelector<HTMLButtonElement>('[data-again]')!;
  const slipBox = el.querySelector<HTMLElement>('[data-slip]')!;
  const slipText = el.querySelector<HTMLElement>('[data-slip-text]')!;
  const copyBtn = el.querySelector<HTMLButtonElement>('[data-copy]')!;

  /* ---- projection -------------------------------------------------- */

  const TW = W * CELL;
  const TH = H * CELL;
  const sx = (x: number) => PAD + x * CELL;
  const sy = (y: number) => PAD + (H - y) * CELL; // y up, like the generator

  const screenPath = () => PATH.map((p) => ({ x: sx(p.x), y: sy(p.y) }));

  /* ---- state ------------------------------------------------------- */

  let guesses: number[] = [];
  let revealed = 0;
  let over = false;
  let rolling = false;
  let raf = 0;
  let copyTimer = 0;

  const mouths: SVGElement[] = [];
  const layers: Record<string, SVGElement> = {};

  /* ---- persistence -------------------------------------------------
     A daily game that forgets on refresh is a game you can brute-force by
     reloading, so the day's guesses are kept. Keyed by date, so tomorrow starts
     clean and yesterday is not resurrected. Every access is guarded: private
     windows and blocked site data both throw here. */

  const storeKey = `carom:${iso}`;
  const save = () => {
    try {
      localStorage.setItem(storeKey, JSON.stringify(guesses));
    } catch {
      /* not important enough to interrupt a game over */
    }
  };
  const load = (): number[] => {
    try {
      const raw = localStorage.getItem(storeKey);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((n): n is number => typeof n === 'number' && n >= 0 && n < POCKETS.length)
        .slice(0, TRIES);
    } catch {
      return [];
    }
  };
  const forget = () => {
    try {
      localStorage.removeItem(storeKey);
    } catch {
      /* see save() */
    }
  };

  /* ---- the table --------------------------------------------------- */

  function defs() {
    const d = node('defs');

    const lit = node('radialGradient', { id: 'carom-lit', cx: '50%', cy: '40%', r: '74%' });
    lit.appendChild(node('stop', { offset: '0', 'stop-color': '#3f8474' }));
    lit.appendChild(node('stop', { offset: '0.62', 'stop-color': '#336a5b' }));
    lit.appendChild(node('stop', { offset: '1', 'stop-color': '#265045' }));
    d.appendChild(lit);

    const grain = node('linearGradient', { id: 'carom-grain', x1: '0', y1: '0', x2: '0', y2: '1' });
    grain.appendChild(node('stop', { offset: '0', 'stop-color': '#7d5739' }));
    grain.appendChild(node('stop', { offset: '0.5', 'stop-color': '#6b4a32' }));
    grain.appendChild(node('stop', { offset: '1', 'stop-color': '#543823' }));
    d.appendChild(grain);

    svg.appendChild(d);
  }

  function build() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    mouths.length = 0;
    svg.setAttribute('viewBox', `0 0 ${TW + PAD * 2} ${TH + PAD * 2}`);
    defs();

    // cabinet shadow, walnut frame, then the cloth
    svg.appendChild(node('rect', {
      x: PAD - RAIL - 7, y: PAD - RAIL - 5,
      width: TW + (RAIL + 7) * 2, height: TH + (RAIL + 7) * 2,
      rx: 15, fill: '#000000', 'fill-opacity': 0.5,
    }));
    svg.appendChild(node('rect', {
      x: PAD - RAIL, y: PAD - RAIL, width: TW + RAIL * 2, height: TH + RAIL * 2,
      rx: 11, fill: 'url(#carom-grain)',
    }));
    svg.appendChild(node('rect', {
      x: PAD - RAIL + 3.5, y: PAD - RAIL + 3.5,
      width: TW + RAIL * 2 - 7, height: TH + RAIL * 2 - 7,
      rx: 8, fill: 'none', stroke: '#9c7551', 'stroke-width': 1, 'stroke-opacity': 0.55,
    }));
    svg.appendChild(node('rect', {
      x: PAD - 4, y: PAD - 4, width: TW + 8, height: TH + 8, rx: 3, fill: '#1b3a32',
    }));
    svg.appendChild(node('rect', { x: PAD, y: PAD, width: TW, height: TH, fill: 'url(#carom-lit)' }));

    // the spots you count
    for (let gx = 1; gx < W; gx++) {
      for (let gy = 1; gy < H; gy++) {
        if (gx >= BLOCK.bx && gx <= BLOCK.bx2 && gy >= BLOCK.by && gy <= BLOCK.by2) continue;
        svg.appendChild(node('circle', {
          cx: sx(gx), cy: sy(gy), r: 1.35, fill: '#b9d6cc', 'fill-opacity': 0.34,
        }));
      }
    }

    // the block: a walnut wedge bolted to the cloth
    const bx = sx(BLOCK.bx);
    const by = sy(BLOCK.by2);
    const bw = (BLOCK.bx2 - BLOCK.bx) * CELL;
    const bh = (BLOCK.by2 - BLOCK.by) * CELL;
    svg.appendChild(node('rect', {
      x: bx + 1, y: by + 5, width: bw, height: bh, rx: 4, fill: '#000000', 'fill-opacity': 0.42,
    }));
    svg.appendChild(node('rect', { x: bx, y: by, width: bw, height: bh, rx: 4, fill: 'url(#carom-grain)' }));
    svg.appendChild(node('rect', {
      x: bx + 3, y: by + 3, width: bw - 6, height: bh - 6, rx: 2,
      fill: 'none', stroke: '#9c7551', 'stroke-width': 1, 'stroke-opacity': 0.6,
    }));
    // two bolts, inset from the short ends whichever way round the block is
    const boltInset = Math.min(9, bw / 2 - 2);
    for (const p of [[bx + boltInset, by + bh / 2], [bx + bw - boltInset, by + bh / 2]]) {
      svg.appendChild(node('circle', { cx: p[0]!, cy: p[1]!, r: 2.2, fill: '#3a281d' }));
      svg.appendChild(node('circle', { cx: p[0]!, cy: p[1]! - 0.7, r: 1.5, fill: '#b08d57' }));
    }

    // the chalk line: everything seen so far sits back, the last leg stays bright
    layers.past = node('path', {
      d: '', fill: 'none', stroke: '#cfe0ea', 'stroke-width': 2.3,
      'stroke-opacity': 0.26, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    });
    svg.appendChild(layers.past);
    layers.hot = node('path', {
      d: '', fill: 'none', stroke: '#eaf4f9', 'stroke-width': 2.9,
      'stroke-opacity': 0.92, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    });
    svg.appendChild(layers.hot);
    layers.marks = node('g');
    svg.appendChild(layers.marks);

    // pockets: brass rim, real hole
    POCKETS.forEach((p, i) => {
      const g = node('g', { class: 'carom-pk', role: 'button', tabindex: 0 });
      const label = document.createElementNS(NS, 'title');
      label.textContent = `Pocket ${LETTERS[i]}`;
      g.appendChild(label);
      g.appendChild(node('circle', { cx: sx(p.x), cy: sy(p.y), r: HIT_R, fill: 'transparent' }));
      g.appendChild(node('circle', {
        cx: sx(p.x), cy: sy(p.y) + 1.5, r: 13, fill: '#000000', 'fill-opacity': 0.55,
      }));
      g.appendChild(node('circle', {
        class: 'lip', cx: sx(p.x), cy: sy(p.y), r: 12.5,
        fill: '#070a09', stroke: '#b08d57', 'stroke-width': 2.6,
      }));
      g.appendChild(node('circle', {
        cx: sx(p.x), cy: sy(p.y) - 2, r: 8.5, fill: '#000000', 'fill-opacity': 0.8,
      }));
      svg.appendChild(g);
      mouths.push(g);
      g.addEventListener('click', () => guess(i));
      g.addEventListener('keydown', (ev) => {
        const k = (ev as KeyboardEvent).key;
        if (k === 'Enter' || k === ' ') {
          ev.preventDefault();
          guess(i);
        }
      });
    });
    layers.chalkOut = node('g');
    svg.appendChild(layers.chalkOut);

    // where it came in, and which way it is pointed — chalked on the cloth
    const ex = sx(ENTRY.x);
    const ey = sy(ENTRY.y);
    const onSide = ENTRY.x === 0 || ENTRY.x === W;
    svg.appendChild(node('rect', {
      x: onSide ? (ENTRY.x === 0 ? ex - RAIL + 3 : ex) : ex - 3,
      y: onSide ? ey - 3 : (ENTRY.y === 0 ? ey : ey - RAIL + 3),
      width: onSide ? RAIL - 3 : 6,
      height: onSide ? 6 : RAIL - 3,
      rx: 3, fill: '#b08d57',
    }));
    const aim = CELL * 1.45;
    const axp = ex + DIR.x * aim;
    const ayp = ey - DIR.y * aim;
    svg.appendChild(node('line', {
      x1: ex + DIR.x * 11, y1: ey - DIR.y * 11, x2: axp, y2: ayp,
      stroke: '#eaf4f9', 'stroke-width': 2, 'stroke-opacity': 0.45,
      'stroke-linecap': 'round', 'stroke-dasharray': '6 5',
    }));
    svg.appendChild(node('path', {
      d: 'M0 0 L-9 -3.6 L-9 3.6 Z', fill: '#eaf4f9', 'fill-opacity': 0.55,
      transform: `translate(${axp} ${ayp}) rotate(${(Math.atan2(-DIR.y, DIR.x) * 180) / Math.PI})`,
    }));

    layers.ball = node('g');
    svg.appendChild(layers.ball);
    paint(revealed);
  }

  /* ---- painting ---------------------------------------------------- */

  function clear(g: SVGElement) {
    while (g.firstChild) g.removeChild(g.firstChild);
  }

  function paintMarks(upto: number) {
    clear(layers.marks!);
    const P = screenPath();
    const last = Math.min(upto, LAST - 1); // the final point is a pocket, not a bounce
    for (let i = 1; i <= last; i++) {
      layers.marks!.appendChild(node('circle', {
        cx: P[i]!.x, cy: P[i]!.y, r: 3.6, fill: 'none',
        stroke: '#cfe0ea', 'stroke-width': 1.7, 'stroke-opacity': 0.62,
      }));
    }
  }

  function paintBall(x: number, y: number, sunk: boolean) {
    clear(layers.ball!);
    if (sunk) return; // it is in the pocket, out of sight
    layers.ball!.appendChild(node('ellipse', {
      cx: x + 1.5, cy: y + 5, rx: 8, ry: 3.6, fill: '#000000', 'fill-opacity': 0.45,
    }));
    layers.ball!.appendChild(node('circle', { cx: x, cy: y, r: 8, fill: '#dce9f0' }));
    layers.ball!.appendChild(node('circle', {
      cx: x - 2.6, cy: y - 2.9, r: 2.7, fill: '#ffffff', 'fill-opacity': 0.8,
    }));
  }

  function paint(upto: number, tipX?: number, tipY?: number) {
    const P = screenPath();
    const mid = tipX !== undefined && tipY !== undefined;

    if (upto === 0 && !mid) {
      layers.past!.setAttribute('d', '');
      layers.hot!.setAttribute('d', '');
    } else if (mid) {
      let d = `M${P[0]!.x} ${P[0]!.y}`;
      for (let i = 1; i <= upto; i++) d += `L${P[i]!.x} ${P[i]!.y}`;
      layers.past!.setAttribute('d', d);
      layers.hot!.setAttribute('d', `M${P[upto]!.x} ${P[upto]!.y}L${tipX} ${tipY}`);
    } else {
      let d = `M${P[0]!.x} ${P[0]!.y}`;
      for (let i = 1; i < upto; i++) d += `L${P[i]!.x} ${P[i]!.y}`;
      layers.past!.setAttribute('d', upto > 1 ? d : '');
      const a = Math.max(0, upto - 1);
      layers.hot!.setAttribute('d', `M${P[a]!.x} ${P[a]!.y}L${P[upto]!.x} ${P[upto]!.y}`);
    }

    paintMarks(upto);
    const at = mid ? { x: tipX!, y: tipY! } : P[upto]!;
    paintBall(at.x, at.y, !mid && upto === LAST);
  }

  /* ---- the shot, one rail at a time -------------------------------- */

  function shoot(from: number, to: number, done?: () => void) {
    if (rolling) {
      done?.();
      return;
    }
    const P = screenPath();
    const legs: number[] = [];
    let total = 0;
    for (let i = from; i < to; i++) {
      const len = Math.hypot(P[i + 1]!.x - P[i]!.x, P[i + 1]!.y - P[i]!.y);
      legs.push(len);
      total += len;
    }

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reduced || total === 0) {
      revealed = to;
      paint(to);
      done?.();
      return;
    }

    rolling = true;
    let t0: number | null = null;
    const DUR = 430 * legs.length + 300;
    raf = requestAnimationFrame(function frame(t) {
      if (t0 === null) t0 = t;
      const pr = Math.min(1, (t - t0) / DUR);
      const travelled = pr * total;
      let acc = 0;
      let seg = 0;
      while (seg < legs.length - 1 && acc + legs[seg]! < travelled) {
        acc += legs[seg]!;
        seg++;
      }
      const f = legs[seg] ? (travelled - acc) / legs[seg]! : 1;
      const A = P[from + seg]!;
      const B = P[from + seg + 1]!;
      paint(from + seg, A.x + (B.x - A.x) * f, A.y + (B.y - A.y) * f);
      if (pr < 1) {
        raf = requestAnimationFrame(frame);
      } else {
        raf = 0;
        rolling = false;
        revealed = to;
        paint(to);
        done?.();
      }
    });
  }

  /* ---- play -------------------------------------------------------- */

  function renderTallies() {
    talliesBox.innerHTML = '';
    for (let i = 0; i < TRIES; i++) {
      const cell = document.createElement('span');
      const g = guesses[i];
      cell.className = 'carom-tally' + (g === undefined ? '' : g === ANSWER ? ' hit' : '');
      cell.textContent = g === undefined ? '' : g === ANSWER ? '✓' : '✕';
      talliesBox.appendChild(cell);
    }
  }

  function say(html: string, cls?: string) {
    verdictEl.className = 'carom-verdict' + (cls ? ' ' + cls : '');
    verdictEl.innerHTML = html;
  }

  /** A ruled-out pocket gets chalked out. It carries the most information on the
   *  board, so it has to read at a glance — a dulled rim did not. */
  function chalkOut(i: number) {
    const p = POCKETS[i]!;
    const cx = sx(p.x);
    const cy = sy(p.y);
    const r = 15;
    const j = [1.6, -1.2, 1.1, -1.7]; // slight wobble, so it looks drawn and not printed
    layers.chalkOut!.appendChild(node('path', {
      d: `M${cx - r + j[0]!} ${cy - r + j[1]!}L${cx + r + j[2]!} ${cy + r + j[3]!}`,
      stroke: '#eaf4f9', 'stroke-width': 3, 'stroke-opacity': 0.88, 'stroke-linecap': 'round',
    }));
    layers.chalkOut!.appendChild(node('path', {
      d: `M${cx + r + j[1]!} ${cy - r + j[2]!}L${cx - r + j[3]!} ${cy + r + j[0]!}`,
      stroke: '#eaf4f9', 'stroke-width': 3, 'stroke-opacity': 0.88, 'stroke-linecap': 'round',
    }));
  }

  /** Light a pocket's brass so the eye lands on it. */
  function litRim(i: number) {
    const lip = mouths[i]?.querySelector('circle.lip');
    lip?.setAttribute('stroke', '#e8c27a');
    lip?.setAttribute('stroke-width', '4.2');
  }

  function mark(i: number, hit: boolean) {
    const g = mouths[i];
    if (!g) return;
    g.classList.add('spent');
    g.setAttribute('aria-disabled', 'true');
    if (hit) litRim(i);
    else chalkOut(i);
  }

  function guess(i: number) {
    if (over || rolling || guesses.includes(i)) return;
    guesses.push(i);
    save();
    mark(i, i === ANSWER);
    renderTallies();

    if (i === ANSWER) {
      over = true;
      say(`Pocket <b>${LETTERS[i]}</b>. Watch it finish.`, 'win');
      shoot(revealed, LAST, finish);
      return;
    }
    if (guesses.length >= TRIES) {
      over = true;
      say('Out of tries.', 'miss');
      shoot(revealed, LAST, finish);
      return;
    }
    say('Rolling&hellip;');
    shoot(revealed, revealed + 1, () => {
      say(
        `Not <b>${LETTERS[i]}</b>. Bounce ${revealed} of ${LAST - 1}, ` +
          `${TRIES - guesses.length} tries left.`,
        'miss',
      );
    });
  }

  function finish() {
    const won = guesses.includes(ANSWER);
    // Naming the letter is not a reveal: the letters are in tooltips, so a player
    // told "F" would have to count round the rim to find it. Light the pocket.
    litRim(ANSWER);
    say(
      won
        ? `Down in <b>${guesses.length}</b> of ${TRIES}.`
        : `It dropped into <b>${LETTERS[ANSWER]}</b>.`,
      won ? 'win' : 'miss',
    );
    slipText.textContent = slip();
    slipBox.hidden = false;
    againBtn.hidden = false;
  }

  /** The bounce count stays out of the slip: everyone plays the same table, so it
   *  would hand the next person a real clue. */
  function slip() {
    let row = '';
    for (let i = 0; i < TRIES; i++) {
      const g = guesses[i];
      row += g === undefined ? '⬜' : g === ANSWER ? '🎯' : '🔴';
    }
    const won = guesses.includes(ANSWER);
    return `Carom · ${dateLabel}\n${row}   ${won ? `${guesses.length}/${TRIES}` : `x/${TRIES}`}`;
  }

  /* ---- controls ---------------------------------------------------- */

  againBtn.addEventListener('click', () => {
    // Replays the same board, because it IS the same board — this is a daily
    // puzzle, not a shuffler. It is here so a reader who came for the write-up
    // can see the mechanic twice without waiting until tomorrow.
    guesses = [];
    revealed = 0;
    over = false;
    forget();
    slipBox.hidden = true;
    againBtn.hidden = true;
    build();
    renderTallies();
    say('Pick a pocket. No bounces shown yet.');
  });

  copyBtn.addEventListener('click', () => {
    const text = slipText.textContent ?? '';
    const settle = (label: string) => {
      copyBtn.textContent = label;
      window.clearTimeout(copyTimer);
      copyTimer = window.setTimeout(() => {
        copyBtn.textContent = 'Copy';
      }, 1400);
    };
    try {
      navigator.clipboard.writeText(text).then(
        () => settle('Copied'),
        () => settle('Select it'),
      );
    } catch {
      settle('Select it');
    }
  });

  /* ---- first paint, replaying whatever today already had ----------- */

  build();
  const saved = load();
  if (saved.length) {
    for (const i of saved) {
      guesses.push(i);
      mark(i, i === ANSWER);
    }
    if (guesses.includes(ANSWER) || guesses.length >= TRIES) {
      revealed = LAST;
      paint(LAST);
      over = true;
      finish();
    } else {
      revealed = Math.min(guesses.length, LAST);
      paint(revealed);
      const lastGuess = guesses[guesses.length - 1]!;
      say(
        `Not <b>${LETTERS[lastGuess]}</b>. Bounce ${revealed} of ${LAST - 1}, ` +
          `${TRIES - guesses.length} tries left.`,
        'miss',
      );
    }
  }
  renderTallies();

  return () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    rolling = false;
    window.clearTimeout(copyTimer);
    el.innerHTML = '';
  };
}
