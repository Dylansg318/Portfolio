#!/usr/bin/env node
/**
 * CAROM — the daily board generator.
 *
 * Carom is a bounce puzzle: a ball enters a table at 45 degrees, reflects off
 * anything solid, and drops into the first pocket it reaches. The player gets
 * four tries and every miss reveals one more bounce.
 *
 * This script enumerates every legal board, grades it for difficulty, and deals
 * one to each date of a year. Output is static JSON, so nothing solves anything
 * at request time — see README, the island demo lane.
 *
 * Run: npm run carom:boards            (writes src/demos/carom/boards.json)
 *      npm run carom:boards -- --stats (also prints the difficulty distribution)
 *
 * WHY THE SIZES LOOK ARBITRARY
 *   They are not. The governing variable is gcd(W, H), not area. A shared factor
 *   makes the ball close its cycle early, so it can only ever touch a fraction of
 *   the rim — which starves both the pocket count and the board supply:
 *
 *     gcd 1 -> the ball can reach ~50% of the rim
 *     gcd 2 -> ~41%      gcd 3 -> ~34-38%      gcd 4 -> ~28%      gcd 6 -> ~19%
 *
 *   So every size here is coprime. 12x6 is bigger than 11x9 and useless.
 *
 * WHY THERE IS A BLOCK
 *   Fixing three bounces is what makes a score mean the same thing every day, and
 *   it is also what starves the supply. Measured: a bare rectangle yields ~91
 *   genuinely distinct boards once mirror images are collapsed — about three
 *   months. One interior block multiplies that to roughly five years, and adds no
 *   rule for the player, because "it bounces off solid things" is already the
 *   whole game.
 *
 * WHY A BOARD MUST USE ITS BLOCK
 *   A block the ball never touches is worse than no block: it is furniture that
 *   looks like it matters. Boards whose first three bounces are all on rails are
 *   rejected, which is most of them.
 *
 * WHAT IS DELIBERATELY NOT IN THE OUTPUT
 *   The answer. The client has to trace the path anyway to animate it, so shipping
 *   the pocket index would only put tomorrow's answer in the bundle for nothing.
 *   This script asserts the trace instead.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../src/demos/carom/boards.json");

/* ------------------------------------------------------------------ shape */

const BOUNCES = 3;            // fixed, so every day's score is out of the same 4
const CONTACTS = BOUNCES + 1; // three bounces then the pocket
const MIN_LEG = 2;            // a 1-dot leg is over before you can read it
const MAX_LEG = 7;            // past this, counting dots stops being a puzzle
const POCKETS = 14;           // 1-in-14 odds of a lucky first guess
const MIN_POCKET_GAP = 2;     // rim steps, so two pockets never crowd each other
const MIN_RING_DIST = 8;      // answer this far around the rim from the entry

// coprime, and small enough that no leg runs long. See the header.
const SIZES = [[10, 7], [11, 7], [11, 8], [11, 9], [10, 9], [12, 7], [13, 9], [13, 10]];
const BLOCK_SHAPES = [[1, 1], [2, 1], [1, 2], [2, 2], [3, 1], [1, 3]];

/* -------------------------------------------------------------- geometry */

const key = (p) => `${p.x},${p.y}`;
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/** Pockets and bounces both live on lattice points; corners are excluded because
 *  they reflect both axes at once and read ambiguously on screen. */
function rimClockwise(W, H) {
  const out = [];
  for (let x = 0; x <= W; x++) out.push({ x, y: H });
  for (let y = H - 1; y >= 0; y--) out.push({ x: W, y });
  for (let x = W - 1; x >= 0; x--) out.push({ x, y: 0 });
  for (let y = 1; y < H; y++) out.push({ x: 0, y });
  return out.filter((p) => !((p.x === 0 || p.x === W) && (p.y === 0 || p.y === H)));
}

function blockPositions(W, H, bw, bh) {
  const out = [];
  for (let bx = 1; bx + bw <= W - 1; bx++)
    for (let by = 1; by + bh <= H - 1; by++)
      out.push({ bx, by, bx2: bx + bw, by2: by + bh });
  return out;
}

/** Which faces a lattice point sits on. The block's faces reflect exactly like a
 *  rail; its corner reflects both. The ball lands on every whole x and y as it
 *  travels, so it can never slip through a face before touching it. */
function faces(W, H, B, x, y) {
  let v = x === 0 || x === W;
  let h = y === 0 || y === H;
  const rim = v || h;
  if (B) {
    const inX = x >= B.bx && x <= B.bx2, inY = y >= B.by && y <= B.by2;
    const fX = x === B.bx || x === B.bx2, fY = y === B.by || y === B.by2;
    if (fX && fY && inX && inY) { v = true; h = true; }
    else if (fX && inY) v = true;
    else if (fY && inX) h = true;
  }
  return { v, h, rim };
}

