/**
 * SHOTCALL — what makes a board worth playing, in one place.
 *
 * ./trace.mjs owns where the ball goes. This owns which boards are allowed to
 * exist: the sizes, the filters, the pocket layout and the difficulty score.
 *
 * It is here rather than in the build script because the browser generates
 * boards too. The daily board is dealt at build time out of a full enumeration,
 * but "Rack another" builds one on the spot — and a board made in the browser
 * has to clear exactly the same bar as one dealt from the year, or the practice
 * table is a different, easier game wearing the same clothes. One module, two
 * callers, no second definition of "fair".
 *
 * Plain .mjs for the same reason as trace.mjs: node runs the scripts with no
 * build step, and Vite types this from the JSDoc for the demo.
 *
 * WHY THE SIZES LOOK ARBITRARY
 *   The governing variable is gcd(W, H), not area. A shared factor makes the
 *   ball close its cycle early, so it can only ever touch a fraction of the rim,
 *   which starves both the pocket count and the supply:
 *
 *     gcd 1 -> the ball can reach ~50% of the rim
 *     gcd 2 -> ~41%      gcd 3 -> ~34-38%      gcd 4 -> ~28%      gcd 6 -> ~19%
 *
 *   So every size here is coprime. 12x6 is bigger than 11x9 and useless.
 *
 * @typedef {import('./trace.mjs').Block} Block
 * @typedef {{ x: number, y: number }} Point
 * @typedef {{ W: number, H: number, B: Block, entry: Point, dir: Point,
 *             legs: number[], blockBounces: number, ringDist: number,
 *             pockets: Point[], answerIdx: number, canon: string }} Board
 */

import { contacts, freeContacts } from './trace.mjs';

export const BOUNCES = 3;            // fixed, so every day's score is out of the same 4
export const CONTACTS = BOUNCES + 1; // three bounces then the pocket
export const MIN_LEG = 2;            // a 1-dot leg is over before you can read it
export const MAX_LEG = 7;            // past this, counting dots stops being a puzzle
export const POCKET_COUNT = 14;      // 1-in-14 odds of a lucky first guess
export const MIN_POCKET_GAP = 2;     // rim steps, so two pockets never crowd each other
export const MIN_RING_DIST = 8;      // answer this far around the rim from the entry

export const SIZES = [[10, 7], [11, 7], [11, 8], [11, 9], [10, 9], [12, 7], [13, 9], [13, 10]];
export const BLOCK_SHAPES = [[1, 1], [2, 1], [1, 2], [2, 2], [3, 1], [1, 3]];

export const key = (p) => `${p.x},${p.y}`;
export const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/** Pockets and bounces both live on lattice points; corners are excluded because
 *  they reflect both axes at once and read ambiguously on screen. */
export function rimClockwise(W, H) {
  const out = [];
  for (let x = 0; x <= W; x++) out.push({ x, y: H });
  for (let y = H - 1; y >= 0; y--) out.push({ x: W, y });
  for (let x = W - 1; x >= 0; x--) out.push({ x, y: 0 });
  for (let y = 1; y < H; y++) out.push({ x: 0, y });
  return out.filter((p) => !((p.x === 0 || p.x === W) && (p.y === 0 || p.y === H)));
}

/** The rim, plus the lookup the ring-distance filter needs. Computed once per
 *  size by the enumerator, once per call by the browser. */
export function rimContext(W, H) {
  const rim = rimClockwise(W, H);
  return { rim, idxOf: new Map(rim.map((p, i) => [key(p), i])) };
}

export function blockPositions(W, H, bw, bh) {
  const out = [];
  for (let bx = 1; bx + bw <= W - 1; bx++)
    for (let by = 1; by + bh <= H - 1; by++)
      out.push({ bx, by, bx2: bx + bw, by2: by + bh });
  return out;
}

export function inwardDirs(W, H, p) {
  const out = [];
  for (const dx of [-1, 1]) for (const dy of [-1, 1]) {
    if (p.x === 0 && dx !== 1) continue;
    if (p.x === W && dx !== -1) continue;
    if (p.y === 0 && dy !== 1) continue;
    if (p.y === H && dy !== -1) continue;
    out.push({ x: dx, y: dy });
  }
  return out;
}

