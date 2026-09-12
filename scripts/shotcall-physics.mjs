#!/usr/bin/env node
/**
 * SHOTCALL — physics gate.
 *
 * Shotcall's whole promise is that the ball goes where the geometry says. This
 * asserts that over every board shape the generator can produce, as invariants
 * rather than by eye:
 *
 *   1. the ball never leaves the table
 *   2. it never ends up inside the block
 *   3. it never tunnels through a face
 *   4. every step is exactly one diagonal unit
 *   5. direction flips at a surface, and ONLY at a surface
 *   6. it never turns in open space
 *   7. the path is time-reversible
 *
 * (7) is the one that earns its keep: a reflection wrong at any face or corner
 * breaks it, and nothing else will.
 *
 * It verifies THE SHIPPED RULE, not a second copy of it. The reflection law is
 * imported from src/demos/shotcall/trace.mjs — the same module the generator deals
 * boards with and the same one the browser rolls the ball with — so a pass here
 * is a statement about the game and not about this file. The invariants are
 * properties (containment, reversibility), which is why testing the real
 * implementation beats re-deriving it: a second copy could only ever prove the
 * two copies agree.
 *
 * Then it replays every board in src/demos/shotcall/boards.json through that rule
 * and checks each one still reaches its pocket. That is the part that catches
 * drift: boards.json is committed output, so without this a stale or
 * hand-edited file would sail through the gate.
 *
 * Finally it audits the RUNTIME generator — the one the browser calls for "Rack
 * another" — by making boards with it and re-deriving every rule from scratch
 * rather than trusting the function that claimed to enforce them. A practice
 * board that quietly skipped a filter would be an easier game wearing the same
 * clothes, and nothing else would catch it.
 *
 * NOTE ON (7), because it looks like a fudge and is not. Time-reversing a bounce
 * means leaving the contact along the negated INCOMING ray, not the negated
 * outgoing one — those are different rays at every contact point. The first
 * version of this test negated the wrong one and failed 32% of cases.
 *
 * Run: npm run shotcall:verify
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { contacts, step } from "../src/demos/shotcall/trace.mjs";
import {
  CONTACTS, MIN_LEG, MAX_LEG, POCKET_COUNT, MIN_POCKET_GAP, MIN_RING_DIST,
  SIZES, key, rimContext, randomBoard,
} from "../src/demos/shotcall/board.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BOARDS = resolve(HERE, "../src/demos/shotcall/boards.json");

const inside = (B, x, y) => B && x > B.bx && x < B.bx2 && y > B.by && y < B.by2;

function run(W, H, B, start, steps) {
  const path = [{ x: start.x, y: start.y, dx: start.dx, dy: start.dy }];
  let s = { x: start.x, y: start.y, dx: start.dx, dy: start.dy };
  for (let i = 0; i < steps; i++) { s = step(W, H, B, s); path.push(s); }
  return path;
}

const fails = { contained: 0, insideBlock: 0, tunnel: 0, unitStep: 0, reflect: 0, reversible: 0, freeTurn: 0 };
let cases = 0, stepsChecked = 0;

function blocksFor(W, H) {
  const out = [null];
  for (const [bw, bh] of [[1, 1], [2, 1], [1, 2], [2, 2], [3, 1]])
    for (let bx = 1; bx + bw <= W - 1; bx += 2)
      for (let by = 1; by + bh <= H - 1; by += 2)
        out.push({ bx, by, bx2: bx + bw, by2: by + bh });
  return out;
}

for (const [W, H] of [[11, 9], [8, 6], [10, 7], [13, 9], [12, 8], [7, 5]]) {
  for (const B of blocksFor(W, H)) {
    for (let ex = 0; ex <= W; ex++) for (let ey = 0; ey <= H; ey++) {
      const onRim = (ex === 0 || ex === W || ey === 0 || ey === H);
      if (!onRim) continue;
      if (B && ex >= B.bx && ex <= B.bx2 && ey >= B.by && ey <= B.by2) continue;
      for (const dx of [-1, 1]) for (const dy of [-1, 1]) {
        if (ex === 0 && dx !== 1) continue;
        if (ex === W && dx !== -1) continue;
        if (ey === 0 && dy !== 1) continue;
        if (ey === H && dy !== -1) continue;

        const N = 60;
        const fwd = run(W, H, B, { x: ex, y: ey, dx, dy }, N);
        cases++;

        for (let i = 0; i < fwd.length; i++) {
          const p = fwd[i];
          stepsChecked++;

          // 1. never leaves the table
          if (p.x < 0 || p.x > W || p.y < 0 || p.y > H) fails.contained++;

          // 2. never strictly inside the block
          if (inside(B, p.x, p.y)) fails.insideBlock++;

          if (i > 0) {
            const q = fwd[i - 1];
            // 3. every step is exactly one diagonal unit
            if (Math.abs(p.x - q.x) !== 1 || Math.abs(p.y - q.y) !== 1) fails.unitStep++;

            // 4. no tunnelling: the midpoint of the step is never in the block interior
            if (inside(B, (p.x + q.x) / 2, (p.y + q.y) / 2)) fails.tunnel++;

            // 5. the reflection law: the perpendicular component flips at a surface
            //    and ONLY at a surface
            const flippedX = p.dx !== p.inDx, flippedY = p.dy !== p.inDy;
            if (flippedX !== !!p.v || flippedY !== !!p.h) fails.reflect++;
            // 6. direction never changes in open space
            if (!p.contact && (flippedX || flippedY)) fails.freeTurn++;
          }
        }

        // 7. time-reversibility: the reversed position sequence must itself be a legal
        //    trajectory. Leaving the end point means negating the direction the ball
        //    ARRIVED on - not the one it bounced away on, which is a different ray
        //    whenever the last point was a contact.
        const end = fwd[fwd.length - 1];
        const back = run(W, H, B, { x: end.x, y: end.y, dx: -end.inDx, dy: -end.inDy }, N);
        for (let i = 0; i <= N; i++) {
          const a = fwd[N - i], b = back[i];
          if (a.x !== b.x || a.y !== b.y) { fails.reversible++; break; }
        }
      }
    }
  }
}

console.log("shotcall physics gate");
console.log("  boards traced      ", cases.toLocaleString());
console.log("  ball positions     ", stepsChecked.toLocaleString());
console.log("");
const checks = [
  ["stays inside the table", fails.contained],
  ["never inside the block", fails.insideBlock],
  ["never tunnels a face", fails.tunnel],
  ["every step one diagonal unit", fails.unitStep],
  ["reflects only at a surface, and always there", fails.reflect],
  ["never turns in open space", fails.freeTurn],
  ["path is time-reversible", fails.reversible]
];
for (const [name, n] of checks)
  console.log(`  ${n === 0 ? "PASS" : "FAIL"}  ${name}${n ? "  (" + n + " violations)" : ""}`);

const bad = checks.reduce((a, c) => a + c[1], 0);
console.log("\n" + (bad === 0 ? "all invariants hold" : bad + " violations total"));

/* ------------------------------------------------ the boards that ship ----
   boards.json is committed output, so the gate has to read it rather than
   trust it. Every day is replayed through the same rule the browser uses and
   must still land in the pocket it was built around — and must not pass any
   other pocket on the way there, which would make the board a lie. */

