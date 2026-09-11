/**
 * CAROM — the reflection rule, in one place.
 *
 * Three things have to agree about where the ball goes: the generator that deals
 * a year of boards, the gate that proves the physics, and the demo the browser
 * runs. Each of them used to carry its own copy of the rule, which is two extra
 * chances for the shipped game to disagree with the board it was dealt — and the
 * disagreement would look like a wrong answer, not like a bug. This is the one
 * copy. scripts/carom-boards.mjs, scripts/carom-physics.mjs and ./index.ts all
 * import it, so the gate now verifies the code that actually ships.
 *
 * It is plain .mjs rather than .ts deliberately: the two scripts are run by node
 * with no build step, and the demo imports it through Vite, which types it from
 * the JSDoc below.
 *
 * WHY THIS IS EXACT, AND NOT A SIMULATION
 *   The ball travels the 45-degree lattice — one unit of x for every unit of y,
 *   always. So it lands on every whole x and every whole y on the way, no
 *   position is ever a fraction, and it cannot slip through a face before
 *   touching it. There is no tolerance, no epsilon, and nothing to tune.
 *
 * WHY A BLOCK FACE IS JUST A RAIL
 *   An axis-aligned surface flips the perpendicular component and leaves the
 *   parallel one alone, whichever side of it you stand on. So the block needs no
 *   rule of its own: its vertical faces do what the left and right rails do, its
 *   horizontal faces what the top and bottom do, and its corner flips both. That
 *   is also why the block costs the player nothing to learn.
 *
 * WHAT DID NOT SURVIVE
 *   On a bare rectangle you never step at all: rail contacts fall at
 *   t = -entry.x (mod W) or t = -entry.y (mod H), so the whole contact sequence
 *   is two arithmetic progressions merged. The block breaks that. Its faces are
 *   not on those progressions, and a bounce off one restarts the ball from a new
 *   point and direction, so every progression downstream would have to be
 *   re-derived. Stepping one diagonal unit at a time is what is left, and at
 *   ~8 million steps for the entire search space it costs about a fifth of a
 *   second — so the closed form would have bought nothing and risked being wrong.
 *
 * @typedef {{ bx: number, by: number, bx2: number, by2: number }} Block
 *   Spans [bx, bx2] x [by, by2] and is strictly interior, so it never forms a
 *   nook against a rail.
 * @typedef {{ x: number, y: number }} Point
 * @typedef {{ x: number, y: number, dx: number, dy: number }} Moving
 * @typedef {{ x: number, y: number, t: number, rim: boolean, block: boolean,
 *             corner: boolean }} Contact
 *   `t` is the step the contact happened on, which is also the leg length in
 *   dots. `rim` means the outer boundary — a pocket can only live there.
 */

/**
 * Which faces a lattice point sits on.
 *
 * `rim` describes the point, not the contact: it is true for anything on the
 * outer boundary, and being on the rim always is a contact. `v`/`h` are the
 * vertical and horizontal surfaces the point touches, rim and block together.
 *
 * @param {number} W
 * @param {number} H
 * @param {Block | null} B
 * @param {number} x
 * @param {number} y
 * @returns {{ v: boolean, h: boolean, rim: boolean }}
 */
export function faces(W, H, B, x, y) {
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

/**
 * One diagonal unit, then reflect off whatever the new point is touching.
 *
 * This is the whole law. It is kept free of assertions on purpose so the physics
 * gate can measure how often it would break an invariant instead of dying on the
 * first one; `contacts()` below is where the safety check lives.
 *
 * @param {number} W
 * @param {number} H
 * @param {Block | null} B
 * @param {Moving} s
 */
export function step(W, H, B, s) {
  const x = s.x + s.dx, y = s.y + s.dy;
  const f = faces(W, H, B, x, y);
  const contact = f.v || f.h;
  return {
    x, y,
    dx: f.v ? -s.dx : s.dx,
    dy: f.h ? -s.dy : s.dy,
    /* The ray the ball ARRIVED on. Reversing a path means negating this pair,
       never the outgoing one above — at a contact they are different rays, and
       negating the wrong one is what made the first reversibility test fail. */
    inDx: s.dx,
    inDy: s.dy,
    v: f.v,
    h: f.h,
    contact,
    rim: contact && f.rim,
    block: contact && !f.rim,
    corner: f.v && f.h,
  };
}

/**
 * Every contact the ball makes, in order, at most `max` of them.
 *
 * The entry point is not a contact and is not in the list, so `contacts(...)[n]`
 * is the (n+1)th thing the ball hits. Fewer than `max` entries means the ball
 * ran out of table before making that many, which the callers treat as an
 * unusable board rather than an error.
 *
 * @param {number} W
 * @param {number} H
 * @param {Block | null} B
 * @param {Point} entry
 * @param {Point} dir
 * @param {number} max
 * @returns {Contact[]}
 */
export function contacts(W, H, B, entry, dir, max) {
  /** @type {Contact[]} */
  const out = [];
  let s = { x: entry.x, y: entry.y, dx: dir.x, dy: dir.y };
  const cap = 12 * W * H;   // a 45-degree path on a coprime table closes well inside this
  for (let t = 1; t <= cap && out.length < max; t++) {
    s = step(W, H, B, s);
    if (B && s.x > B.bx && s.x < B.bx2 && s.y > B.by && s.y < B.by2)
      throw new Error(
        `carom: the ball reached (${s.x},${s.y}), strictly inside the block — ` +
        `the reflection rule is wrong`);
    if (!s.contact) continue;
    out.push({ x: s.x, y: s.y, t, rim: s.rim, block: s.block, corner: s.corner });
  }
  return out;
}