/** Fourteen pockets, evenly spread, never closer than MIN_POCKET_GAP, always
 *  including the answer and never the first three rails the ball touches. */
export function placePockets(rim, answerIdx, forbidden) {
  const N = rim.length;
  const taken = new Set([answerIdx]);
  const ok = (i) => {
    if (forbidden.has(key(rim[i])) || taken.has(i)) return false;
    for (const t of taken) {
      const d = Math.abs(t - i);
      if (Math.min(d, N - d) < MIN_POCKET_GAP) return false;
    }
    return true;
  };
  for (let k = 1; k < POCKET_COUNT; k++) {
    const target = (answerIdx + Math.round((k * N) / POCKET_COUNT)) % N;
    let placed = false;
    for (let off = 0; off <= 4 && !placed; off++) {
      for (const s of off ? [off, -off] : [0]) {
        const i = ((target + s) % N + N) % N;
        if (ok(i)) { taken.add(i); placed = true; break; }
      }
    }
    if (!placed) return null;
  }
  return [...taken].sort((a, b) => a - b).map((i) => rim[i]);
}

/**
 * One candidate, judged. Returns the board, or null with a reason recorded.
 *
 * Every rejection here is a rule about playability, not taste:
 *  - a corner bounce reflects both axes at once and cannot be read on screen
 *  - a pocket has to be on the rim
 *  - a ball that crosses its own answer early would have dropped there, so the
 *    stated answer would be a lie
 *  - legs outside [MIN_LEG, MAX_LEG] are either invisible or a counting chore
 *  - a block the ball never touches is furniture that looks like it matters
 *  - an answer too close to the entry is found by instinct, not by counting
 *
 * @param {{ reject?: (why: string) => void }} [tally] optional rejection counter
 * @returns {Board | null}
 */
