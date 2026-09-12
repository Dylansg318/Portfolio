#!/usr/bin/env node
/**
 * SHOTCALL — the daily board generator.
 *
 * Shotcall is a bounce puzzle: a ball enters a table at 45 degrees, reflects off
 * anything solid, and drops into the first pocket it reaches. The player gets
 * four tries and every miss reveals one more bounce.
 *
 * This script enumerates every legal board, grades it for difficulty, and deals
 * one to each date of a year. Output is static JSON, so nothing solves anything
 * at request time — see README, the island demo lane.
 *
 * Run: npm run shotcall:boards            (writes src/demos/shotcall/boards.json)
 *      npm run shotcall:boards -- --stats (also prints the difficulty distribution)
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

// Both of these live beside the demo that ships them, so the boards dealt here
// and the boards the browser builds for "Rack another" cannot diverge — same
// reflection rule, same definition of a fair board. See those files' headers.
import {
  BOUNCES, CONTACTS, POCKET_COUNT, SIZES, BLOCK_SHAPES,
  gcd, rimContext, blockPositions, inwardDirs, evaluate, difficulty,
} from "../src/demos/shotcall/board.mjs";
// for the assertion at the bottom, which re-traces every board that ships
import { contacts } from "../src/demos/shotcall/trace.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../src/demos/shotcall/boards.json");

/* ------------------------------------------------------------ candidates */

/**
 * Every legal board, once per mirror family.
 *
 * The whole space, brute-forced: 8 sizes x 6 block shapes x every interior block
 * position x every rim entry x its inward diagonals. The judging is board.mjs's
 * `evaluate`, which the browser also uses, so this is the enumeration and
 * nothing else.
 */
function candidates() {
  const out = [];
  for (const [W, H] of SIZES) {
    if (gcd(W, H) !== 1) throw new Error(`${W}x${H} is not coprime — see board.mjs`);
    const ctx = rimContext(W, H);

    for (const [bw, bh] of BLOCK_SHAPES)
      for (const B of blockPositions(W, H, bw, bh))
        for (const entry of ctx.rim) {
          if (entry.x >= B.bx && entry.x <= B.bx2 && entry.y >= B.by && entry.y <= B.by2) continue;
          for (const dir of inwardDirs(W, H, entry)) {
            const b = evaluate(W, H, B, entry, dir, ctx);
            if (b) out.push(b);
          }
        }
  }

  // one board per mirror family
  const seen = new Set();
  return out.filter((b) => (seen.has(b.canon) ? false : (seen.add(b.canon), true)));
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

  /* The six scores that separate the seven tiers. They ship, because a board the
     browser builds for "Rack another" is scored by the same function but has no
     idea where it falls in a pool it never saw — and a scorecard that says
     "Tier 5/7" on a dealt board and nothing on a practice one would be a worse
     scorecard than one that can always answer. */
  const cuts = Array.from({ length: TIERS - 1 }, (_, i) =>
    Math.round(scored[(i + 1) * per].score * 1e4) / 1e4);
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
  return { days: out, exhausted, scored, cuts };
}

/* ------------------------------------------------------------------ main */

const wantStats = process.argv.includes("--stats");
const pool = candidates();
if (!pool.length) throw new Error("no boards survived the filters");

const START = "2026-09-11";   // the day it went up; out-of-range dates fall back, see the demo
const DAYS = 365;
const { days, exhausted, scored, cuts } = deal(pool, START, DAYS);

// every shipped board must still trace to the pocket it was built around
let checked = 0;
for (const [date, b] of Object.entries(days)) {
  const B = { bx: b.b[0], by: b.b[1], bx2: b.b[2], by2: b.b[3] };
  const hits = contacts(b.s[0], b.s[1], B, { x: b.e[0], y: b.e[1] }, { x: b.d[0], y: b.d[1] }, CONTACTS);
  if (hits.length < CONTACTS) throw new Error(`${date}: ball never made ${CONTACTS} contacts`);
  const last = hits[CONTACTS - 1];
  const hit = b.p.findIndex(([x, y]) => x === last.x && y === last.y);
  if (hit === -1) throw new Error(`${date}: the ball's fourth contact is not a pocket`);
  for (const c of hits.slice(0, CONTACTS - 1))
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
  pockets: POCKET_COUNT,
  tierCuts: cuts,
  note: "Answers are not stored. The client traces the path to animate it, so it derives the pocket.",
  days
}, null, 0) + "\n");

const bytes = JSON.stringify(days).length;
console.log(`shotcall: ${pool.length} distinct boards -> ${Object.keys(days).length} days from ${START}`);
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
