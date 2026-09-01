'use strict';

// In-flight request tracking for graceful deploy drains.
//
// The deploy platform sends SIGTERM to the old container on every redeploy and
// hard-kills it a few seconds later (a configurable drain window, default 3s).
// A bulk label buy takes 30–60s per chunk, so a deploy mid-batch used to
// sever the process between "label bought at the carrier" and "finalize +
// queue the print" (one order was left with an orphaned carrier label, another
// shipped but never printed). The shutdown handler now waits for these tracked
// requests to finish before exiting — see the server entrypoint.
//
// Only mounted on the money-touching shipping prefixes (/api/orders,
// /api/shipments, /api/shipping-labels). Deliberately NOT global: a long-poll
// or streaming endpoint elsewhere would hold the drain open to its ceiling on
// every deploy. None of the tracked routers hold connections open.

const active = new Set();
let seq = 0;
// Process-wide "we got SIGTERM, exit is imminent" flag. Set once by the
// shutdown handler, read by /health (503 draining), the job runner (refuse to
// START new runs — a cron tick seconds before the kill would launch a long
// sync doomed to die mid-write), and any checkpointed job loop that wants to
// stop cleanly at its next safe boundary instead of being killed mid-item.
let draining = false;

function markDraining() {
  draining = true;
}

function isDraining() {
  return draining;
}

function trackInflight(req, res, next) {
  const id = ++seq;
  active.add(id);
  const done = () => active.delete(id);
  // 'close' fires on aborted/severed sockets too — a dead client must not
  // leak an entry and wedge every future drain at the ceiling.
  res.once('finish', done);
  res.once('close', done);
  next();
}

function activeCount() {
  return active.size;
}

// Resolve when every tracked request has finished, or after maxMs.
// Returns the number still active (0 = clean drain).
async function waitForDrain(maxMs, pollMs = 250) {
  const deadline = Date.now() + maxMs;
  while (active.size > 0 && Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, pollMs));
  }
  return active.size;
}

module.exports = { trackInflight, activeCount, waitForDrain, markDraining, isDraining };