export function evaluate(W, H, B, entry, dir, ctx, tally) {
  const no = (why) => { tally?.reject?.(why); return null; };
  const { rim, idxOf } = ctx;

  const hits = contacts(W, H, B, entry, dir, CONTACTS);
  if (hits.length < CONTACTS) return no('ran out of table');
  if (hits.some((c) => c.corner)) return no('hit a corner');

  const answer = hits[CONTACTS - 1];
  if (!answer.rim) return no('fourth contact was the block');

  const before = hits.slice(0, CONTACTS - 1).map(key);
  if (before.includes(key(answer)) || key(answer) === key(entry))
    return no('crosses its own answer');

  const legs = [];
  let prev = 0;
  for (const c of hits) { legs.push(c.t - prev); prev = c.t; }
  if (Math.max(...legs) > MAX_LEG || Math.min(...legs) < MIN_LEG) return no('leg length');

  const blockBounces = hits.slice(0, CONTACTS - 1).filter((c) => c.block).length;
  if (blockBounces === 0) return no('never touches the block');

  const ai = idxOf.get(key(answer)), ei = idxOf.get(key(entry));
  const d = Math.abs(ai - ei);
  const ringDist = Math.min(d, rim.length - d);
  if (ringDist < MIN_RING_DIST) return no('answer too near the entry');

  const pockets = placePockets(rim, ai, new Set([...before, key(entry)]));
  if (!pockets) return no('could not place pockets');

  return {
    W, H, B, entry, dir, legs, blockBounces, ringDist, pockets,
    answerIdx: pockets.findIndex((p) => key(p) === key(answer)),
    // identity under the rectangle's four mirrors: a board and its reflection
    // are the same puzzle, so they must not both ship
    canon: [[0, 0], [1, 0], [0, 1], [1, 1]]
      .map(([fx, fy]) => {
        const px = fx ? W - entry.x : entry.x, py = fy ? H - entry.y : entry.y;
        const bx = fx ? W - B.bx2 : B.bx, by = fy ? H - B.by2 : B.by;
        return `${W}x${H}:${px}:${py}:${bx}:${by}`;
      })
      .sort()[0] + '|' + legs.join('-'),
  };
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const norm = (v, lo, hi) => clamp01((v - lo) / (hi - lo));

/**
 * What actually makes a board hard, in the order it costs the player:
 *  - how many dots there are to count in total
 *  - the single worst leg, because one long count is where you slip
 *  - bounces off the block, which you must notice before you can predict
 *  - how uneven the legs are, which makes the route harder to hold in mind
 *  - how crowded the answer is, since a lone pocket is easier to land on
 * Distance from the entry is NOT scored: it is a gate above, not a gradient.
 */
export function difficulty(b) {
  const total = b.legs.reduce((a, c) => a + c, 0);
  const maxLeg = Math.max(...b.legs);
  const spread = maxLeg - Math.min(...b.legs);
  const N = b.pockets.length;
  const crowding = b.pockets.filter((_, i) => {
    if (i === b.answerIdx) return false;
    const d = Math.abs(i - b.answerIdx);
    return Math.min(d, N - d) <= 2;
  }).length;

  return clamp01(
    0.32 * norm(total, 10, 26) +
    0.24 * norm(maxLeg, 3, MAX_LEG) +
    0.20 * norm(b.blockBounces, 0, 2) +
    0.14 * norm(spread, 0, 4) +
    0.10 * norm(crowding, 0, 4)
  );
}

/**
 * A legal board on a given table, found by trying.
 *
 * Rejection sampling rather than enumeration, because the browser does not need
 * the whole space — it needs one board, now. About 3.7% of random candidates
 * survive the filters, so this lands in roughly 27 attempts, and an attempt is a
 * walk of a few dozen steps. The cap exists so a hypothetical size with no legal
 * board returns null instead of spinning.
 *
 * @param {number} W
 * @param {number} H
 * @param {() => number} [rand]
 * @param {(b: Board) => boolean} [accept] extra test, e.g. "not one I just played"
 * @returns {Board | null}
 */
export function randomBoard(W, H, rand = Math.random, accept) {
  const ctx = rimContext(W, H);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  for (let tries = 0; tries < 4000; tries++) {
    const [bw, bh] = pick(BLOCK_SHAPES);
    const spots = blockPositions(W, H, bw, bh);
    if (!spots.length) continue;
    const B = pick(spots);
    const entry = pick(ctx.rim);
    if (entry.x >= B.bx && entry.x <= B.bx2 && entry.y >= B.by && entry.y <= B.by2) continue;
    const dir = pick(inwardDirs(W, H, entry));
    const b = evaluate(W, H, B, entry, dir, ctx);
    if (b && (!accept || accept(b))) return b;
  }
  return null;
}

/* ------------------------------------------------------------------ hard mode
   The daily board is a lattice board: 45 degrees, three bounces, pockets exactly
   on grid points, a finite pool counted and dealt in advance. Hard mode is the
   same table with all three of those let go: any entry angle, two to six bounces
   and no word on how many, and a board made from the date on the player's own
   device, so there is nothing to ship and nothing to run out of.

   The physics is trace.mjs's freeContacts — the same reflection law, off the
   grid. What the grid used to guarantee for free, this has to enforce as MARGINS:

     - the answer lands inside its pocket's mouth, not on the lip
     - every earlier rail contact stays a full dot clear of every other mouth, so
       there is never a "did it or didn't it" on the way there
     - nothing comes within half a dot of a corner of the table or the block,
       because on screen that reads as a corner hit whether or not it is one

   Everything else is the daily game's own bar: legs neither too short to see nor
   too long to hold, the block touched at least once, the answer far enough round
   the rim from the entry that instinct does not find it, fourteen mouths spread
   round the rim and never crowding each other.

   NOT STATED TO THE PLAYER: the bounce count. That is what makes it hard. The
   daily game's "three" is a checksum — a trace that reaches a pocket early is
   caught by it — and every board has a mouth one step from an earlier bounce
   for a slipped trace to stop in. Hidden, the checksum is gone. The count still
   climbs through the week so Monday stays Monday. */

/** Mon easiest through Sat hardest, Sun a step back down — the crossword habit.
 *  Shared with scripts/shotcall-boards.mjs, which deals the lattice year by it. */
export const TIER_BY_WEEKDAY = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 6, 0: 5 };
/** Bounce counts a hard board may have, by tier: a RANGE, never one number, so a
 *  regular cannot learn "Saturday is six" and get the count back. */
