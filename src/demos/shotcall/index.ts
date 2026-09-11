/**
 * SHOTCALL — the island lane of the demo seam.
 *
 * A daily bounce puzzle. A ball enters a billiards table at 45 degrees, reflects
 * off the rails and off one block bolted to the cloth, and drops into the first
 * pocket it reaches. Fourteen pockets, four tries, and every miss rolls the ball
 * one more bounce — so a wrong guess buys information instead of just costing a
 * life.
 *
 * ONE BOARD A DAY, ONCE
 *   Four tries and the day is spent — there is no replay, the same as every other
 *   daily game. The day's guesses live in localStorage, so a refresh cannot buy a
 *   fresh set, and a finished day reopens as the finished board with a countdown
 *   to the next one. The honest limit of doing this without a server: clearing
 *   site data resets the day. A cookie would not change that, and nothing short of
 *   an account would.
 *
 *   This does mean a reader who came for the write-up and loses in four gets the
 *   solved board rather than another go. That is the cost of the thing behaving
 *   like a real daily game, which is what it is.
 *
 * CHALKING YOUR OWN LINE
 *   Drag across the cloth and you draw, freehand, wherever the pointer actually
 *   went — no snapping to the lattice, no smoothing. When the real path is
 *   revealed you get both lines side by side and a number for how far off you
 *   were, which is a different and harder question than which pocket it lands in.
 *
 *   The measure is a symmetric mean nearest-point distance, in dots. Symmetric
 *   deliberately: the one-sided version scores a two-inch scribble sitting on the
 *   path as near-perfect, because every point of the scribble is close to the
 *   path. Measuring the path against the drawing as well is what makes a short
 *   line score badly, which is correct — it did not predict the route.
 *
 *   It is a TOGGLE rather than always-on, and that is a mobile decision. Drawing
 *   needs `touch-action: none` over the cloth, and the cloth is most of a phone
 *   screen — always-on would mean a finger can no longer scroll past the game.
 *   So it defaults on for a mouse (where a drag never scrolled anything) and off
 *   for touch, and either way one tap changes it. A tap on a pocket still guesses
 *   while chalk is on, because a tap is not a stroke.
 *
 * WHERE THE BOARD COMES FROM
 *   ./boards.json, a year of boards dealt at build time by scripts/shotcall-boards.mjs
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

/** One day's board, as scripts/shotcall-boards.mjs emits it. Arrays, not objects, because
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

type Pt = { x: number; y: number };

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
 * Everything is scoped under .shotcall so nothing reaches the page around it, and
 * the one thing borrowed from the site is --font-mono, which is already loaded.
 */
