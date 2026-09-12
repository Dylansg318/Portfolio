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
import { difficulty, randomBoard } from './board.mjs';
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
type Box = { bx: number; by: number; bx2: number; by2: number };

/** Everything a re-rack needs to know about the board it is racking TO.
 *
 *  A generated board carries a great deal more (legs, ring distance, canon,
 *  difficulty); the day's board, rebuilt from boards.json, carries exactly this
 *  and nothing else. Typing the parameter by what it reads rather than by where
 *  it usually comes from is what lets the table rack BACK to the day's board. */
type Rack = { B: Box; entry: Pt; dir: Pt; pockets: Pt[] };

const DAYS = data.days as Record<string, Day>;
/** The six scores that separate the seven tiers, from the dealt pool. Lets a
 *  board built in the browser name its own tier on the same scale. */
const TIER_CUTS = (data.tierCuts ?? []) as number[];
const TIERS = TIER_CUTS.length + 1;
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
.shotcall-pk:focus-visible circle.lip { stroke: var(--chalk); stroke-width: 3.4; }
/* The aim arrow goes once the ball has left: after the first leg it only sits on
   top of the path it was predicting. The entry mark on the rail stays. */
.shotcall-aim { transition: opacity 320ms ease; }
/* A ruled-out pocket is chalked, so the X is drawn rather than stamped: each
   stroke is a dash the length of itself, pulled on from one end. The second
   stroke starts as the first one lands. */
.shotcall-x { stroke-dasharray: 50; stroke-dashoffset: 50; animation: shotcall-draw 150ms ease-out forwards; }
.shotcall-x.second { animation-delay: 110ms; }
@keyframes shotcall-draw { to { stroke-dashoffset: 0; } }
/* The pocket the ball dropped into rings once, so the eye lands on it. */
.shotcall-ring { animation: shotcall-ring 460ms cubic-bezier(0.16, 1, 0.3, 1) forwards; transform-box: fill-box; transform-origin: center; }
@keyframes shotcall-ring { from { transform: scale(0.5); opacity: 0.95; } to { transform: scale(2.2); opacity: 0; } }

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
/* Wraps because a phone cannot fit four tally boxes plus Rack another plus
   Chalk on one line, and an overflowing row would push a control off the card. */
.shotcall-row { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin: 0 0 9px; }
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
/* The pills are 29px tall with a mouse, which is fine to click and under the
   44px a finger wants. Grown on coarse pointers only, so the paper scorecard
   keeps its proportions on a desktop. */
@media (pointer: coarse) {
  .shotcall-chalk { padding-block: 0.72rem; }
}

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
  display: flex; flex-direction: column; gap: 10px;
}
.shotcall-slip-row { display: flex; align-items: center; gap: 14px; }
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
/* Where to play, under the score. break-word, not anywhere: anywhere breaks at
   the last character that fits and so ignores the <wbr> offered before the path,
   which is the whole point of putting one there. (No backticks in this block --
   it is a template literal.) */
.shotcall-slip-url {
  font-family: var(--card-face); font-size: 0.72rem; line-height: 1.5;
  color: var(--warm-dim); text-decoration: none; overflow-wrap: break-word;
  border-top: 1px dashed rgba(200, 179, 148, 0.22); padding-top: 9px;
}
.shotcall-slip-url:hover { color: var(--brass-lit); }

.shotcall [hidden] { display: none !important; }
.shotcall :focus-visible { outline: 2px solid var(--brass-lit); outline-offset: 3px; }
/* After the generic rule, deliberately: at equal specificity the later one wins,
   and declared above it this lost, so Tab drew a brass box round the hit circle
   instead of lighting the lip. A pocket's focus ring is the lip itself. */
.shotcall-pk:focus-visible { outline: none; }