/** Walk until the ball has made CONTACTS contacts. Vertices are exactly the
 *  things it hits. Returns null if it cannot (it always can, in practice). */
function walk(W, H, B, entry, dir) {
  const pts = [{ x: entry.x, y: entry.y }];
  let x = entry.x, y = entry.y, dx = dir.x, dy = dir.y;
  for (let step = 0; step < 12 * W * H; step++) {
    x += dx; y += dy;
    if (B && x > B.bx && x < B.bx2 && y > B.by && y < B.by2)
      throw new Error("ball entered the block interior — reflection is wrong");
    const f = faces(W, H, B, x, y);
    if (!f.v && !f.h) continue;
    pts.push({ x, y, rim: f.rim, corner: (f.v && f.h), block: !f.rim, t: step + 1 });
    if (pts.length > CONTACTS) break;
    if (f.v) dx = -dx;
    if (f.h) dy = -dy;
  }
  return pts.length >= CONTACTS + 1 ? pts.slice(0, CONTACTS + 1) : null;
}

function inwardDirs(W, H, p) {
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
function placePockets(rim, answerIdx, forbidden) {
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
  for (let k = 1; k < POCKETS; k++) {
    const target = (answerIdx + Math.round((k * N) / POCKETS)) % N;
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

/* ------------------------------------------------------------ candidates */

function candidates() {
  const out = [];
  for (const [W, H] of SIZES) {
    if (gcd(W, H) !== 1) throw new Error(`${W}x${H} is not coprime — see the header`);
    const rim = rimClockwise(W, H);
    const idxOf = new Map(rim.map((p, i) => [key(p), i]));

    for (const [bw, bh] of BLOCK_SHAPES)
      for (const B of blockPositions(W, H, bw, bh))
        for (const entry of rim) {
          if (entry.x >= B.bx && entry.x <= B.bx2 && entry.y >= B.by && entry.y <= B.by2) continue;
          for (const dir of inwardDirs(W, H, entry)) {
            const pts = walk(W, H, B, entry, dir);
            if (!pts) continue;
            const hits = pts.slice(1);
            if (hits.some((c) => c.corner)) continue;

            const answer = hits[CONTACTS - 1];
            if (!answer.rim) continue;                     // a pocket must be on the rim
            const before = hits.slice(0, CONTACTS - 1).map(key);
            // if the ball crosses its own answer early it would have dropped there,
            // and the board would be a lie
            if (before.includes(key(answer)) || key(answer) === key(entry)) continue;

            const legs = [];
            let prev = 0;
            for (const c of hits) { legs.push(c.t - prev); prev = c.t; }
            if (Math.max(...legs) > MAX_LEG || Math.min(...legs) < MIN_LEG) continue;

            const blockBounces = hits.slice(0, CONTACTS - 1).filter((c) => c.block).length;
            if (blockBounces === 0) continue;              // an untouched block is furniture

            const ai = idxOf.get(key(answer)), ei = idxOf.get(key(entry));
            const d = Math.abs(ai - ei);
            const ringDist = Math.min(d, rim.length - d);
            if (ringDist < MIN_RING_DIST) continue;        // else instinct finds it

            const pockets = placePockets(rim, ai, new Set([...before, key(entry)]));
            if (!pockets) continue;

            out.push({
              W, H, B, entry, dir, legs, blockBounces, ringDist,
              pockets,
              answerIdx: pockets.findIndex((p) => key(p) === key(answer)),
              // identity under the rectangle's four mirrors: a board and its
              // reflection are the same puzzle, so they must not both ship
              canon: [[0, 0], [1, 0], [0, 1], [1, 1]]
                .map(([fx, fy]) => {
                  const px = fx ? W - entry.x : entry.x, py = fy ? H - entry.y : entry.y;
                  const bx = fx ? W - B.bx2 : B.bx, by = fy ? H - B.by2 : B.by;
                  return `${W}x${H}:${px}:${py}:${bx}:${by}`;
                })
                .sort()[0] + "|" + legs.join("-")
            });
          }
        }
  }

  // one board per mirror family
  const seen = new Set();
  return out.filter((b) => (seen.has(b.canon) ? false : (seen.add(b.canon), true)));
}

/* ------------------------------------------------------------ difficulty */

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
function difficulty(b) {
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

/* ------------------------------------------------- dealing a year of days */

// Mon easiest through Sat hardest, Sun a step back down — the crossword habit,
// so a streak feels like it has a shape instead of being flat noise.
const TIER_BY_WEEKDAY = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 6, 0: 5 };
const TIERS = 7;

/** Deterministic shuffle, so the same commit always produces the same year. */
function seededShuffle(arr, seed) {
  let s = seed >>> 0;
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function iso(d) { return d.toISOString().slice(0, 10); }

function deal(pool, startISO, days) {
  const scored = pool.map((b) => ({ ...b, score: difficulty(b) }))
    .sort((a, b) => a.score - b.score);

  // equal-count tiers, so "Saturday" always means the top seventh of what exists
  const per = Math.floor(scored.length / TIERS);
  const tiers = Array.from({ length: TIERS }, (_, t) =>
    seededShuffle(scored.slice(t * per, t === TIERS - 1 ? scored.length : (t + 1) * per), 0x9e3779b9 + t));

  const cursor = new Array(TIERS).fill(0);
  const out = {};
  const start = new Date(startISO + "T00:00:00Z");
  let exhausted = 0;

  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    const want = TIER_BY_WEEKDAY[d.getUTCDay()];
    // fall outward to the nearest tier that still has boards, hardest-first so a
    // Saturday never quietly becomes a Monday
    let tier = -1;
    for (let off = 0; off < TIERS && tier === -1; off++)
      for (const t of off ? [want + off, want - off] : [want])
        if (t >= 0 && t < TIERS && cursor[t] < tiers[t].length) { tier = t; break; }
    if (tier === -1) { exhausted = days - i; break; }
    if (tier !== want) exhausted++;

    const b = tiers[tier][cursor[tier]++];
    out[iso(d)] = {
      s: [b.W, b.H],
      e: [b.entry.x, b.entry.y],
      d: [b.dir.x, b.dir.y],
      b: [b.B.bx, b.B.by, b.B.bx2, b.B.by2],
      p: b.pockets.map((p) => [p.x, p.y]),
      t: tier
    };
  }
  return { days: out, exhausted, scored };
}

/* ------------------------------------------------------------------ main */

const wantStats = process.argv.includes("--stats");
const pool = candidates();
if (!pool.length) throw new Error("no boards survived the filters");

const START = "2026-09-12";
const DAYS = 365;
const { days, exhausted, scored } = deal(pool, START, DAYS);

// every shipped board must still trace to the pocket it was built around
let checked = 0;
for (const [date, b] of Object.entries(days)) {
  const B = { bx: b.b[0], by: b.b[1], bx2: b.b[2], by2: b.b[3] };
  const pts = walk(b.s[0], b.s[1], B, { x: b.e[0], y: b.e[1] }, { x: b.d[0], y: b.d[1] });
  if (!pts) throw new Error(`${date}: ball never made ${CONTACTS} contacts`);
  const last = pts[pts.length - 1];
  const hit = b.p.findIndex(([x, y]) => x === last.x && y === last.y);
  if (hit === -1) throw new Error(`${date}: the ball's fourth contact is not a pocket`);
  for (const c of pts.slice(1, CONTACTS))
    if (b.p.some(([x, y]) => x === c.x && y === c.y))
      throw new Error(`${date}: the ball passes a pocket before its answer`);
  checked++;
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({
  version: 1,
  generated: new Date().toISOString().slice(0, 10),
  bounces: BOUNCES,
  tries: BOUNCES + 1,
  pockets: POCKETS,
  note: "Answers are not stored. The client traces the path to animate it, so it derives the pocket.",
  days
}, null, 0) + "\n");

const bytes = JSON.stringify(days).length;
console.log(`carom: ${pool.length} distinct boards -> ${Object.keys(days).length} days from ${START}`);
console.log(`  verified ${checked}/${Object.keys(days).length} traced to their pocket`);
console.log(`  supply ${(pool.length / 365).toFixed(1)} years   output ${(bytes / 1024).toFixed(0)} KB`);
if (exhausted) console.log(`  NOTE: ${exhausted} day(s) fell back to a neighbouring tier`);

if (wantStats) {
  const per = Math.floor(scored.length / TIERS);
  console.log("\n  tier  days  score range        legs seen");
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sun", "Sat"];
  for (let t = 0; t < TIERS; t++) {
    const slice = scored.slice(t * per, t === TIERS - 1 ? scored.length : (t + 1) * per);
    const used = Object.values(days).filter((d) => d.t === t).length;
    const legs = new Set(slice.map((b) => b.legs.join("-")));
    console.log(`  ${String(t).padStart(4)}  ${String(used).padStart(4)}  ` +
      `${slice[0].score.toFixed(2)}-${slice[slice.length - 1].score.toFixed(2)}  ` +
      `${String(legs.size).padStart(4)} shapes   (${names[t]})`);
  }
}
