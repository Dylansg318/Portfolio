# Device Agent — self-updating Windows print agent

> Extracted from a private production ERP; identifiers, endpoints and fixtures have been sanitized.

A two-process system that runs on warehouse Windows PCs physically connected to USB thermal label printers (Zebra ZP 450 / ZD-series). The **agent** polls the server's print queue and prints; the **supervisor** keeps the agent alive and ships new agent versions to a fleet of unattended machines — with verification, probation, and automatic rollback — so nobody ever remote-desktops into a warehouse PC to "update the printer thing".

```
device-agent/
├── agent.js               the print agent (single file, by design — see below)
├── zebra-bidi.cs          raw-USB status reader for Zebra printers (compile with csc.exe)
├── supervisor/
│   ├── supervisor.js      spawn/watchdog/auto-update/key-rotation
│   ├── lib.js             the supervisor's pure decision helpers
│   └── __tests__/
└── __tests__/             agent pure-helper + serve-channel tests (node:test, no deps)
```

Run the tests: `npm test` (uses `node --test`; no dependencies).

## The supervisor: an updater that cannot brick the fleet

`supervisor/supervisor.js` (~300 lines) spawns `node agent.js` as a child and restarts it on exit. Every ~3 minutes (jittered) it polls a server manifest, and when the manifest advertises a new agent version it:

1. **Downloads** the new `agent.js` from the server.
2. **Verifies** it two ways: the sha256 of the downloaded bytes must match the manifest, and `node --check` must accept the syntax. Either failure aborts the update with nothing changed.
3. **Waits for the agent to go idle** — the agent writes a busy flag while a job is mid-print, and a version swap never lands inside that window (a kill mid-print leaves a claimed job in limbo).
4. **Hot-swaps**: copies the current `agent.js` to `agent.prev.js`, renames the new file into place, and restarts the child.
5. **Runs ~90 seconds of probation.** The new agent must write a health heartbeat naming its own version. If it instead crash-loops (3 crashes) or never reports healthy inside the window, the supervisor **rolls back** to `agent.prev.js` and **blacklists** the bad version's hash in `agent-state.json` so it is never retried — the fleet silently pins to the last good version until a fixed build ships.
6. A **liveness watchdog** separately force-restarts an agent that is alive but frozen (heartbeat stale > 2 minutes, with a spawn grace period so a just-started agent isn't killed before its first heartbeat).

It also **rotates the agent's API key on demand**: when the manifest says a rotation is due, it requests a new key, rewrites the single `.env` line in place, and restarts the child. The old key stays valid server-side until the rotation completes, so a briefly-offline host can't lock itself out.

**The supervisor never updates itself.** It is the rollback executor, and the rollback executor must not be able to break itself. A breaking supervisor-protocol change is the only event that requires re-running the installer — everything else ships through the manifest.

All of the supervisor's decisions (should-update, probation verdict, watchdog verdict, env rewriting) live in `supervisor/lib.js` as pure functions with unit tests; `supervisor.js` is the I/O shell around them.

### The single-file rule

The auto-update channel delivers exactly **one file**: `agent.js`. Every helper must live in that file (exported for tests, never `require()`'d from a sibling). This rule was learned the hard way: a refactor once split helpers into a second module, and the updated agent crashed on every host with "module not found" — the second file was never delivered. Probation caught it and rolled every host back, which is the system working as designed, but the fleet was silently pinned to the old version until the helpers were inlined again.

## The agent

`agent.js` polls the queue, claims a job, prints it — PDFs through SumatraPDF aimed at a *specific named* Windows printer (never the system default), raw ZPL through the Win32 spooler API (`OpenPrinter` → `StartDocPrinter` with `DataType="RAW"` → `WritePrinter`; the naive `cmd /c print` route silently exits 0 on USB-only printers without putting anything on the wire).

Around that core is a set of duplicate-label and lost-label defenses, each one earned by a production incident:

- **Claim-ACK protocol** — the server marks a job claimed before the agent has the response, so on a flaky NIC a claim can be lost in transit. The agent ACKs every claim and prints only after the ACK is confirmed; an unconfirmable ACK abandons the job *unprinted* for fast server redelivery. Nothing prints twice, nothing prints blind.
- **Persistent outcome ledger** — a label that physically printed but whose "done" report can't reach the server (network outage) is persisted to disk and retried every cycle until acknowledged, surviving agent restarts. Otherwise the server's reaper would requeue it and a duplicate label would print.
- **In-flight reconciliation** — before printing, the agent persists `{job, odometer-before}`; if it dies mid-print, the restart reads the printer's odometer and settles the orphan (printed / not printed / needs-human) instead of letting the reaper guess.
- **Circuit breaker** — three consecutive print failures pause claiming so a paper-out printer doesn't burn the whole queue to failed.
- **Bidirectional verification (optional)** — with `zebra-bidi.exe` present, the agent reads the Zebra's odometer and status registers over raw USB before/after each job and judges the feed *per label*: `ok` / `no_feed` (spooler accepted, nothing moved — the silent-failure case, safe to requeue) / `partial` (some labels exist — flagged, never auto-reprinted) / `runaway` (dump mode — the agent halts claiming until a human clears it). Every read failure **fails open**: a broken read channel on a healthy printer must never stop shipping.
- **Structural ZPL lint** — payloads that would feed a blank label (no `^FD` data, no graphics, unbalanced `^XA`/`^XZ`) are caught before wasting a claim.

`zebra-bidi.cs` is the raw-USB reader (~340 lines of C#): query-only by design (a command allowlist makes destructive commands unsendable), synchronous reads drained to the printer's zero-length-packet terminator (overlapped reads that cancel a dangling IRP deterministically eat the *next* query's response), a resident `serve` mode so the agent pays one .NET start per agent lifetime instead of six per job, and a global mutex so the maintenance CLI can interleave safely beside a live agent.

## The Windows install story

The installer registers the agent as a **Windows Scheduled Task**, and every choice in that sentence is deliberate:

- It runs as the **actual console user, not SYSTEM** — SYSTEM can't see USB-installed printers in most setups. And not a group principal either: ambiguous identity stops the task firing in some configurations.
- The task launches through a **`wscript.exe` → `run-agent.vbs` shim** so Node runs with *no console window*. Before the shim, closing a stray console window killed the agent.
- **Two triggers**: `AtLogOn` for the specific user (fresh logons), plus a repeating **every-5-minutes safety-net trigger** that catches reboots where Fast Startup's hibernate-wake never emits a logon event. `MultipleInstances=IgnoreNew` keeps the safety net from double-starting a running agent.
- The install directory and task name both carry the printer's id, so one PC can host several printer agents without a second install silently evicting the first.
- Re-running the installer is the canonical refresh: it stops the task, sweeps orphan processes scoped to *that printer's* install directory only (a wildcard sweep would kill the other printers' agents), re-registers, and restarts.

## Files on the host (`C:\DeviceAgent\`)

| File | Role |
|---|---|
| `supervisor.js` + `lib.js` | the supervisor — embedded by the installer, never auto-updated |
| `agent.js` | current agent — auto-updated |
| `agent.prev.js` | last known-good agent — rollback target |
| `agent-state.json` | rejected version hashes + last good version |
| `agent-health.json` | heartbeat written by the agent; read by the supervisor |
| `agent-busy.json` | present while a job is mid-print; blocks planned restarts |
| `outcome-ledger.json` | unconfirmed done/fail reports awaiting server acknowledgment |
| `inflight.json` | the job being printed right now, for crash reconciliation |
| `print-audit.jsonl` | local audit trail of every verification verdict |