const STYLE_ID = 'shotcall-style';
const CSS = `
.shotcall {
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
.shotcall * { box-sizing: border-box; }

/* the sign above the table */
.shotcall-sign {
  display: flex; align-items: baseline; gap: 14px;
  border-bottom: 1px solid rgba(200, 179, 148, 0.22);
  padding-bottom: 9px; margin-bottom: 20px;
}
.shotcall-name {
  font-family: var(--ball-face); font-weight: 900;
  font-size: clamp(1.5rem, 5vw, 2.1rem); line-height: 1;
  letter-spacing: -0.018em; color: #f2e7d3;
  text-shadow: 0 1px 0 #000, 0 0 22px rgba(232, 194, 122, 0.16);
}
.shotcall-date {
  margin-left: auto; font-family: var(--ball-face); font-weight: 900;
  font-size: 0.78rem; letter-spacing: 0.04em;
  color: var(--warm-dim); white-space: nowrap;
}
.shotcall-ask {
  margin: 0 0 5px; font-size: clamp(1rem, 3.2vw, 1.15rem);
  font-weight: 700; letter-spacing: -0.008em; color: #f0e6d4;
}
.shotcall-rule {
  margin: 0 0 18px; font-size: 0.76rem;
  letter-spacing: 0.08em; color: var(--warm-dim);
}

/* the table */
.shotcall-felt { margin: 0 0 24px; }
.shotcall-table { display: block; width: 100%; height: auto; max-width: 100%; }
.shotcall-pk { cursor: pointer; }
.shotcall-pk.spent { cursor: default; }
.shotcall-pk:not(.spent):hover circle.lip { stroke: var(--brass-lit); stroke-width: 3.4; }
.shotcall-pk:focus { outline: none; }
.shotcall-pk:focus-visible circle.lip { stroke: var(--chalk); stroke-width: 3.4; }

/* the scorecard: paper in the room, not a UI panel */
.shotcall-card {
  position: relative; font-family: var(--card-face);
  background: var(--stock); color: var(--stock-ink);
  max-width: 25rem; padding: 16px 20px 15px;
  transform: rotate(-0.5deg);
  box-shadow: 0 14px 30px -14px rgba(0, 0, 0, 0.85), 0 2px 0 rgba(0, 0, 0, 0.3);
  background-image: repeating-linear-gradient(
    to bottom, transparent 0 27px, rgba(51, 44, 36, 0.09) 27px 28px);
}
.shotcall-card::before {  /* punch hole, as if it hung on a nail */
  content: ""; position: absolute; top: 9px; left: 10px;
  width: 9px; height: 9px; border-radius: 50%;
  background: var(--room); box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.6);
}
.shotcall-card-head {
  font-size: 0.68rem; letter-spacing: 0.2em; text-transform: uppercase;
  color: #6d6154; margin: 0 0 10px; padding-left: 16px;
  border-bottom: 1px solid var(--ruled); padding-bottom: 7px;
}
.shotcall-stamp {
  position: absolute; top: 12px; right: 12px;
  font-size: 0.6rem; letter-spacing: 0.18em; font-weight: 700;
  color: var(--ruled); opacity: 0.65;
  border: 1.5px solid var(--ruled); border-radius: 2px;
  padding: 2px 6px; transform: rotate(4deg);
}
/* The tally row is rebuilt with innerHTML on every guess, so the chalk toggle
   is its sibling and not its child. */
.shotcall-row { display: flex; align-items: center; gap: 7px; margin: 0 0 9px; }
.shotcall-tallies { display: flex; gap: 7px; align-items: center; margin-right: auto; }

/* The pocket letters, in the same face as the ball numbers. */
.shotcall-table text { font-family: var(--ball-face); font-weight: 900; }
.shotcall-tally {
  width: 26px; height: 30px; border: 1px solid rgba(51, 44, 36, 0.35);
  display: grid; place-items: center;
  font-size: 1.05rem; font-weight: 700; line-height: 1; color: var(--ruled);
}
.shotcall-tally.hit { color: #2f6b3d; }
.shotcall-verdict { margin: 0; font-size: 0.88rem; min-height: 1.5em; }
.shotcall-verdict b { font-family: var(--ball-face); font-weight: 900; font-size: 1.02em; }
.shotcall-verdict.win b { color: #2f6b3d; }
.shotcall-verdict.miss b { color: var(--ruled); }

/* the chalk toggle, and the cursor it implies */
.shotcall-chalk {
  font: inherit; font-size: 0.64rem; font-weight: 700;
  letter-spacing: 0.12em; text-transform: uppercase;
  background: none; color: var(--stock-ink);
  border: 1.5px solid rgba(51, 44, 36, 0.5); border-radius: 2px;
  padding: 0.3rem 0.55rem; cursor: pointer; flex: none;
}
.shotcall-chalk:hover:not(:disabled) { border-color: var(--stock-ink); }
.shotcall-chalk[aria-pressed="true"] { background: var(--stock-ink); color: var(--stock); border-color: var(--stock-ink); }
.shotcall-chalk:disabled { opacity: 0.4; cursor: default; }

/* Only while chalk is armed, so a finger can scroll the page the rest of the time. */
.shotcall.chalking .shotcall-table { cursor: crosshair; touch-action: none; }

.shotcall-score { margin: 7px 0 0; font-size: 0.82rem; }
.shotcall-score b { font-family: var(--ball-face); font-weight: 900; }

.shotcall-next {
  margin: 11px 0 0; font-size: 0.72rem; font-weight: 700;
  letter-spacing: 0.1em; text-transform: uppercase; color: #6d6154;
}
.shotcall-next b { font-weight: 700; color: var(--stock-ink); font-variant-numeric: tabular-nums; }

/* the share slip */
.shotcall-slip {
  margin-top: 22px; max-width: 25rem;
  border: 1px dashed rgba(200, 179, 148, 0.4); padding: 13px 16px;
  display: flex; align-items: center; gap: 14px;
}
.shotcall-slip pre {
  margin: 0; flex: 1 1 auto; min-width: 0;
  font-family: var(--card-face); font-size: 0.82rem; line-height: 1.65;
  color: var(--warm); white-space: pre-wrap; word-break: break-word;
}
.shotcall-copy {
  font: inherit; font-size: 0.7rem; font-weight: 700;
  letter-spacing: 0.14em; text-transform: uppercase;
  background: var(--brass); color: #201509;
  border: 0; border-radius: 2px; padding: 0.42rem 0.7rem;
  cursor: pointer; flex: none;
}
.shotcall-copy:hover { background: var(--brass-lit); }

.shotcall [hidden] { display: none !important; }
.shotcall :focus-visible { outline: 2px solid var(--brass-lit); outline-offset: 3px; }

@media (max-width: 560px) {
  .shotcall { padding-inline: 15px; }
  .shotcall-sign { flex-wrap: wrap; }
  .shotcall-date { margin-left: 0; width: 100%; }
  .shotcall-card, .shotcall-slip { max-width: none; }
  .shotcall-slip { flex-wrap: wrap; }
}
@media (prefers-reduced-motion: reduce) {
  .shotcall * { transition-duration: 0ms !important; }
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

/**
 * The pocket letters, set in the hole like the number on a ball.
 *
 * They are not decoration: the scorecard says "Not J" and "It dropped into F",
 * and with no letters on the board that is a sentence about nothing the player
 * can point at.
 *
 * In the hole rather than out on the rail, which was the first attempt. The rail
 * is RAIL units wide and the pocket is 12.5 in radius, so any letter big enough
 * to read sat half on the wood and half over the black — and widening the rail to
 * make room would have shrunk the whole table, and the tap targets with it. The
 * hole is the one place with both space and contrast.
 */
const LABEL_SIZE = 14;

/** Asked each time rather than cached: a reader can change it mid-session. */
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

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
    // Impossible for a shipped board — scripts/shotcall-physics.mjs replays all 365
    // and fails the build otherwise. Handled anyway so a bad board degrades to a
    // sentence instead of a silent unwinnable table.
    el.innerHTML =
      `<p class="p-4 text-sm text-ink-muted">Shotcall could not trace ${iso} to a pocket.</p>`;
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
    <div class="shotcall">
      <div class="shotcall-sign">
        <span class="shotcall-name">Shotcall</span>
        <p class="shotcall-date">${dateLabel}${dealt ? '' : ' · off-calendar board'}</p>
      </div>

      <p class="shotcall-ask">Which pocket does it drop into?</p>
      <p class="shotcall-rule">${BOUNCES} bounces off anything solid &middot; each miss reveals one</p>

      <div class="shotcall-felt">
        <svg class="shotcall-table" data-table role="img" aria-label="A billiards table
          ${W} by ${H} dots, with ${POCKETS.length} pockets around the rim and a solid
          block on the cloth. The ball enters at a marked point on the rim at forty-five
          degrees."></svg>
      </div>

      <div class="shotcall-card">
        <span class="shotcall-stamp">Tier ${day.t + 1}/7</span>
        <p class="shotcall-card-head">Scorecard &middot; ${dateLabel}</p>
        <div class="shotcall-row">
          <div class="shotcall-tallies" data-tallies aria-label="Tries used"></div>
          <button class="shotcall-chalk" type="button" data-wipe hidden>Wipe</button>
          <button class="shotcall-chalk" type="button" data-chalk aria-pressed="false">Chalk</button>
        </div>
        <p class="shotcall-verdict" data-verdict aria-live="polite">Pick a pocket, or chalk the line you expect.</p>
        <p class="shotcall-score" data-score hidden></p>
        <p class="shotcall-next" data-next hidden></p>
      </div>

      <div class="shotcall-slip" data-slip hidden>
        <pre data-slip-text></pre>
        <button class="shotcall-copy" type="button" data-copy>Copy</button>
      </div>
    </div>
  `;

  const svg = el.querySelector<SVGSVGElement>('[data-table]')!;
  const talliesBox = el.querySelector<HTMLElement>('[data-tallies]')!;
  const verdictEl = el.querySelector<HTMLElement>('[data-verdict]')!;
  const nextEl = el.querySelector<HTMLElement>('[data-next]')!;
  const slipBox = el.querySelector<HTMLElement>('[data-slip]')!;
  const slipText = el.querySelector<HTMLElement>('[data-slip-text]')!;
  const copyBtn = el.querySelector<HTMLButtonElement>('[data-copy]')!;
  const chalkBtn = el.querySelector<HTMLButtonElement>('[data-chalk]')!;
  const wipeBtn = el.querySelector<HTMLButtonElement>('[data-wipe]')!;
  const scoreEl = el.querySelector<HTMLElement>('[data-score]')!;
  const root = el.querySelector<HTMLElement>('.shotcall')!;

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
  let nextTimer = 0;
  let puffRaf = 0;

  /** Armed for a mouse, where a drag never scrolled anything; off for touch. */
  let chalkOn = window.matchMedia?.('(pointer: fine)').matches ?? false;
  let drawing = false;
  let captured = false;
  let stroke: Pt[] = [];
  /** The kept line, in SVG user units. One stroke at a time. */
  let drawn: Pt[] = [];
  /** Set by a stroke so the click that follows it does not also spend a try. */
  let swallowClick = false;

  const mouths: SVGElement[] = [];
  const layers: Record<string, SVGElement> = {};

  /* ---- persistence -------------------------------------------------
     A daily game that forgets on refresh is a game you can brute-force by
     reloading, so the day's guesses are kept. Keyed by date, so tomorrow starts
     clean and yesterday is not resurrected. Every access is guarded: private
     windows and blocked site data both throw here. */

  const storeKey = `shotcall:${iso}`;
  const save = () => {
    try {
      // Rounded to whole user units: sub-pixel precision in a hand-drawn line is
      // noise, and it roughly halves what a long stroke costs to store.
      const line = drawn.map((q) => [Math.round(q.x), Math.round(q.y)]);
      localStorage.setItem(storeKey, JSON.stringify({ g: guesses, l: line }));
    } catch {
      /* not important enough to interrupt a game over */
    }
  };

  /** Accepts the bare array the first shipped version wrote, as well as the
   *  object that carries the drawn line. */
  const load = (): { guesses: number[]; line: Pt[] } => {
    const empty = { guesses: [], line: [] };
    try {
      const raw = localStorage.getItem(storeKey);
      if (!raw) return empty;
      const parsed: unknown = JSON.parse(raw);
      const rawGuesses: unknown = Array.isArray(parsed)
        ? parsed
        : (parsed as { g?: unknown })?.g;
      const rawLine: unknown = Array.isArray(parsed) ? [] : (parsed as { l?: unknown })?.l;
      if (!Array.isArray(rawGuesses)) return empty;
      return {
        guesses: rawGuesses
          .filter((n): n is number => typeof n === 'number' && n >= 0 && n < POCKETS.length)
          .slice(0, TRIES),
        line: Array.isArray(rawLine)
          ? rawLine
              .filter(
                (q): q is [number, number] =>
                  Array.isArray(q) && typeof q[0] === 'number' && typeof q[1] === 'number',
              )
              .map(([x, y]) => ({ x, y }))
          : [],
      };
    } catch {
      return empty;
    }
  };
  /** Yesterday's key is never read again, and nothing else deletes it now that
   *  there is no replay button — so a year of play would leave 365 dead entries.
   *  Swept on mount, which is the only moment we know today's date here. */
  const sweepOldDays = () => {
    try {
      const stale: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        // `carom:` was this game's key prefix before it was renamed. Anyone who
        // played it in that window has a dead entry that nothing else will ever
        // read or remove, so it goes too.
        if (k.startsWith('carom:')) stale.push(k);
        else if (k.startsWith('shotcall:') && k !== storeKey) stale.push(k);
      }
      for (const k of stale) localStorage.removeItem(k);
    } catch {
      /* see save() */
    }
  };

  /* ---- the table --------------------------------------------------- */

  function defs() {
    const d = node('defs');

    const lit = node('radialGradient', { id: 'shotcall-lit', cx: '50%', cy: '40%', r: '74%' });
    lit.appendChild(node('stop', { offset: '0', 'stop-color': '#3f8474' }));
    lit.appendChild(node('stop', { offset: '0.62', 'stop-color': '#336a5b' }));
    lit.appendChild(node('stop', { offset: '1', 'stop-color': '#265045' }));
    d.appendChild(lit);

    const grain = node('linearGradient', { id: 'shotcall-grain', x1: '0', y1: '0', x2: '0', y2: '1' });
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
      rx: 11, fill: 'url(#shotcall-grain)',
    }));
    svg.appendChild(node('rect', {
      x: PAD - RAIL + 3.5, y: PAD - RAIL + 3.5,
      width: TW + RAIL * 2 - 7, height: TH + RAIL * 2 - 7,
      rx: 8, fill: 'none', stroke: '#9c7551', 'stroke-width': 1, 'stroke-opacity': 0.55,
    }));
    svg.appendChild(node('rect', {
      x: PAD - 4, y: PAD - 4, width: TW + 8, height: TH + 8, rx: 3, fill: '#1b3a32',
    }));
    svg.appendChild(node('rect', { x: PAD, y: PAD, width: TW, height: TH, fill: 'url(#shotcall-lit)' }));

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
    svg.appendChild(node('rect', { x: bx, y: by, width: bw, height: bh, rx: 4, fill: 'url(#shotcall-grain)' }));
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
    // The player's line sits under the pockets, so a pocket keeps its tap target.
    layers.mine = node('path', {
      d: '', fill: 'none', stroke: '#e8b44a', 'stroke-width': 3.2,
      'stroke-opacity': 0.85, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    });
    svg.appendChild(layers.mine);

    // pockets: brass rim, real hole
    POCKETS.forEach((p, i) => {
      const g = node('g', { class: 'shotcall-pk', role: 'button', tabindex: 0 });
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

      const tag = node('text', {
        class: 'lbl',
        x: sx(p.x),
        y: sy(p.y) - 1,
        'font-size': LABEL_SIZE,
        fill: '#bd9a63',
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        'pointer-events': 'none',
      });
      tag.textContent = LETTERS[i] ?? '?';
      g.appendChild(tag);

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

    layers.puff = node('g', { 'pointer-events': 'none' });
    svg.appendChild(layers.puff);
    layers.ball = node('g');
    svg.appendChild(layers.ball);
    paintMine();
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

  /* ---- the player's own chalk line ---------------------------------
     Freehand: the points are where the pointer actually went, with no snapping
     to the lattice and no smoothing, because a hand-drawn guess next to an exact
     path is the whole point of the comparison. Only consecutive points further
     than DEDUP apart are kept, which trims the data without changing the shape. */

  const DEDUP = 3;               // user units between kept points
  const MIN_STROKE = 2 * CELL;   // 2 dots of travel, below which it was a tap

  function paintMine() {
    const g = layers.mine;
    if (!g) return;
    const pts = drawing && stroke.length ? stroke : drawn;
    g.setAttribute(
      'd',
      pts.length < 2 ? '' : `M${pts[0]!.x} ${pts[0]!.y}` + pts.slice(1).map((q) => `L${q.x} ${q.y}`).join(''),
    );
  }

  /** Client coordinates into the SVG's own units, so the line survives any
   *  viewport width and the score is measured in dots rather than pixels. */
  function toUser(ev: PointerEvent): Pt | null {
    const m = svg.getScreenCTM();
    if (!m) return null;
    const q = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse());
    if (q.x < 0 || q.y < 0 || q.x > TW + PAD * 2 || q.y > TH + PAD * 2) return null;
    return { x: Math.round(q.x * 10) / 10, y: Math.round(q.y * 10) / 10 };
  }

  const strokeLength = (pts: Pt[]) => {
    let n = 0;
    for (let i = 1; i < pts.length; i++) n += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
    return n;
  };

  function onDown(ev: PointerEvent) {
    swallowClick = false;
    if (!chalkOn || over || rolling || ev.button > 0) return;
    const q = toUser(ev);
    if (!q) return;
    /* NOT preventDefault() here. On touch, preventing the default on pointerdown
       suppresses the synthesised click that follows — measured: with it, a finger
       tap on a pocket spent no try at all while chalk was armed. Selection and
       native drag are suppressed on the first move instead, by which point this
       is a stroke and not a tap. */
    drawing = true;
    captured = false;
    stroke = [q];
  }

  function onMove(ev: PointerEvent) {
    if (!drawing) return;
    const q = toUser(ev);
    if (!q) return;
    const last = stroke[stroke.length - 1]!;
    if (Math.hypot(q.x - last.x, q.y - last.y) < DEDUP) return;
    stroke.push(q);
    ev.preventDefault(); // no text selection, no drag-image, now that it is a stroke
    /* Capture only once this is definitely a stroke, never on pointerdown.
       Pointer capture retargets the click that follows to the capture element,
       so capturing eagerly silently stopped every pocket from taking a tap
       while chalk was armed. Measured, not guessed: with capture on pointerdown
       a click on a pocket spent no try at all. */
    if (!captured) {
      captured = true;
      try {
        svg.setPointerCapture(ev.pointerId);
      } catch {
        /* a nicety: without it the stroke just ends when the pointer leaves */
      }
    }
    paintMine();
  }

  function onUp(ev: PointerEvent) {
    if (!drawing) return;
    drawing = false;
    if (captured) {
      try {
        svg.releasePointerCapture(ev.pointerId);
      } catch {
        /* see onMove */
      }
    }
    // A tap is not a stroke. Discarding short ones is also what stops a stray
    // twitch from wiping a line the player spent real effort on.
    if (stroke.length > 1 && strokeLength(stroke) >= MIN_STROKE) {
      drawn = stroke;
      swallowClick = true;
      save();
      syncWipe();
      if (over) showScore();
    }
    stroke = [];
    paintMine();
  }

  svg.addEventListener('pointerdown', onDown);
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerup', onUp);
  svg.addEventListener('pointercancel', onUp);

  function setChalk(on: boolean) {
    chalkOn = on;
    root.classList.toggle('chalking', on && !over);
    chalkBtn.setAttribute('aria-pressed', String(on));
  }

  chalkBtn.addEventListener('click', () => setChalk(!chalkOn));

  /** A line you cannot erase is a line you get one attempt at. Only offered while
   *  there is something to erase and the day is still open. */
  function syncWipe() {
    wipeBtn.hidden = over || drawn.length < 2;
  }

  /**
   * The erase: one eraser, scrubbing in place, taking the whole line with it.
   *
   * It does not travel across the board. It sits on the line and shakes — the
   * fast, tight, slightly impatient motion of someone rubbing at one small mark —
   * and the entire line degrades anyway. That gap between a tiny gesture and a
   * total effect is the joke, and it only works if the eraser stays put.
   *
   * Still staccato: the damage lands in three discrete scrubs with a beat of
   * nothing between them, because a board being cleared goes in strokes and a
   * smooth fade is what a computer does.
   *
   * The patchiness is two effects, because either one alone looks wrong. Whole
   * pieces of the line drop out (the eraser took them), and the pieces that
   * survive get a broken dasharray and a thinner stroke (it dragged across them
   * and took some). Faded-but-solid chalk does not look like chalk, and the line
   * has to be drawn in pieces rather than as one path for any of it to be
   * possible — a single path can only fade as a whole.
   */
  const SCRUBS = 3;
  const SCRUB_MS = 200;
  const SCRUB_GAP = 90;
  const ERASE_MS = SCRUBS * SCRUB_MS + (SCRUBS - 1) * SCRUB_GAP;

  type Chunk = {
    el: SVGElement;
    midX: number;
    midY: number;
    alpha: number;
    scrubs: number; // how many scrubs have hit it
  };
  type Mote = {
    el: SVGElement;
    x: number; y: number;
    vx: number; vy: number;
    grow: number; peak: number;
    born: number;
  };

  function eraseLine(erased: Pt[]) {
    const g = layers.puff;
    if (!g) return;
    clear(g);

    const chunks: Chunk[] = [];
    const PER = 2; // segments per piece
    for (let i = 0; i < erased.length - 1; i += PER) {
      const seg = erased.slice(i, Math.min(erased.length, i + PER + 1));
      if (seg.length < 2) continue;
      const el = node('path', {
        d: `M${seg[0]!.x} ${seg[0]!.y}` + seg.slice(1).map((q) => `L${q.x} ${q.y}`).join(''),
        fill: 'none', stroke: '#e8b44a', 'stroke-width': 3.2,
        'stroke-opacity': 0.85, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      });
      g.appendChild(el);
      const mid = seg[Math.floor(seg.length / 2)]!;
      chunks.push({ el, midX: mid.x, midY: mid.y, alpha: 1, scrubs: 0 });
    }
    if (!chunks.length) return;

    // it sits on the middle of the line, which is the one spot that always has
    // chalk under it whatever shape was drawn
    const anchor = erased[Math.floor(erased.length / 2)]!;

    const eraser = node('g', {});
    eraser.appendChild(node('rect', { x: -23, y: -3, width: 46, height: 13, rx: 3, fill: '#d8cdb4' }));
    eraser.appendChild(node('rect', { x: -23, y: -13, width: 46, height: 11, rx: 3, fill: '#6b4a32' }));
    eraser.appendChild(node('rect', {
      x: -20, y: -11, width: 40, height: 6, rx: 2,
      fill: 'none', stroke: '#9c7551', 'stroke-width': 0.8, 'stroke-opacity': 0.7,
    }));
    g.appendChild(eraser);

    const motes: Mote[] = [];
    const raiseDust = (x: number, y: number, n: number, now: number, spread = 14) => {
      for (let k = 0; k < n; k++) {
        const el = node('circle', {
          cx: x + (Math.random() - 0.5) * spread,
          cy: y + (Math.random() - 0.5) * spread,
          r: 2.2, fill: '#f2e6c8', 'fill-opacity': 0,
        });
        g.appendChild(el);
        motes.push({
          el,
          x: Number(el.getAttribute('cx')),
          y: Number(el.getAttribute('cy')),
          vx: (Math.random() - 0.5) * 20,
          vy: -7 - Math.random() * 15,
          grow: 5 + Math.random() * 6,
          peak: 0.3 + Math.random() * 0.3,
          born: now,
        });
      }
    };

    const MOTE_MS = 520;
    let t0: number | null = null;

    const frame = (t: number) => {
      if (t0 === null) t0 = t;
      const ms = t - t0;

      const cycle = SCRUB_MS + SCRUB_GAP;
      const scrub = Math.min(SCRUBS - 1, Math.floor(ms / cycle));
      const inScrub = ms - scrub * cycle;
      const scrubbing = inScrub <= SCRUB_MS && ms < ERASE_MS;

      /* The shake. A sideways oscillation at roughly 11Hz does the scrubbing;
         the small random component on top is what stops it reading as a machine.
         It settles to still between scrubs rather than vibrating continuously,
         which is what makes the three strokes legible as strokes. */
      if (ms < ERASE_MS) {
        const amp = scrubbing ? 1 : 0.15;
        const dx = Math.sin(ms / 14.5) * 6 * amp + (Math.random() - 0.5) * 2.5 * amp;
        const dy = Math.sin(ms / 9) * 1.6 * amp + (Math.random() - 0.5) * 1.8 * amp;
        const rot = -4 + Math.sin(ms / 17) * 3.5 * amp;
        eraser.setAttribute('opacity', '0.95');
        eraser.setAttribute('transform', `translate(${anchor.x + dx} ${anchor.y + dy}) rotate(${rot})`);
        if (scrubbing && Math.random() < 0.4) raiseDust(anchor.x + dx, anchor.y + dy, 1, t, 20);
      } else {
        eraser.setAttribute('opacity', '0');
      }

      // one scrub, one round of damage — to every piece still standing, wherever
      // on the board it happens to be
      if (scrubbing) {
        for (const c of chunks) {
          if (c.scrubs > scrub || c.alpha === 0) continue;
          c.scrubs = scrub + 1;
          if (scrub === SCRUBS - 1) {
            c.alpha = 0;
          } else {
            c.alpha *= 0.2 + Math.random() * 0.35;
            if (Math.random() < 0.34) c.alpha = 0; // taken whole
          }
          if (c.alpha === 0) {
            c.el.setAttribute('stroke-opacity', '0');
            if (Math.random() < 0.5) raiseDust(c.midX, c.midY, 1, t);
          } else {
            c.el.setAttribute('stroke-opacity', String(0.85 * c.alpha));
            c.el.setAttribute('stroke-width', String(1.5 + 1.7 * c.alpha));
            c.el.setAttribute(
              'stroke-dasharray',
              c.alpha < 0.35
                ? `${1 + Math.random() * 2} ${4 + Math.random() * 4}`
                : `${3 + Math.random() * 3} ${2 + Math.random() * 3}`,
            );
            c.el.setAttribute('stroke-dashoffset', String(Math.random() * 8));
          }
        }
      }

      for (let i = motes.length - 1; i >= 0; i--) {
        const m = motes[i]!;
        const mp = (t - m.born) / MOTE_MS;
        if (mp >= 1) {
          m.el.remove();
          motes.splice(i, 1);
          continue;
        }
        const fade = mp < 0.16 ? mp / 0.16 : 1 - (mp - 0.16) / 0.84;
        m.el.setAttribute('fill-opacity', String(Math.max(0, m.peak * fade)));
        m.el.setAttribute('r', String(2.2 + m.grow * mp));
        m.el.setAttribute('cx', String(m.x + m.vx * mp));
        m.el.setAttribute('cy', String(m.y + m.vy * mp));
      }

      // belt and braces: nothing survives the last scrub, whatever the frame timing
      if (ms >= ERASE_MS) {
        for (const c of chunks) {
          if (c.alpha === 0) continue;
          c.alpha = 0;
          c.el.setAttribute('stroke-opacity', '0');
        }
      }

      if (ms < ERASE_MS + MOTE_MS) {
        puffRaf = requestAnimationFrame(frame);
      } else {
        puffRaf = 0;
        clear(g);
      }
    };

    if (puffRaf) cancelAnimationFrame(puffRaf);
    puffRaf = requestAnimationFrame(frame);
  }

  wipeBtn.addEventListener('click', () => {
    const erased = drawn;
    drawn = [];
    stroke = [];
    save();
    paintMine();
    syncWipe();
    if (!reducedMotion() && erased.length > 1) eraseLine(erased);
  });

  /**
   * How far the drawn line is from the true one, in dots.
   *
   * Symmetric mean nearest-point distance. The one-sided version — every drawn
   * point to its nearest point on the path — scores a one-inch scribble sitting
   * on the path as almost perfect. Measuring the path against the drawing too is
   * what makes a line that did not go anywhere score like one.
   */
  function chalkError(): number | null {
    if (drawn.length < 2) return null;

    const P = screenPath();
    const samples: Pt[] = [];
    const spacing = CELL / 4;
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i]!, b = P[i + 1]!;
      const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / spacing));
      for (let k = 0; k < n; k++)
        samples.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
    }
    samples.push(P[P.length - 1]!);

    const nearest = (q: Pt, set: Pt[]) => {
      let best = Infinity;
      for (const r of set) {
        const d = (r.x - q.x) ** 2 + (r.y - q.y) ** 2;
        if (d < best) best = d;
      }
      return Math.sqrt(best);
    };

    let mine = 0;
    for (const q of drawn) mine += nearest(q, samples);
    let theirs = 0;
    for (const q of samples) theirs += nearest(q, drawn);

    return (mine / drawn.length + theirs / samples.length) / 2 / CELL;
  }

  function showScore() {
    const off = chalkError();
    if (off === null) {
      scoreEl.hidden = true;
      return;
    }
    const verdict =
      off < 0.8 ? 'nearly exact' : off < 1.6 ? 'close' : off < 3 ? 'roughly the route' : 'a different route';
    scoreEl.innerHTML = `Your line: <b>${off.toFixed(1)}</b> dots off &mdash; ${verdict}.`;
    scoreEl.hidden = false;
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

    const reduced = reducedMotion();
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
      cell.className = 'shotcall-tally' + (g === undefined ? '' : g === ANSWER ? ' hit' : '');
      cell.textContent = g === undefined ? '' : g === ANSWER ? '✓' : '✕';
      talliesBox.appendChild(cell);
    }
  }

  function say(html: string, cls?: string) {
    verdictEl.className = 'shotcall-verdict' + (cls ? ' ' + cls : '');
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
    mouths[i]?.querySelector('text.lbl')?.setAttribute('fill', '#f0d79a');
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
    // The click that ends a stroke lands on whatever was under the pointer, which
    // is often a pocket. Drawing a line is not guessing.
    if (swallowClick) {
      swallowClick = false;
      return;
    }
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
    showScore();
    setChalk(chalkOn); // over now, so the cursor and touch-action come off
    chalkBtn.disabled = true;
    syncWipe();
    slipText.textContent = slip();
    slipBox.hidden = false;
    startCountdown();
  }

  /* ---- the wait --------------------------------------------------------
     What a daily game owes you once the day is spent: how long until the next
     one. Local midnight, because the board is picked from the visitor's own
     date — the same reason localISO() exists. */

  function msToMidnight() {
    const next = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    return next.getTime() - Date.now();
  }

  function startCountdown() {
    const tick = () => {
      const ms = msToMidnight();
      if (ms <= 0) {
        nextEl.innerHTML = 'A new board is ready &mdash; reload the page';
        window.clearInterval(nextTimer);
        nextTimer = 0;
        return;
      }
      const total = Math.floor(ms / 1000);
      const pad = (n: number) => String(n).padStart(2, '0');
      nextEl.innerHTML =
        `Next board in <b>${Math.floor(total / 3600)}:` +
        `${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}</b>`;
    };
    nextEl.hidden = false;
    tick();
    window.clearInterval(nextTimer);
    nextTimer = window.setInterval(tick, 1000);
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
    const off = chalkError();
    return (
      `Shotcall · ${dateLabel}\n${row}   ${won ? `${guesses.length}/${TRIES}` : `x/${TRIES}`}` +
      (off === null ? '' : `\nchalk line ${off.toFixed(1)} dots off`)
    );
  }

  /* ---- controls ---------------------------------------------------- */

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

  sweepOldDays();
  const saved = load();
  drawn = saved.line;
  build();
  setChalk(chalkOn);
  syncWipe();
  if (saved.guesses.length) {
    for (const i of saved.guesses) {
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
    if (puffRaf) cancelAnimationFrame(puffRaf);
    raf = 0;
    puffRaf = 0;
    rolling = false;
    window.clearTimeout(copyTimer);
    window.clearInterval(nextTimer);
    el.innerHTML = '';
  };
}
