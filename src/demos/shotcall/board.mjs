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

import { contacts } from './trace.mjs';

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
