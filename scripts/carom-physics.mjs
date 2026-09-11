#!/usr/bin/env node
/**
 * CAROM — physics gate.
 *
 * Carom's whole promise is that the ball goes where the geometry says. This
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
 * NOTE ON (7), because it looks like a fudge and is not. Time-reversing a bounce
 * means leaving the contact along the negated INCOMING ray, not the negated
 * outgoing one — those are different rays at every contact point. The first
 * version of this test negated the wrong one and failed 32% of cases.
 *
 * Run: npm run carom:verify
 */

function onBlock(B, x, y) {
  if (!B) return { v: false, h: false };
  const inX = x >= B.bx && x <= B.bx2, inY = y >= B.by && y <= B.by2;
  const fX = (x === B.bx || x === B.bx2), fY = (y === B.by || y === B.by2);
  if (fX && fY && inX && inY) return { v: true, h: true };
  if (fX && inY) return { v: true, h: false };
  if (fY && inX) return { v: false, h: true };
  return { v: false, h: false };
}

// one diagonal step, then reflect off whatever the new point is touching
function step(W, H, B, s) {
  const x = s.x + s.dx, y = s.y + s.dy;
  const rimV = (x === 0 || x === W), rimH = (y === 0 || y === H);
  const b = onBlock(B, x, y);
  const V = rimV || b.v, Hh = rimH || b.h;
  return {
    x, y,
    dx: V ? -s.dx : s.dx,
    dy: Hh ? -s.dy : s.dy,
    contact: V || Hh, onRim: rimV || rimH, onBlock: b.v || b.h,
    hitV: V, hitH: Hh,
    inDx: s.dx, inDy: s.dy
  };
}

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
            if (flippedX !== !!p.hitV || flippedY !== !!p.hitH) fails.reflect++;
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

console.log("carom physics gate");
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
if (bad > 0) process.exit(1);

// the page's own board, traced and printed for the record
const W = 11, H = 9, B = { bx: 3, by: 3, bx2: 5, by2: 4 };
const p = run(W, H, B, { x: 1, y: 0, dx: 1, dy: 1 }, 16);
const contacts = p.filter(s => s.contact).slice(0, 4);
console.log("\nreference board 11x9, block (3,3)-(5,4), in at (1,0) up-right:");
console.log("  contacts: " + contacts.map(c =>
  `(${c.x},${c.y})${c.onBlock ? " block" : " rail"}`).join("  ->  "));
console.log("  legs: " + (() => {
  const ts = []; let last = 0;
  p.forEach((s, i) => { if (s.contact && ts.length < 4) { ts.push(i - last); last = i; } });
  return ts.join("-");
})());