export const HARD_BOUNCES_BY_TIER = [[2, 3], [2, 3], [3, 4], [3, 4], [4, 5], [3, 5], [5, 6]];
export const MOUTH = 0.5;            // pocket mouth radius, in dots
export const MOUTH_CLEAR = 1;        // centre of any other mouth to any earlier contact, in dots
export const CORNER_CLEAR = 0.6;     // a contact this close to a corner reads as one
export const HARD_MIN_LEG = 2;       // Euclidean dots; the lattice legs are diagonal steps
export const HARD_MAX_LEG = 9;
export const MIN_ANGLE = 12;         // degrees off the rail: shallower is a crawl along it
export const HARD_ATTEMPT_CAP = 80000; // ~200ms when nothing fits; see freeBoard

/** FNV-1a, 32-bit. The same hash index.ts picks an off-calendar board with. */
export function fnv1a(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, good enough for dealing, and the same sequence in
 *  every browser for the same seed — which is the whole point. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The hard board's seed for a date. Namespaced so the daily's off-calendar
 *  fallback, which hashes the bare date, never shares a stream with it. */
export const hardSeed = (iso) => fnv1a(`${iso}:hard`);

/** How many bounces a date's hard board has, drawn from its weekday's range. */
export function hardBounces(date, rand) {
  const [lo, hi] = HARD_BOUNCES_BY_TIER[TIER_BY_WEEKDAY[date.getDay()]];
  return lo + Math.floor(rand() * (hi - lo + 1));
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * A hard board on a given table, found by trying.
 *
 * Draw a block, an entry anywhere on a rail, an angle; trace `bounces` contacts
 * and a pocket; reject anything that fails the margins above; place the mouths.
 * A two-bounce board lands in ~100 attempts, a six-bounce one in ~5,000 on a big
 * table and ~30,000 on 11x7 — under a tenth of a second — because every extra
 * rail contact has to fall in the gap between mouths. The bounce count is fixed
 * BEFORE the loop, deliberately: drawn per attempt, short paths clear the margins
 * so much more often that the mix collapses to two-bounce boards.
 *
 * The one table that cannot hold a long path is 10x7, whose rim is thirty points
 * for fourteen mouths: five and six bounces never fit and four rarely does. The
 * cap turns that into a null instead of a stall, and hardBoardFor() steps the
 * count down until something fits — three days a year, measured on the dealt
 * calendar.
 *
 * @typedef {{ B: Block, entry: Point, dir: Point, pockets: Point[], bounces: number,
 *             answerIdx: number, legs: number[], angle: number, attempts: number }} HardBoard
 *   `dir` is a unit velocity, not a lattice diagonal.
 * @param {number} W
 * @param {number} H
 * @param {() => number} rand
 * @param {number} bounces  2..6
 * @returns {HardBoard | null}
 */
export function freeBoard(W, H, rand, bounces, cap = HARD_ATTEMPT_CAP) {
  const { rim } = rimContext(W, H);
  const Nr = rim.length;
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const corners = [[0, 0], [W, 0], [0, H], [W, H]];

  for (let attempts = 1; attempts <= cap; attempts++) {
    const [bw, bh] = pick(BLOCK_SHAPES);
    if (W - 1 - bw < 1 || H - 1 - bh < 1) continue;
    const bx = 1 + Math.floor(rand() * (W - 1 - bw));
    const by = 1 + Math.floor(rand() * (H - 1 - bh));
    const B = { bx, by, bx2: bx + bw, by2: by + bh };

    const ang = ((MIN_ANGLE + rand() * (180 - 2 * MIN_ANGLE)) * Math.PI) / 180;
    const side = Math.floor(rand() * 4);
    let entry, dir;
    if (side === 0) { entry = { x: 1 + rand() * (W - 2), y: 0 }; dir = { x: Math.cos(ang), y: Math.sin(ang) }; }
    else if (side === 1) { entry = { x: 1 + rand() * (W - 2), y: H }; dir = { x: Math.cos(ang), y: -Math.sin(ang) }; }
    else if (side === 2) { entry = { x: 0, y: 1 + rand() * (H - 2) }; dir = { x: Math.sin(ang), y: Math.cos(ang) }; }
    else { entry = { x: W, y: 1 + rand() * (H - 2) }; dir = { x: -Math.sin(ang), y: Math.cos(ang) }; }

    const hits = freeContacts(W, H, B, entry, dir, bounces + 1);
    if (hits.length < bounces + 1 || hits.some((c) => c.corner)) continue;
    const answer = hits[bounces];
    if (!answer.rim) continue;
    const blockCorners = [[B.bx, B.by], [B.bx2, B.by], [B.bx, B.by2], [B.bx2, B.by2]];
    if (hits.some((c) => [...corners, ...blockCorners].some(([x, y]) => dist(c, { x, y }) < CORNER_CLEAR))) continue;
    const legs = hits.map((c, i) => c.t - (i ? hits[i - 1].t : 0));
    if (Math.max(...legs) > HARD_MAX_LEG || Math.min(...legs) < HARD_MIN_LEG) continue;
    if (!hits.slice(0, bounces).some((c) => c.block)) continue;

    // the mouth it drops into is the nearest rim point, and it has to be well inside
    let ai = 0;
    for (let i = 1; i < Nr; i++) if (dist(answer, rim[i]) < dist(answer, rim[ai])) ai = i;
    if (dist(answer, rim[ai]) > MOUTH * 0.6) continue;
    const earlyRim = hits.slice(0, bounces).filter((c) => c.rim);
    if (earlyRim.some((c) => dist(c, rim[ai]) < MOUTH_CLEAR)) continue;
    let ei = 0;
    for (let i = 1; i < Nr; i++) if (dist(entry, rim[i]) < dist(entry, rim[ei])) ei = i;
    const dd = Math.abs(ai - ei);
    if (Math.min(dd, Nr - dd) < MIN_RING_DIST) continue;

    // fourteen mouths, spread from the answer as placePockets does, but "clear" now
    // means a full dot from every earlier rail contact and from the entry
    const taken = [ai];
    const clear = (i) =>
      dist(rim[i], entry) >= MOUTH_CLEAR &&
      earlyRim.every((c) => dist(c, rim[i]) >= MOUTH_CLEAR) &&
      taken.every((t) => { const d = Math.abs(t - i); return Math.min(d, Nr - d) >= MIN_POCKET_GAP; });
    let ok = true;
    for (let k = 1; k < POCKET_COUNT && ok; k++) {
      const target = (ai + Math.round((k * Nr) / POCKET_COUNT)) % Nr;
      let placed = false;
      for (let off = 0; off <= 4 && !placed; off++) {
        for (const s of off ? [off, -off] : [0]) {
          const i = (((target + s) % Nr) + Nr) % Nr;
          if (clear(i)) { taken.push(i); placed = true; break; }
        }
      }
      if (!placed) ok = false;
    }
    if (!ok) continue;
    const pockets = taken.slice().sort((a, b) => a - b).map((i) => rim[i]);
    return {
      B, entry, dir, pockets, bounces, legs, attempts,
      answerIdx: pockets.indexOf(rim[ai]),
      angle: (ang * 180) / Math.PI,
    };
  }
  return null;
}

/**
 * The day's hard board on the day's table: the weekday's count, or the nearest
 * count below it that the table can hold. Deterministic in the date, so it is the
 * same board on every device — the seed is re-derived per count rather than
 * continued, so a fallback board does not depend on how many attempts the
 * failed count burned.
 *
 * @param {number} W
 * @param {number} H
 * @param {string} iso   the local date, YYYY-MM-DD
 * @param {Date} date    the same date, for its weekday
 * @returns {{ board: HardBoard, asked: number } | null}
 */
export function hardBoardFor(W, H, iso, date) {
  const asked = hardBounces(date, seeded(hardSeed(iso)));
  for (let n = asked; n >= 2; n--) {
    const board = freeBoard(W, H, seeded(hardSeed(iso) ^ (n * 0x9e3779b9)), n);
    if (board) return { board, asked };
  }
  return null;
}