@media (max-width: 560px) {
  /* Every pixel here is table. The board is upright at this width (see
     PORTRAIT_MQ) and a phone has none to spare on a gutter. */
  .shotcall { padding-inline: 10px; padding-block: 14px 22px; }
  /* The first screen has to hold the table AND the verdict line under it, or a
     player taps a pocket and scrolls to find out what happened. Measured at
     393x852 before this block existed: the verdict sat at 828px, under Safari's
     bars. Every margin here is the smallest that still reads as a gap. */
  .shotcall-sign { padding-bottom: 7px; margin-bottom: 12px; }
  .shotcall-rule { margin-bottom: 12px; }
  .shotcall-felt { margin-bottom: 14px; }
  .shotcall-card { padding: 12px 16px 12px; }
  .shotcall-card-head { margin-bottom: 8px; }
  /* A floor for the scorecard on a short phone. The upright table is taller than
     it is wide, so without this it can push the card off the first screen. */
  .shotcall-table { max-height: 68dvh; }
  /* The date stays on the name's line when it fits, which it does for a plain
     date; only the off-calendar note is long enough to wrap under it. */
  .shotcall-sign { flex-wrap: wrap; }
  .shotcall-card, .shotcall-slip { max-width: none; }
  .shotcall-slip-row { flex-wrap: wrap; }
}
@media (prefers-reduced-motion: reduce) {
  .shotcall * { transition-duration: 0ms !important; animation-duration: 0ms !important; animation-delay: 0ms !important; }
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

  /* The table size is fixed for the life of the mount, and every later board is
     built on it. That is not laziness: "Rack another" re-racks THIS table, and a
     mechanical re-rack that silently changed the size of the furniture would not
     be a re-rack. It also means the frame, the projection and the letters are all
     stable, and only the block, the entry and the pockets move. */
  const W = day.s[0]!;
  const H = day.s[1]!;

  let BLOCK = { bx: day.b[0]!, by: day.b[1]!, bx2: day.b[2]!, by2: day.b[3]! };
  let ENTRY = { x: day.e[0]!, y: day.e[1]! };
  let DIR = { x: day.d[0]!, y: day.d[1]! };
  let POCKETS = day.p.map(([x, y]) => ({ x: x!, y: y! }));

  /* The day's board, kept whole so the table can rack BACK to it.
     Copied rather than aliased: BLOCK, ENTRY, DIR and POCKETS are all reassigned
     by a re-rack, so holding references here would leave this pointing at
     whichever practice board was last dealt. */
  const DAY: Rack = {
    B: { ...BLOCK },
    entry: { ...ENTRY },
    dir: { ...DIR },
    pockets: POCKETS.map((q) => ({ ...q })),
  };

  // The path, and therefore the answer, derived rather than read. See the header.
  let PATH: Pt[] = [];
  let LAST = 0;
  let ANSWER = -1;

  /** Re-derives everything that follows from a board. */
  function deriveBoard() {
    const hits = contacts(W, H, BLOCK, ENTRY, DIR, CONTACTS);
    PATH = [ENTRY, ...hits.map((c) => ({ x: c.x, y: c.y }))];
    LAST = PATH.length - 1;
    const end = PATH[LAST]!;
    ANSWER = POCKETS.findIndex((p) => p.x === end.x && p.y === end.y);
  }
  deriveBoard();

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
        <!-- role=group, not role=img. An img's children are presentational by
             spec, and a table with fourteen buttons on it is not a picture.
             Checked rather than assumed: Chromium's own tree (over the DevTools
             protocol, not a tool's DOM walk) still exposed the pockets under img,
             because focusable descendants override that rule. So this is the
             honest role, not a fix for a screen reader that could not find them. -->
        <svg class="shotcall-table" data-table role="group" aria-label="A billiards table
          ${W} by ${H} dots, with ${POCKETS.length} pockets around the rim and a solid
          block on the cloth. The ball enters at a marked point on the rim at forty-five
          degrees."></svg>
      </div>

      <div class="shotcall-card">
        <span class="shotcall-stamp" data-stamp>Tier ${day.t + 1}/${TIERS}</span>
        <p class="shotcall-card-head">Scorecard &middot; <span data-cardhead>${dateLabel}</span></p>
        <div class="shotcall-row">
          <div class="shotcall-tallies" data-tallies aria-label="Tries used"></div>
          <button class="shotcall-chalk" type="button" data-rack hidden>Rack another</button>
          <button class="shotcall-chalk" type="button" data-today hidden>Today's board</button>
          <button class="shotcall-chalk" type="button" data-wipe hidden>Wipe</button>
          <button class="shotcall-chalk" type="button" data-chalk aria-pressed="false">Chalk</button>
        </div>
        <p class="shotcall-verdict" data-verdict aria-live="polite">Pick a pocket, or chalk the line you expect.</p>
        <p class="shotcall-score" data-score hidden></p>
        <p class="shotcall-next" data-next hidden></p>
      </div>

      <div class="shotcall-slip" data-slip hidden>
        <div class="shotcall-slip-row">
          <pre data-slip-text></pre>
          <button class="shotcall-copy" type="button" data-copy>Copy</button>
        </div>
        <a class="shotcall-slip-url" data-slip-url href="/play/shotcall"></a>
      </div>
    </div>
  `;

  const svg = el.querySelector<SVGSVGElement>('[data-table]')!;
  const talliesBox = el.querySelector<HTMLElement>('[data-tallies]')!;
  const verdictEl = el.querySelector<HTMLElement>('[data-verdict]')!;
  const nextEl = el.querySelector<HTMLElement>('[data-next]')!;
  const slipBox = el.querySelector<HTMLElement>('[data-slip]')!;
  const slipText = el.querySelector<HTMLElement>('[data-slip-text]')!;
  const slipUrl = el.querySelector<HTMLAnchorElement>('[data-slip-url]')!;
  const copyBtn = el.querySelector<HTMLButtonElement>('[data-copy]')!;
  const chalkBtn = el.querySelector<HTMLButtonElement>('[data-chalk]')!;
  const wipeBtn = el.querySelector<HTMLButtonElement>('[data-wipe]')!;
  const rackBtn = el.querySelector<HTMLButtonElement>('[data-rack]')!;
  const todayBtn = el.querySelector<HTMLButtonElement>('[data-today]')!;
  const stampEl = el.querySelector<HTMLElement>('[data-stamp]')!;
  const cardHeadEl = el.querySelector<HTMLElement>('[data-cardhead]')!;
  const scoreEl = el.querySelector<HTMLElement>('[data-score]')!;
  const root = el.querySelector<HTMLElement>('.shotcall')!;

  /* ---- projection -------------------------------------------------- */

  const TW = W * CELL;
  const TH = H * CELL;
  const sx = (x: number) => PAD + x * CELL;
  const sy = (y: number) => PAD + (H - y) * CELL; // y up, like the generator

  /* PORTRAIT ON A PHONE.
   *
   * A pool table is landscape and a phone is not, so a table fitted to the width
   * of a phone uses about a quarter of the screen and leaves the rest empty —
   * measured at 393px: a 314x238 table in an 852px-tall viewport. Every pool game
   * on a phone turns the table upright for this reason, and so does this one.
   *
   * It is done by rotating ONE group rather than by transposing the projection.
   * sx/sy, the path, the block, the re-rack flights and the hit targets all stay
   * in the same landscape user space, which matters for more than convenience:
   * the player's chalk line is persisted in those units, so a line drawn on a
   * phone has to line up with the same board opened on a desktop. Rotating the
   * stage leaves the stored geometry alone and changes only how it is shown.
   *
   * Two things do not want the rotation. The pocket letters are counter-rotated
   * so they stay upright, and pointer input is read through the STAGE's matrix
   * rather than the svg's, so a drawn point comes back in landscape units. */
  const PORTRAIT_MQ = window.matchMedia('(max-width: 560px)');
  let portrait = PORTRAIT_MQ.matches;
  /** Everything drawn lives in here. Re-made by build(). Typed as a graphics
   *  element, not an SVGElement, because the pointer path reads its matrix. */
  let stage: SVGGraphicsElement = svg;

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
  /** The kept chalk, in SVG user units: one entry per stroke, in the order
   *  they were drawn. Strokes accumulate — only Wipe takes them off. */
  let drawn: Pt[][] = [];
  /** Whether there is any chalk on the cloth. Every stroke kept has >1 point. */
  const hasChalk = () => drawn.length > 0;
  /** Set by a stroke so the click that follows it does not also spend a try. */
  let swallowClick = false;
  /** True once the day's board has been set aside for a table-made one. */
  let practice = false;
  /** Mirror-family ids already shown, so "Rack another" never repeats itself. */
  const seen = new Set<string>();

  const mouths: SVGElement[] = [];
  const layers: Record<string, SVGElement> = {};

  /* ---- persistence -------------------------------------------------
     A daily game that forgets on refresh is a game you can brute-force by
     reloading, so the day's guesses are kept. Keyed by date, so tomorrow starts
     clean and yesterday is not resurrected. Every access is guarded: private
     windows and blocked site data both throw here. */

  /** One stroke out of stored [x, y] pairs, dropping anything malformed. */
  const readStroke = (v: unknown): Pt[] =>
    Array.isArray(v)
      ? v
          .filter(
            (q): q is [number, number] =>
              Array.isArray(q) && typeof q[0] === 'number' && typeof q[1] === 'number',
          )
          .map(([x, y]) => ({ x, y }))
      : [];

  /** The stored chalk, either shape. Until strokes accumulated, `l` was one flat
   *  list of pairs; now it is a list of those. A first element whose own first
   *  element is a number is the old shape, and becomes a single stroke. */
  const readStrokes = (v: unknown): Pt[][] => {
    if (!Array.isArray(v) || !v.length) return [];
    const flat = Array.isArray(v[0]) && typeof (v[0] as unknown[])[0] === 'number';
    return (flat ? [readStroke(v)] : v.map(readStroke)).filter((st) => st.length > 1);
  };

  const storeKey = `shotcall:${iso}`;
  const save = () => {
    if (practice) return; // a practice board is not the day's record
    try {
      // Rounded to whole user units: sub-pixel precision in a hand-drawn line is
      // noise, and it roughly halves what a long stroke costs to store.
      const line = drawn.map((st) => st.map((q) => [Math.round(q.x), Math.round(q.y)]));
      localStorage.setItem(storeKey, JSON.stringify({ g: guesses, l: line }));
    } catch {
      /* not important enough to interrupt a game over */
    }
  };

  /** Accepts the bare array the first shipped version wrote, the object with a
   *  single flat line that followed it, and the list of strokes written now. */
  const load = (): { guesses: number[]; line: Pt[][] } => {
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
        line: readStrokes(rawLine),
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

    /* userSpaceOnUse, not the default objectBoundingBox, and that is load-bearing.
       The re-rack slides cloth panels over the cloth, and a gradient measured
       against each shape's own box paints a small panel with the whole sweep of
       light squeezed into it — the panel then reads as a differently-lit patch
       instead of as more table. Anchored to the table's own coordinates, a panel
       is pixel-identical to what it covers and only its edge gives it away. */
    const lit = node('radialGradient', {
      id: 'shotcall-lit',
      gradientUnits: 'userSpaceOnUse',
      cx: PAD + TW / 2,
      cy: PAD + TH * 0.4,
      r: 0.62 * Math.hypot(TW, TH),
    });
    lit.appendChild(node('stop', { offset: '0', 'stop-color': '#3f8474' }));
    lit.appendChild(node('stop', { offset: '0.62', 'stop-color': '#336a5b' }));
    lit.appendChild(node('stop', { offset: '1', 'stop-color': '#265045' }));
    d.appendChild(lit);

    const grain = node('linearGradient', { id: 'shotcall-grain', x1: '0', y1: '0', x2: '0', y2: '1' });
    grain.appendChild(node('stop', { offset: '0', 'stop-color': '#7d5739' }));
    grain.appendChild(node('stop', { offset: '0.5', 'stop-color': '#6b4a32' }));
    grain.appendChild(node('stop', { offset: '1', 'stop-color': '#543823' }));
    d.appendChild(grain);

    // The cloth, as a clip. The re-rack's panels start a block-width outside the
    // slot they are about to cover, and without this they were painted across
    // the rail on the way in — on a phone, poking out above the top of the table.
    const cloth = node('clipPath', { id: 'shotcall-cloth' });
    cloth.appendChild(node('rect', { x: PAD, y: PAD, width: TW, height: TH }));
    d.appendChild(cloth);

    stage.appendChild(d);
  }

  /* ---- the table, in layers ----------------------------------------
     Split so the re-rack can drive the moving parts. Everything that depends on
     the board — the block, the pockets, the entry mark — clears and
     redraws its own layer; everything that does not (the cabinet, the frame, the
     cloth) is built once and never touched again. */

  function furniture() {
    // cabinet shadow, walnut frame, then the cloth
    stage.appendChild(node('rect', {
      x: PAD - RAIL - 7, y: PAD - RAIL - 5,
      width: TW + (RAIL + 7) * 2, height: TH + (RAIL + 7) * 2,
      rx: 15, fill: '#000000', 'fill-opacity': 0.5,
    }));
    stage.appendChild(node('rect', {
      x: PAD - RAIL, y: PAD - RAIL, width: TW + RAIL * 2, height: TH + RAIL * 2,
      rx: 11, fill: 'url(#shotcall-grain)',
    }));
    stage.appendChild(node('rect', {
      x: PAD - RAIL + 3.5, y: PAD - RAIL + 3.5,
      width: TW + RAIL * 2 - 7, height: TH + RAIL * 2 - 7,
      rx: 8, fill: 'none', stroke: '#9c7551', 'stroke-width': 1, 'stroke-opacity': 0.55,
    }));
    stage.appendChild(node('rect', {
      x: PAD - 4, y: PAD - 4, width: TW + 8, height: TH + 8, rx: 3, fill: '#1b3a32',
    }));
    stage.appendChild(node('rect', { x: PAD, y: PAD, width: TW, height: TH, fill: 'url(#shotcall-lit)' }));
  }

  const blockBox = (b: typeof BLOCK) => ({
    x: sx(b.bx), y: sy(b.by2), w: (b.bx2 - b.bx) * CELL, h: (b.by2 - b.by) * CELL,
  });

  /** The block: a walnut wedge bolted to the cloth. */
  function drawBlock(at = BLOCK) {
    const g = layers.block!;
    clear(g);
    g.removeAttribute('transform');
    g.removeAttribute('opacity');
    const { x: bx, y: by, w: bw, h: bh } = blockBox(at);
    g.appendChild(node('rect', {
      x: bx + 1, y: by + 5, width: bw, height: bh, rx: 4, fill: '#000000', 'fill-opacity': 0.42,
    }));
    g.appendChild(node('rect', { x: bx, y: by, width: bw, height: bh, rx: 4, fill: 'url(#shotcall-grain)' }));
    g.appendChild(node('rect', {
      x: bx + 3, y: by + 3, width: bw - 6, height: bh - 6, rx: 2,
      fill: 'none', stroke: '#9c7551', 'stroke-width': 1, 'stroke-opacity': 0.6,
    }));
    // two bolts, inset from the short ends whichever way round the block is
    const boltInset = Math.min(9, bw / 2 - 2);
    for (const q of [[bx + boltInset, by + bh / 2], [bx + bw - boltInset, by + bh / 2]]) {
      g.appendChild(node('circle', { cx: q[0]!, cy: q[1]!, r: 2.2, fill: '#3a281d' }));
      g.appendChild(node('circle', { cx: q[0]!, cy: q[1]! - 0.7, r: 1.5, fill: '#b08d57' }));
    }
  }

  /** Pockets: brass rim, real hole, letter in the hole. */
  function drawPockets() {
    const g = layers.pockets!;
    clear(g);
    mouths.length = 0;

    POCKETS.forEach((p, i) => {
      const mouth = node('g', { class: 'shotcall-pk', role: 'button', tabindex: 0 });
      const label = document.createElementNS(NS, 'title');
      label.textContent = `Pocket ${LETTERS[i]}`;
      mouth.appendChild(label);
      mouth.appendChild(node('circle', { cx: sx(p.x), cy: sy(p.y), r: HIT_R, fill: 'transparent' }));
      mouth.appendChild(node('circle', {
        cx: sx(p.x), cy: sy(p.y) + 1.5, r: 13, fill: '#000000', 'fill-opacity': 0.55,
      }));
      mouth.appendChild(node('circle', {
        class: 'lip', cx: sx(p.x), cy: sy(p.y), r: 12.5,
        fill: '#070a09', stroke: '#b08d57', 'stroke-width': 2.6,
      }));
      mouth.appendChild(node('circle', {
        cx: sx(p.x), cy: sy(p.y) - 2, r: 8.5, fill: '#000000', 'fill-opacity': 0.8,
      }));

      const tag = node('text', {
        class: 'lbl',
        x: sx(p.x),
        y: sy(p.y) - 1,
        // Counter-rotated about its own pocket, so a turned table still reads A-P
        // the right way up. About the pocket and not the origin: rotating about
        // 0,0 would fling every letter off the cloth.
        ...(portrait ? { transform: `rotate(-90 ${sx(p.x)} ${sy(p.y) - 1})` } : {}),
        'font-size': LABEL_SIZE,
        fill: '#bd9a63',
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        'pointer-events': 'none',
      });
      tag.textContent = LETTERS[i] ?? '?';
      mouth.appendChild(tag);

      g.appendChild(mouth);
      mouths.push(mouth);
      mouth.addEventListener('click', () => guess(i));
      mouth.addEventListener('keydown', (ev) => {
        const k = (ev as KeyboardEvent).key;
        if (k === 'Enter' || k === ' ') {
          ev.preventDefault();
          guess(i);
        }
      });
    });
  }

  /** Where it came in, and which way it is pointed — chalked on the cloth. */
  function drawEntry() {
    const g = layers.entry!;
    clear(g);
    g.removeAttribute('opacity');
    const ex = sx(ENTRY.x);
    const ey = sy(ENTRY.y);
    const onSide = ENTRY.x === 0 || ENTRY.x === W;
    g.appendChild(node('rect', {
      x: onSide ? (ENTRY.x === 0 ? ex - RAIL + 3 : ex) : ex - 3,
      y: onSide ? ey - 3 : (ENTRY.y === 0 ? ey : ey - RAIL + 3),
      width: onSide ? RAIL - 3 : 6,
      height: onSide ? 6 : RAIL - 3,
      rx: 3, fill: '#b08d57',
    }));
    const aim = CELL * 1.45;
    const axp = ex + DIR.x * aim;
    const ayp = ey - DIR.y * aim;
    // The arrow is its own group so paint() can fade it once the ball has gone
    // and there is a real path where the prediction was.
    const arrow = node('g', { class: 'shotcall-aim' });
    arrow.appendChild(node('line', {
      x1: ex + DIR.x * 11, y1: ey - DIR.y * 11, x2: axp, y2: ayp,
      stroke: '#eaf4f9', 'stroke-width': 2, 'stroke-opacity': 0.45,
      'stroke-linecap': 'round', 'stroke-dasharray': '6 5',
    }));
    arrow.appendChild(node('path', {
      d: 'M0 0 L-9 -3.6 L-9 3.6 Z', fill: '#eaf4f9', 'fill-opacity': 0.55,
      transform: `translate(${axp} ${ayp}) rotate(${(Math.atan2(-DIR.y, DIR.x) * 180) / Math.PI})`,
    }));
    g.appendChild(arrow);
    aimEl = arrow;
  }

  /** The aim arrow, so paint() can hide it without redrawing the entry. */
  let aimEl: SVGElement | null = null;

  function build() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    mouths.length = 0;
    portrait = PORTRAIT_MQ.matches;

    // The canvas turns with the table; the contents do not know it happened.
    // translate-then-rotate, in that order, because rotate(90) alone would swing
    // the whole board off the left edge of its own viewBox.
    svg.setAttribute(
      'viewBox',
      portrait ? `0 0 ${TH + PAD * 2} ${TW + PAD * 2}` : `0 0 ${TW + PAD * 2} ${TH + PAD * 2}`,
    );
    stage = node('g', portrait ? { transform: `translate(${TH + PAD * 2} 0) rotate(90)` } : {}) as SVGGraphicsElement;
    svg.appendChild(stage);

    defs();
    furniture();

    // z-order, bottom to top. The shutter sits above the slot and the block so it
    // can slide over both; the chalk and the pockets sit above it, because a
    // mechanical panel moving under the cloth should not cover the game.
    for (const name of ['slot', 'block', 'shutter'] as const) {
      layers[name] = node('g', {
        ...(name === 'shutter' ? { 'pointer-events': 'none' } : {}),
        // the moving furniture never leaves the cloth; see defs()
        ...(name === 'block' ? {} : { 'clip-path': 'url(#shotcall-cloth)' }),
      });
      stage.appendChild(layers[name]!);
    }

    // the chalk line: everything seen so far sits back, the last leg stays bright
    layers.past = node('path', {
      d: '', fill: 'none', stroke: '#cfe0ea', 'stroke-width': 2.3,
      'stroke-opacity': 0.26, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    });
    stage.appendChild(layers.past);
    layers.hot = node('path', {
      d: '', fill: 'none', stroke: '#eaf4f9', 'stroke-width': 2.9,
      'stroke-opacity': 0.92, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    });
    stage.appendChild(layers.hot);
    layers.marks = node('g');
    stage.appendChild(layers.marks);
    // The player's line sits under the pockets, so a pocket keeps its tap target.
    layers.mine = node('path', {
      d: '', fill: 'none', stroke: '#e8b44a', 'stroke-width': 3.2,
      'stroke-opacity': 0.85, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    });
    stage.appendChild(layers.mine);

    // fx is the pocket's ring when the ball drops; its own layer because ball
    // and puff are both cleared wholesale by the things that paint them.
    for (const name of ['pockets', 'chalkOut', 'entry', 'puff', 'ball', 'fx'] as const) {
      layers[name] = node('g', name === 'puff' || name === 'fx' ? { 'pointer-events': 'none' } : {});
      stage.appendChild(layers[name]!);
    }

    drawBlock();
    drawPockets();
    drawEntry();
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

  /** `k` is the ball's size, 1 on the cloth and shrinking as it drops into a
   *  pocket. The ball layer sits above the pockets, so a ball drawn smaller over
   *  the hole reads as going down it. */
  function paintBall(x: number, y: number, sunk: boolean, k = 1) {
    clear(layers.ball!);
    if (sunk) return; // it is in the pocket, out of sight
    layers.ball!.appendChild(node('ellipse', {
      cx: x + 1.5 * k, cy: y + 5 * k, rx: 8 * k, ry: 3.6 * k, fill: '#000000', 'fill-opacity': 0.45 * k,
    }));
    layers.ball!.appendChild(node('circle', { cx: x, cy: y, r: 8 * k, fill: '#dce9f0' }));
    layers.ball!.appendChild(node('circle', {
      cx: x - 2.6 * k, cy: y - 2.9 * k, r: 2.7 * k, fill: '#ffffff', 'fill-opacity': 0.8,
    }));
  }

  /** One ring out from the pocket the ball dropped into. CSS does the motion, so
   *  reduced motion zeroes it with everything else. */
  function ringPocket(i: number) {
    const p = POCKETS[i];
    const g = layers.fx;
    if (!p || !g) return;
    clear(g);
    const ring = node('circle', {
      class: 'shotcall-ring', cx: sx(p.x), cy: sy(p.y), r: 12.5,
      fill: 'none', stroke: '#e8c27a', 'stroke-width': 2.2,
    });
    ring.addEventListener('animationend', () => ring.remove(), { once: true });
    g.appendChild(ring);
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
    // The prediction goes as soon as the ball starts to make it real.
    if (aimEl) aimEl.style.opacity = upto > 0 || mid ? '0' : '1';
  }

  /* ---- the re-rack -------------------------------------------------
     The daily board is one board a day. Past that, the table builds its own:
     board.mjs's randomBoard, on this same table, held to the same filters the
     dealt year was held to — so a practice board is a real board and not a
     softer one.

     The transition is the point. A mechanical table clears itself: the pockets
     shut, the block drops through the cloth, a panel slides over the hole it
     left, another panel opens somewhere else, the block comes back up through
     it, and the new pockets are fired out from the middle and bounce off the
     rails until they settle into the rim.

     That last part is the game's own mathematics used as an animation. To send a
     pocket from the centre to an exact spot on the rim with real bounces on the
     way, take the straight line to a MIRRORED image of the target and fold the
     result back into the table — which is the unfolding trick that makes a
     45-degree billiard path solvable in closed form, and the same idea as the
     diamond system a player uses on a real table. Simulated bounces would land
     wherever they landed; folded ones arrive exactly where the pocket belongs. */

  /** Triangle wave: an unbounded mirrored coordinate, folded back into [0, L]. */
  const fold = (u: number, L: number) => {
    const period = 2 * L;
    const r = ((u % period) + period) % period;
    return r <= L ? r : period - r;
  };
  /** The image of t after m mirrorings of a length-L interval. */
  const mirrorImage = (t: number, m: number, L: number) =>
    m * L + (m % 2 === 0 ? t : L - t);

  const easeOut = (r: number) => 1 - Math.pow(1 - r, 2.6);
  const easeInOut = (r: number) => (r < 0.5 ? 2 * r * r : 1 - Math.pow(-2 * r + 2, 2) / 2);
  /** 0 before `a`, 1 after `b`, eased between. */
  const span = (ms: number, a: number, b: number) =>
    Math.max(0, Math.min(1, (ms - a) / (b - a)));

  const RERACK = { pockets: 260, sink: 540, seal: 880, open: 1160, rise: 1480, fly: 2320 };

  let reracking = false;

  /** A dark recess in the cloth, the size of a block footprint. */
  function slotRect(box: { x: number; y: number; w: number; h: number }) {
    const g = node('g', {});
    g.appendChild(node('rect', {
      x: box.x, y: box.y, width: box.w, height: box.h, rx: 3, fill: '#0a1512',
    }));
    g.appendChild(node('rect', {
      x: box.x, y: box.y, width: box.w, height: 5, fill: '#000000', 'fill-opacity': 0.55,
    }));
    return g;
  }

  /** A cloth panel with a visible leading edge, so you can see it move. */
  function shutterPanel(box: { x: number; y: number; w: number; h: number }) {
    const g = node('g', {});
    g.appendChild(node('rect', {
      x: box.x - 1, y: box.y - 1, width: box.w + 2, height: box.h + 2,
      fill: 'url(#shotcall-lit)',
    }));
    g.appendChild(node('rect', {
      x: box.x + box.w - 1.6, y: box.y - 1, width: 1.6, height: box.h + 2,
      fill: '#14312a',
    }));
    g.appendChild(node('rect', {
      x: box.x + box.w, y: box.y - 1, width: 4, height: box.h + 2,
      fill: '#000000', 'fill-opacity': 0.28,
    }));
    return g;
  }

  function rerack(next: Rack | null, done: () => void) {
    if (!next) {
      done();
      return;
    }
    const oldBox = blockBox(BLOCK);
    const nextBlock = next.B;
    const newBox = blockBox(nextBlock);
    const nextPockets = next.pockets.map((q) => ({ x: q.x, y: q.y }));

    // where each new pocket comes from, and how many rails it clips on the way
    const centre = { x: TW / 2, y: TH / 2 };
    const flights = nextPockets.map(() => ({
      mx: Math.floor(Math.random() * 3),
      my: Math.floor(Math.random() * 3),
      delay: Math.random() * 240,
    }));
    for (const f of flights) if (f.mx + f.my === 0) (Math.random() < 0.5 ? (f.mx = 1) : (f.my = 1));

    reracking = true;
    layers.pockets!.setAttribute('pointer-events', 'none');

    const oldSlot = slotRect(oldBox);
    layers.slot!.appendChild(oldSlot);
    oldSlot.setAttribute('opacity', '0');

    const seal = shutterPanel(oldBox);
    layers.shutter!.appendChild(seal);
    seal.setAttribute('opacity', '0');

    let newSlot: SVGElement | null = null;
    let reveal: SVGElement | null = null;
    let sealing = true;
    let swapped = false;
    let flying = false;

    let t0: number | null = null;
    const frame = (t: number) => {
      if (t0 === null) t0 = t;
      const ms = t - t0;

      // 1. the pockets shut, and everything drawn on the cloth goes with them
      const p1 = span(ms, 0, RERACK.pockets);
      if (p1 < 1 || !swapped) {
        mouths.forEach((m, i) => {
          const local = Math.max(0, Math.min(1, (ms - i * 9) / RERACK.pockets));
          const k = 1 - easeInOut(local);
          const p = POCKETS[i];
          if (!p) return;
          m.setAttribute(
            'transform',
            `translate(${sx(p.x)} ${sy(p.y)}) scale(${Math.max(0.001, k)}) translate(${-sx(p.x)} ${-sy(p.y)})`,
          );
          m.setAttribute('opacity', String(k));
        });
        for (const name of ['past', 'hot', 'marks', 'mine', 'chalkOut', 'ball', 'entry'] as const)
          layers[name]!.setAttribute('opacity', String(1 - p1));
      }

      // 2. the block drops through the cloth
      const p2 = span(ms, RERACK.pockets - 40, RERACK.sink);
      if (p2 > 0 && !swapped) {
        oldSlot.setAttribute('opacity', '1');
        const e = easeInOut(p2);
        layers.block!.setAttribute(
          'transform',
          `translate(0 ${e * 13}) translate(${oldBox.x + oldBox.w / 2} ${oldBox.y + oldBox.h / 2}) ` +
            `scale(${1 - e * 0.14}) translate(${-(oldBox.x + oldBox.w / 2)} ${-(oldBox.y + oldBox.h / 2)})`,
        );
        layers.block!.setAttribute('opacity', String(1 - e));
      }

      // 3. a panel slides over the hole it left
      const p3 = span(ms, RERACK.sink - 20, RERACK.seal);
      if (p3 > 0 && sealing) {
        seal.setAttribute('opacity', '1');
        const travel = (1 - easeInOut(p3)) * (oldBox.w + 22);
        seal.setAttribute('transform', `translate(${-travel} 0)`);
        if (p3 === 1) {
          // arrived: the cloth underneath is already correct, so the
          // panel has nothing left to hide and its edge would only sit there
          sealing = false;
          seal.remove();
          oldSlot.remove();
        }
      }

      // 4. another section opens up, somewhere else
      const p4 = span(ms, RERACK.seal - 30, RERACK.open);
      if (p4 > 0 && !newSlot) {
        newSlot = slotRect(newBox);
        layers.slot!.appendChild(newSlot);
        reveal = shutterPanel(newBox);
        layers.shutter!.appendChild(reveal);
      }
      if (reveal) {
        const travel = easeInOut(p4) * (newBox.w + 22);
        reveal.setAttribute('transform', `translate(${travel} 0)`);
        if (p4 === 1) {
          reveal.remove();
          reveal = null;
        }
      }

      // 5. the block comes back up through it
      const p5 = span(ms, RERACK.open - 20, RERACK.rise);
      if (p5 > 0 && !swapped) {
        swapped = true;
        BLOCK = nextBlock;
        drawBlock();
      }
      if (swapped && p5 < 1) {
        const e = easeOut(p5);
        const over = Math.sin(p5 * Math.PI) * 2.5; // a little overshoot on the way up
        layers.block!.setAttribute('transform', `translate(0 ${(1 - e) * 15 - over})`);
        layers.block!.setAttribute('opacity', String(Math.min(1, p5 * 2.2)));
      } else if (swapped) {
        layers.block!.removeAttribute('transform');
        layers.block!.setAttribute('opacity', '1');
        if (newSlot) {
          newSlot.remove();
          newSlot = null;
        }
      }

      // 6. the new pockets are fired out of the middle and bounce into the rim
      const p6 = span(ms, RERACK.rise - 40, RERACK.fly);
      if (p6 > 0 && !flying) {
        flying = true;
        POCKETS = nextPockets;
        ENTRY = next.entry;
        DIR = next.dir;
        deriveBoard();

        /* The last board's drawing has to go here, at the swap — not at the end.
           Those layers were faded to nothing in phase 1 but still HELD the old
           path, the old bounce marks and the old crossed-out pockets, so simply
           restoring their opacity at the end painted the previous puzzle onto the
           new table. Clearing opacity is not clearing content. */
        guesses = [];
        revealed = 0;
        over = false;
        drawn = [];
        stroke = [];
        clear(layers.chalkOut!);
        drawPockets();
        drawEntry();
        paint(0);
        paintMine();
        layers.pockets!.setAttribute('pointer-events', 'none');
      }
      if (flying) {
        const base = RERACK.rise - 40;
        const flightMs = RERACK.fly - base;
        mouths.forEach((m, i) => {
          const f = flights[i]!;
          const p = POCKETS[i];
          if (!p || !f) return;
          const r = Math.max(0, Math.min(1, (ms - base - f.delay) / (flightMs - 240)));
          const e = easeOut(r);
          const tx = sx(p.x) - PAD;
          const ty = sy(p.y) - PAD;
          const target = {
            x: mirrorImage(tx, f.mx, TW),
            y: mirrorImage(ty, f.my, TH),
          };
          const ux = centre.x + (target.x - centre.x) * e;
          const uy = centre.y + (target.y - centre.y) * e;
          const cx = PAD + fold(ux, TW);
          const cy = PAD + fold(uy, TH);
          const k = 0.35 + 0.65 * Math.min(1, r * 1.6);
          m.setAttribute(
            'transform',
            `translate(${cx - sx(p.x)} ${cy - sy(p.y)}) translate(${sx(p.x)} ${sy(p.y)}) ` +
              `scale(${k}) translate(${-sx(p.x)} ${-sy(p.y)})`,
          );
          m.setAttribute('opacity', String(Math.min(1, 0.2 + r * 2)));
        });
        const late = span(ms, RERACK.fly - 300, RERACK.fly);
        layers.entry!.setAttribute('opacity', String(late));
        layers.ball!.setAttribute('opacity', String(late));
      }

      if (ms < RERACK.fly) {
        raf = requestAnimationFrame(frame);
        return;
      }

      // settle
      raf = 0;
      clear(layers.slot!);
      clear(layers.shutter!);
      mouths.forEach((m) => {
        m.removeAttribute('transform');
        m.removeAttribute('opacity');
      });
      for (const name of ['past', 'hot', 'marks', 'mine', 'chalkOut', 'ball', 'entry'] as const)
        layers[name]!.removeAttribute('opacity');
      layers.pockets!.removeAttribute('pointer-events');
      drawEntry();
      reracking = false;
      done();
    };

    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  }

  /* ---- the player's own chalk line ---------------------------------
     Freehand: the points are where the pointer actually went, with no snapping
     to the lattice and no smoothing, because a hand-drawn guess next to an exact
     path is the whole point of the comparison. Only consecutive points further
     than DEDUP apart are kept, which trims the data without changing the shape. */

  const DEDUP = 3;               // user units between kept points
  const MIN_STROKE = 2 * CELL;   // 2 dots of travel, below which it was a tap

  const subpath = (pts: Pt[]) =>
    pts.length < 2 ? '' : `M${pts[0]!.x} ${pts[0]!.y}` + pts.slice(1).map((q) => `L${q.x} ${q.y}`).join('');

  /** Every kept stroke as its own subpath of the one chalk path, with the stroke
   *  currently under the pointer on the end so it draws as the hand moves. */
  function paintMine() {
    const g = layers.mine;
    if (!g) return;
    const live = drawing && stroke.length > 1 ? [stroke] : [];
    g.setAttribute('d', [...drawn, ...live].map(subpath).join(''));
  }

  /** Client coordinates into the SVG's own units, so the line survives any
   *  viewport width and the score is measured in dots rather than pixels. */
  function toUser(ev: PointerEvent): Pt | null {
    // The STAGE's matrix, not the svg's: in portrait the stage carries the
    // rotation, so this is what returns a point in the units the line is stored
    // and scored in. Reading the svg's matrix here would save a rotated line.
    const m = stage.getScreenCTM();
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
    if (!chalkOn || over || rolling || reracking || ev.button > 0) return;
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
      drawn.push(stroke);
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
    wipeBtn.hidden = over || !hasChalk();
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

  function eraseLine(erased: Pt[][], done?: () => void) {
    const g = layers.puff;
    if (!g) {
      done?.();
      return;
    }
    clear(g);

    const chunks: Chunk[] = [];
    const PER = 2; // segments per piece
    for (const st of erased) {
      for (let i = 0; i < st.length - 1; i += PER) {
        const seg = st.slice(i, Math.min(st.length, i + PER + 1));
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
    }
    if (!chunks.length) {
      done?.();
      return;
    }

    // It sits on the middle of the LONGEST stroke. The middle of the whole
    // collection would be a point between two strokes as often as not, and an
    // eraser scrubbing at bare cloth while chalk lifts elsewhere reads as a bug.
    const longest = erased.reduce((a, b) => (strokeLength(b) > strokeLength(a) ? b : a));
    const anchor = longest[Math.floor(longest.length / 2)]!;

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
        done?.();
      }
    };

    if (puffRaf) cancelAnimationFrame(puffRaf);
    puffRaf = requestAnimationFrame(frame);
  }

  const tierOf = (score: number) => TIER_CUTS.filter((c) => score >= c).length;

  /** The card goes blank the moment a re-rack starts, with the pockets. Left as
   *  it was, four crosses and a share slip sat under a table being wiped for
   *  two seconds, then jumped away when the new board landed. The record is not
   *  touched: the day's guesses are already saved, and a practice board has none. */
  function clearCard() {
    guesses = [];
    revealed = 0;
    renderTallies();
    scoreEl.hidden = true;
    slipBox.hidden = true;
  }

  /** Everything that must be true before a fresh board is playable. */
  function resetForNewBoard(tier: number) {
    guesses = [];
    revealed = 0;
    over = false;
    drawn = [];
    stroke = [];
    scoreEl.hidden = true;
    slipBox.hidden = true;
    rackBtn.hidden = true;
    rackBtn.disabled = false;
    chalkBtn.disabled = false;
    // The day's board is off the table. Offer the way back to it for as long as
    // that is true — including mid-practice-round, because someone who racked by
    // accident should not have to finish the accident first.
    todayBtn.hidden = !practice;
    todayBtn.disabled = false;
    setChalk(chalkOn);
    stampEl.textContent = `Tier ${tier + 1}/${TIERS}`;
    cardHeadEl.textContent = 'Practice';
    renderTallies();
    syncWipe();
    paintMine();
    say('Pick a pocket, or chalk the line you expect.');
  }

  rackBtn.addEventListener('click', () => {
    if (reracking) return;
    /* Same table, a board it has not just shown. randomBoard rejects about 96%
       of what it tries, so asking it to also avoid one canon string costs
       nothing measurable. */
    const here = `${BLOCK.bx},${BLOCK.by},${BLOCK.bx2},${BLOCK.by2}|${ENTRY.x},${ENTRY.y}|${DIR.x},${DIR.y}`;
    const next = randomBoard(W, H, Math.random, (b) => {
      if (seen.has(b.canon)) return false;
      // the day's own board has no canon here — boards.json does not ship one —
      // so the board on the table right now is rejected by its coordinates
      return `${b.B.bx},${b.B.by},${b.B.bx2},${b.B.by2}|${b.entry.x},${b.entry.y}|${b.dir.x},${b.dir.y}` !== here;
    });
    if (!next) {
      say('This table has nothing new to rack. Try again tomorrow.', 'miss');
      return;
    }
    seen.add(next.canon);
    practice = true;
    rackBtn.disabled = true;
    chalkBtn.disabled = true;
    window.clearInterval(nextTimer);
    nextTimer = 0;
    nextEl.hidden = true;
    clearCard();
    say('Re-racking&hellip;');

    if (reducedMotion()) {
      BLOCK = next.B;
      ENTRY = next.entry;
      DIR = next.dir;
      POCKETS = next.pockets.map((q) => ({ x: q.x, y: q.y }));
      deriveBoard();
      build();
      resetForNewBoard(tierOf(difficulty(next)));
      return;
    }
    rerack(next, () => resetForNewBoard(tierOf(difficulty(next))));
  });

  wipeBtn.addEventListener('click', () => {
    const erased = drawn;
    drawn = [];
    stroke = [];
    save();
    paintMine();
    if (reducedMotion() || !erased.length) {
      syncWipe();
      return;
    }
    // The button stays put, greyed, until the eraser has finished. Hiding it at
    // once reflowed the row while the line was still being rubbed out.
    wipeBtn.disabled = true;
    eraseLine(erased, () => {
      wipeBtn.disabled = false;
      syncWipe();
    });
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
    // Every stroke counts, as one drawing. Two strokes that together trace the
    // route should score like the route, and a second stray mark should cost.
    const mineP = drawn.flat();
    if (mineP.length < 2) return null;

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
    for (const q of mineP) mine += nearest(q, samples);
    let theirs = 0;
    for (const q of samples) theirs += nearest(q, mineP);

    return (mine / mineP.length + theirs / samples.length) / 2 / CELL;
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

    /* One speed, every shot. The duration used to be a budget per leg, so a
       short single leg crawled and the three-leg finish sprinted past it at
       three times the pace; it is now distance over a fixed speed, clamped so a
       one-dot leg is not a blink and a long finish is not a wait. The ball also
       eases in over its first RAMP ms rather than leaving at full speed, and
       stops dead at the cushion, which is right: the next miss picks it up. */
    const SPEED = 0.6; // user units per ms
    const RAMP = 90;
    const DUR = Math.max(320, Math.min(2200, total / SPEED));
    // velocity climbs linearly over RAMP then holds; V is what makes the
    // distance come out to `total` at DUR
    const V = total / (DUR - RAMP / 2);
    const dist = (ms: number) => (ms < RAMP ? (V * ms * ms) / (2 * RAMP) : (V * RAMP) / 2 + V * (ms - RAMP));
    const sinks = to === LAST;
    const SINK = 170;
    let rang = false;

    rolling = true;
    let t0: number | null = null;
    raf = requestAnimationFrame(function frame(t) {
      if (t0 === null) t0 = t;
      const ms = t - t0;
      if (ms < DUR) {
        const travelled = Math.min(total, dist(ms));
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
        raf = requestAnimationFrame(frame);
        return;
      }
      // Into the pocket: the ball shrinks over the hole instead of vanishing
      // between two frames, and the rim rings once as it goes.
      if (sinks && ms < DUR + SINK) {
        const s = (ms - DUR) / SINK;
        if (!rang) {
          rang = true;
          ringPocket(ANSWER);
        }
        const end = P[to]!;
        paint(to - 1, end.x, end.y); // the path complete, the ball still drawn
        paintBall(end.x, end.y, false, 1 - easeOut(s) * 0.75);
        raf = requestAnimationFrame(frame);
        return;
      }
      raf = 0;
      rolling = false;
      revealed = to;
      paint(to);
      done?.();
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
  /** `drawn` animates the two strokes on; off when a saved day is replayed or the
   *  board is rebuilt for a turned phone, where a flourish would be a lie. */
  function chalkOut(i: number, drawn = true) {
    const p = POCKETS[i]!;
    const cx = sx(p.x);
    const cy = sy(p.y);
    const r = 15;
    const j = [1.6, -1.2, 1.1, -1.7]; // slight wobble, so it looks drawn and not printed
    layers.chalkOut!.appendChild(node('path', {
      d: `M${cx - r + j[0]!} ${cy - r + j[1]!}L${cx + r + j[2]!} ${cy + r + j[3]!}`,
      stroke: '#eaf4f9', 'stroke-width': 3, 'stroke-opacity': 0.88, 'stroke-linecap': 'round',
      ...(drawn ? { class: 'shotcall-x' } : {}),
    }));
    layers.chalkOut!.appendChild(node('path', {
      d: `M${cx + r + j[1]!} ${cy - r + j[2]!}L${cx - r + j[3]!} ${cy + r + j[0]!}`,
      stroke: '#eaf4f9', 'stroke-width': 3, 'stroke-opacity': 0.88, 'stroke-linecap': 'round',
      ...(drawn ? { class: 'shotcall-x second' } : {}),
    }));
  }

  /** Light a pocket's brass so the eye lands on it. */
  function litRim(i: number) {
    const lip = mouths[i]?.querySelector('circle.lip');
    lip?.setAttribute('stroke', '#e8c27a');
    lip?.setAttribute('stroke-width', '4.2');
    mouths[i]?.querySelector('text.lbl')?.setAttribute('fill', '#f0d79a');
  }

  function mark(i: number, hit: boolean, drawn = true) {
    const g = mouths[i];
    if (!g) return;
    g.classList.add('spent');
    g.setAttribute('aria-disabled', 'true');
    if (hit) litRim(i);
    else chalkOut(i, drawn);
  }

  function guess(i: number) {
    // The click that ends a stroke lands on whatever was under the pointer, which
    // is often a pocket. Drawing a line is not guessing.
    if (swallowClick) {
      swallowClick = false;
      return;
    }
    if (over || rolling || reracking || guesses.includes(i)) return;
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
    rackBtn.hidden = false;

    /* The share slip and the countdown belong to the day's board. A practice
       round has nothing to post and no next-board-o'clock, so it gets neither —
       what it gets is the button to go again. */
    if (practice) {
      slipBox.hidden = true;
      nextEl.hidden = true;
      return;
    }
    slipText.textContent = slip();
    // Shown without the scheme, the way a browser's address bar does it: the
    // full URL is 12px too wide for the slip on a desktop and needs two lines on
    // a phone, and https:// is the half nobody reads. The href and the copied
    // text both keep it, so the link still works and still linkifies when pasted.
    //
    // The <wbr> is the break the host would otherwise not get: 46 characters of
    // monospace do not fit a phone, and without an offered break point the line
    // splits in the middle of the domain. With it the domain stays whole and the
    // path drops to the next line. Appended as nodes rather than innerHTML.
    // appendChild, not append: wrangler's generated worker types put an
    // HTMLRewriter `Element.append(content, options?)` in scope, and it wins the
    // overload here, so the three-node form fails to typecheck.
    slipUrl.textContent = location.host;
    slipUrl.appendChild(document.createElement('wbr'));
    slipUrl.appendChild(document.createTextNode(PLAY_PATH));
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
   *  would hand the next person a real clue.
   */
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

  /** What Copy actually puts on the clipboard: the score, and then where to play.
   *
   *  A score with nowhere to go is a dead end — whoever it is pasted to is told
   *  someone got it in three and given no way to try. The link always points at
   *  /play/shotcall, the bare game page, even when this demo is running inside the
   *  write-up: the person being sent a score wants the table, not two thousand
   *  words about how the boards are generated. Built off `location.origin`, so a
   *  slip copied in dev points at dev and one copied in production at production.
   *
   *  It is rendered UNDER the slip rather than as a fourth line inside it because
   *  the production URL is wider than the slip at any width the slip can have on a
   *  phone, so inside the block it wraps mid-domain — in the one part of this
   *  game people screenshot. */
  const PLAY_PATH = '/play/shotcall';
  const shareText = () => `${slip()}\n${location.origin}${PLAY_PATH}`;

  /* ---- the day's board, and the way back to it ---------------------- */

  /** Put the day's saved guesses and chalk line onto the board now on the table.
   *
   *  Assumes the day's board is already there. Called at first paint, and again
   *  by "Today's board" once a practice rack has been sent away. */
  function replaySaved(rec: { guesses: number[]; line: Pt[][] }) {
    if (rec.guesses.length) {
      for (const i of rec.guesses) {
        guesses.push(i);
        mark(i, i === ANSWER, false);
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
  }

  /** Undo a practice rack: the day's board back on the table, exactly as it was
   *  left, with its score, its share slip and its countdown.
   *
   *  This has always been one page reload away — the day's record lives in
   *  localStorage, which is what makes a refresh unable to buy a fresh set of
   *  tries. But "reload the page" is not a thing to ask of someone who racked a
   *  practice board and then wanted to show a friend what they actually got, and
   *  on the write-up page a reload also throws the reader back to the top of the
   *  article. So the table racks back instead, by the same mechanism it racked
   *  away: nothing here reaches for the board directly, it hands `rerack` the
   *  day's geometry and restores the record when the animation lands. */
  function restoreDay() {
    practice = false;
    guesses = [];
    revealed = 0;
    over = false;
    stroke = [];
    scoreEl.hidden = true;
    slipBox.hidden = true;
    rackBtn.hidden = true;
    rackBtn.disabled = false;
    todayBtn.hidden = true;
    todayBtn.disabled = false;
    chalkBtn.disabled = false;
    stampEl.textContent = `Tier ${day.t + 1}/${TIERS}`;
    cardHeadEl.textContent = dateLabel;
    setChalk(chalkOn);

    const rec = load();
    drawn = rec.line;
    paintMine();
    syncWipe();
    say('Pick a pocket, or chalk the line you expect.');
    replaySaved(rec);
  }

  todayBtn.addEventListener('click', () => {
    if (reracking || !practice) return;
    todayBtn.disabled = true;
    rackBtn.disabled = true;
    chalkBtn.disabled = true;
    clearCard();
    say('Re-racking&hellip;');

    if (reducedMotion()) {
      BLOCK = DAY.B;
      ENTRY = DAY.entry;
      DIR = DAY.dir;
      POCKETS = DAY.pockets.map((q) => ({ ...q }));
      deriveBoard();
      build();
      restoreDay();
      return;
    }
    rerack(DAY, restoreDay);
  });

  /* ---- controls ---------------------------------------------------- */

  copyBtn.addEventListener('click', () => {
    const text = shareText();
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

  /* Turning the phone crosses the breakpoint, so the board is rebuilt the other
     way up without losing the round in progress. Skipped while anything is
     animating: build() tears down the very nodes a running frame is writing to,
     and the next orientation change will pick it up anyway. */
  const onOrient = () => {
    if (portrait === PORTRAIT_MQ.matches || rolling || reracking) return;
    build();
    for (const i of guesses) mark(i, i === ANSWER, false);
    if (over) litRim(ANSWER); // a lost day still shows where it went
    paintMine();
    paint(revealed);
    syncWipe();
  };
  PORTRAIT_MQ.addEventListener('change', onOrient);

  /* ---- first paint, replaying whatever today already had ----------- */

  sweepOldDays();
  const saved = load();
  drawn = saved.line;
  build();
  setChalk(chalkOn);
  syncWipe();
  replaySaved(saved);

  return () => {
    if (raf) cancelAnimationFrame(raf);
    if (puffRaf) cancelAnimationFrame(puffRaf);
    raf = 0;
    puffRaf = 0;
    rolling = false;
    window.clearTimeout(copyTimer);
    window.clearInterval(nextTimer);
    PORTRAIT_MQ.removeEventListener('change', onOrient);
    el.innerHTML = '';
  };
}
