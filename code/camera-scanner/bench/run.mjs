// The scanner degradation bench: a COMMITTED script so an engine change is
// gated on a measurement, not a vibe.
//
//   node bench/run.mjs --engine=js          # baseline (the retired engine)
//   node bench/run.mjs --engine=wasm        # what the app ships
//   node bench/run.mjs --engine=both        # same frames, both engines
//   flags: --sessions=220 --frames=14 --seed=1 --fixture=slip-m2 --spacingMs=120
//
// Every engine/policy cell is evaluated over the SAME degraded frames (one
// generation per session, seeded), so a difference between cells is the engine
// or the policy — never the dice.
//
// `--spacingMs` is the SAFETY gate for any change to how fast frames arrive.
// It sets the AR(1) correlation between neighbouring frames (see degrade.mjs):
// closer frames are more alike, and "a drifting hand cannot repeat a wrong read"
// is the whole premise of the confirmation streak. Crucially it does NOT change
// each frame's marginal degradation, so fabrication incidence stays constant and
// only REPEATABILITY varies — the v1 `--cadenceMs` scaled amplitude too, which
// suppressed the fabrications it was supposed to catch and made the gate
// unfailable. Read the WRONG column, not the speed one.
//
// `--spacingMs=0` is the limiting case: rho = 1, a frozen pose, every frame
// identical. Any fabrication there repeats forever and defeats a streak of ANY
// length, so its WRONG column measures the IRREDUCIBLE risk that no confirmation
// count can fix. Use it as the pessimistic bound on going faster.
//
// The `attempts` column is how many decode attempts a session needed before the
// policy accepted, averaged over the sessions that accepted.
//
// NOTE ON WALL-CLOCK: attempts x spacingMs is NOT the operator-felt time. In
// production, blank aiming frames are spaced by the loop's attemptMs cadence
// and an ACCEPTED read is followed by the successPauseMs anti-storm pause —
// model the two separately.
//
// Accept policies mirror <CameraScanner> exactly: N consecutive frames must
// return the same payload; a frame that reads NOTHING breaks the streak.
// "answered" = the policy accepted some payload within the session's frames;
// "WRONG" = the accepted payload differs from the fixture's expected payload.

import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';
import { makeJsEngine, makeWasmEngine } from './engines.mjs';
import { makeRng, makeSession, renderFrame, tremorRho } from './degrade.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));
const ENGINES = args.engine === 'both' ? ['js', 'wasm'] : [args.engine ?? 'js'];
const SESSIONS = Number(args.sessions ?? 220);
const FRAMES = Number(args.frames ?? 14);
const SEED = Number(args.seed ?? 1);
// Frame spacing under test, in ms. 120 reproduces the historical baseline (the
// v1 model's independent-frames behaviour); 0 is the frozen-pose bound.
const SPACING_MS = Number(args.spacingMs ?? 120);

const POLICIES = [
  { key: 'first', label: 'first frame wins', needed: 1 },
  { key: '2row', label: '2 in a row', needed: 2 },
  { key: '3row', label: '3 in a row', needed: 3 },
];

/**
 * Two payloads are the SAME FACT when they differ only in GS1 anchor form —
 * `]C1`/`]d2` AIM prefix vs a leading GS byte. The server-side GS1 parser
 * parses both to identical lookup keys and bindable payloads, so the bench
 * must not count the anchor as a wrong read; a real fabrication differs in
 * CONTENT, which this preserves byte-for-byte.
 */
function payloadKey(p) {
  const stripped = p.replace(/^\][A-Za-z]\d/, '').replace(/^\x1d/, '');
  // A bare GTIN-length digit run is the same fact at any zero-padded length:
  // zxing-cpp reports UPC-A as EAN-13 with a leading zero (measured — the js
  // engine returns 12 digits, wasm 13, for the same symbol), and the server
  // canonicalizes exactly this way. A fabrication differs in DIGITS, which
  // padding preserves.
  if (/^\d{8}$|^\d{12,14}$/.test(stripped)) return stripped.padStart(14, '0');
  return stripped;
}

/**
 * The <CameraScanner> streak, replayed over one session's frame payloads.
 * Returns the accepted payload AND how many attempts it took — the second is
 * what turns a policy into a wall-clock number once you know the cadence.
 */