const file = JSON.parse(readFileSync(BOARDS, "utf8"));
const dates = Object.keys(file.days);
let traced = 0, early = 0, missed = 0, short = 0;

for (const date of dates) {
  const d = file.days[date];
  const [W, H] = d.s;
  const B = { bx: d.b[0], by: d.b[1], bx2: d.b[2], by2: d.b[3] };
  const hits = [];
  let s = { x: d.e[0], y: d.e[1], dx: d.d[0], dy: d.d[1] };
  for (let t = 0; t < 12 * W * H && hits.length < file.bounces + 1; t++) {
    s = step(W, H, B, s);
    if (s.contact) hits.push(s);
  }
  if (hits.length < file.bounces + 1) { short++; continue; }
  const last = hits[hits.length - 1];
  if (!d.p.some(([x, y]) => x === last.x && y === last.y)) { missed++; continue; }
  if (hits.slice(0, -1).some((c) => d.p.some(([x, y]) => x === c.x && y === c.y))) { early++; continue; }
  traced++;
}

console.log(`\nshotcall boards.json  (v${file.version}, generated ${file.generated})`);
console.log(`  ${dates.length} days  ${dates[0]} to ${dates[dates.length - 1]}` +
            `  ${file.bounces} bounces  ${file.tries} tries  ${file.pockets} pockets`);
const boardChecks = [
  ["every board reaches its pocket in " + (file.bounces + 1) + " contacts", short + missed],
  ["no board passes another pocket first", early]
];
for (const [name, n] of boardChecks)
  console.log(`  ${n === 0 ? "PASS" : "FAIL"}  ${name}${n ? "  (" + n + " of " + dates.length + ")" : ""}`);