function acceptedBy(payloads, needed) {
  let streak = { payload: null, count: 0 };
  for (let i = 0; i < payloads.length; i += 1) {
    const p = payloads[i];
    if (!p) { streak = { payload: null, count: 0 }; continue; }
    streak = { payload: p, count: p === streak.payload ? streak.count + 1 : 1 };
    if (streak.count >= needed) return { payload: p, attempts: i + 1 };
  }
  return null;
}

const fixtures = JSON.parse(await readFile(path.join(HERE, 'fixtures', 'expected.json'), 'utf8'))
  .filter((f) => !args.fixture || f.id === args.fixture);

// e.g. --wasmOpts='{"tryDenoise":true}' — candidate-option sweeps, wasm only.
const wasmOpts = args.wasmOpts ? JSON.parse(args.wasmOpts) : {};
const engineFor = async (name, set) => (name === 'js' ? makeJsEngine(set) : makeWasmEngine(set, wasmOpts));

console.log(`sessions=${SESSIONS} frames=${FRAMES} seed=${SEED} engines=${ENGINES.join(',')}`
  + ` spacing=${SPACING_MS}ms (AR1 rho=${tremorRho(SPACING_MS).toFixed(3)})\n`);
const rows = [];

for (const fixture of fixtures) {
  const basePng = await readFile(path.join(HERE, 'fixtures', fixture.file));
  // decoded payload sequences: results[engine][formatSet][session] = [payload|null,...]
  const results = {};
  for (const e of ENGINES) {
    results[e] = {};
    for (const set of fixture.formatSets) results[e][set] = [];
  }
  const engines = {};
  for (const e of ENGINES) {
    engines[e] = {};
    for (const set of fixture.formatSets) engines[e][set] = await engineFor(e, set);
  }

  const rng = makeRng(SEED * 1000003 + fixture.id.length);
  for (let s = 0; s < SESSIONS; s += 1) {
    const session = makeSession(rng, fixture.band);
    const frames = [];
    for (let i = 0; i < FRAMES; i += 1) {
      frames.push(await renderFrame(basePng, fixture.pxPerModule, session, rng, SPACING_MS));
    }
    for (const e of ENGINES) {
      for (const set of fixture.formatSets) {
        const seq = [];
        for (const frame of frames) {
          const hit = await engines[e][set].decode(frame);
          seq.push(hit?.payload ?? null);
        }
        results[e][set].push(seq);
      }
    }
    if ((s + 1) % 40 === 0) process.stderr.write(`  ${fixture.id}: ${s + 1}/${SESSIONS} sessions\r`);
  }
  process.stderr.write('\n');

  for (const e of ENGINES) {
    for (const set of fixture.formatSets) {
      for (const policy of POLICIES) {
        let answered = 0; let wrong = 0; let attemptSum = 0; const wrongSamples = new Set();
        for (const seq of results[e][set]) {
          const accepted = acceptedBy(seq, policy.needed);
          if (accepted === null) continue;
          answered += 1;
          attemptSum += accepted.attempts;
          if (payloadKey(accepted.payload) !== payloadKey(fixture.expectedPayload)) {
            wrong += 1;
            if (wrongSamples.size < 5) wrongSamples.add(accepted.payload);
          }
        }
        rows.push({
          fixture: fixture.id, engine: e, formats: set, policy: policy.label,
          answered: `${answered}/${SESSIONS}`,
          pct: `${((answered / SESSIONS) * 100).toFixed(0)}%`,
          wrong,
          wrongPct: answered ? `${((wrong / answered) * 100).toFixed(1)}%` : '-',
          attempts: answered ? (attemptSum / answered).toFixed(1) : '-',
          samples: [...wrongSamples].map((x) => JSON.stringify(x)).join(' '),
        });
      }
    }
  }
}

const cols = ['fixture', 'engine', 'formats', 'policy', 'answered', 'pct', 'wrong', 'wrongPct', 'attempts'];
const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c]).length)));
console.log(cols.map((c, i) => c.padEnd(widths[i])).join('  '));
console.log(widths.map((w) => '-'.repeat(w)).join('  '));
for (const r of rows) {
  console.log(cols.map((c, i) => String(r[c]).padEnd(widths[i])).join('  ') + (r.samples ? `  ${r.samples}` : ''));
}