const badBoards = boardChecks.reduce((a, c) => a + c[1], 0);
console.log("\n" + (badBoards === 0
  ? `all ${traced} shipped boards trace to their pocket`
  : `${badBoards} shipped board(s) do not trace — regenerate with npm run shotcall:boards`));

/* ------------------------------------------- the boards made in the browser --
   Rejection sampling means every practice board is a fresh roll of the dice, so
   the only way to trust it is to check the dice. Each rule below is re-derived
   here, deliberately NOT by calling board.mjs's own evaluate(). */

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const rand = seeded(0x5ca1ab1e);
const gen = { made: 0, failed: 0 };
const genFails = {
  contacts: 0, corner: 0, answerOffRim: 0, answerNotAPocket: 0, earlyPocket: 0,
  legs: 0, blockUntouched: 0, ringDist: 0, pocketCount: 0, pocketOffRim: 0, pocketGap: 0,
};
const PER_SIZE = 250;

for (const [W, H] of SIZES) {
  const { rim, idxOf } = rimContext(W, H);
  const onRim = new Set(rim.map(key));

  for (let i = 0; i < PER_SIZE; i++) {
    const b = randomBoard(W, H, rand);
    if (!b) { gen.failed++; continue; }
    gen.made++;
    let bad = false;
    const fail = (k) => { genFails[k]++; bad = true; };

    const hits = contacts(W, H, b.B, b.entry, b.dir, CONTACTS);
    if (hits.length < CONTACTS) fail("contacts");
    else {
      if (hits.some((c) => c.corner)) fail("corner");
      const answer = hits[CONTACTS - 1];
      if (!answer.rim) fail("answerOffRim");
      if (!b.pockets.some((p) => key(p) === key(answer))) fail("answerNotAPocket");
      if (b.pockets[b.answerIdx] === undefined || key(b.pockets[b.answerIdx]) !== key(answer))
        fail("answerNotAPocket");
      if (hits.slice(0, CONTACTS - 1).some((c) => b.pockets.some((p) => key(p) === key(c))))
        fail("earlyPocket");

      const legs = [];
      let prev = 0;
      for (const c of hits) { legs.push(c.t - prev); prev = c.t; }
      if (Math.min(...legs) < MIN_LEG || Math.max(...legs) > MAX_LEG) fail("legs");
      if (!hits.slice(0, CONTACTS - 1).some((c) => c.block)) fail("blockUntouched");

      const ai = idxOf.get(key(answer)), ei = idxOf.get(key(b.entry));
      const d = Math.abs(ai - ei);
      if (Math.min(d, rim.length - d) < MIN_RING_DIST) fail("ringDist");
    }

    if (b.pockets.length !== POCKET_COUNT || new Set(b.pockets.map(key)).size !== POCKET_COUNT)
      fail("pocketCount");
    if (!b.pockets.every((p) => onRim.has(key(p)))) fail("pocketOffRim");
    const idx = b.pockets.map((p) => idxOf.get(key(p))).sort((x, y) => x - y);
    for (let j = 0; j < idx.length; j++) {
      const a = idx[j], c = idx[(j + 1) % idx.length];
      const d = Math.abs(c - a);
      if (Math.min(d, rim.length - d) < MIN_POCKET_GAP) { fail("pocketGap"); break; }
    }

    if (bad) gen.failed++;
  }
}

console.log(`\nruntime generator  (${gen.made.toLocaleString()} boards, ${PER_SIZE} per size)`);
const genChecks = Object.entries(genFails);
const genBad = genChecks.reduce((a, c) => a + c[1], 0);
if (genBad === 0) {
  console.log(`  PASS  every rule re-derived and held on all ${gen.made.toLocaleString()} boards`);
} else {
  for (const [name, n] of genChecks) if (n) console.log(`  FAIL  ${name}  (${n})`);
}

// the reference board, traced and printed for the record
const W = 11, H = 9, B = { bx: 3, by: 3, bx2: 5, by2: 4 };
const ref = run(W, H, B, { x: 1, y: 0, dx: 1, dy: 1 }, 16);
const refHits = ref.filter((s) => s.contact).slice(0, 4);
console.log("\nreference board 11x9, block (3,3)-(5,4), in at (1,0) up-right:");
console.log("  contacts: " + refHits.map((c) =>
  `(${c.x},${c.y})${c.block ? " block" : " rail"}`).join("  ->  "));
console.log("  legs: " + (() => {
  const ts = []; let last = 0;
  ref.forEach((s, i) => { if (s.contact && ts.length < 4) { ts.push(i - last); last = i; } });
  return ts.join("-");
})());

if (bad > 0 || badBoards > 0 || genBad > 0) process.exit(1);
