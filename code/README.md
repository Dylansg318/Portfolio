# Code excerpts from MHLHUB

MHLHUB is a private production ERP — orders, inventory, repricing, shipping,
customer service and books for a dental-supply e-commerce company, roughly 500
orders a day across six sales channels. The system itself can't be open-sourced,
but a lot of the engineering inside it is general. This tree holds the pieces
that stand on their own, extracted and sanitized: identifiers, fixtures,
endpoints and customer data replaced; the design reasoning kept.

These folders are published as **readable excerpts, not installable packages**.
Each has its own README explaining the problem it solves and the sharp edges it
encodes. Tests are included where they were self-contained; they run under the
source project's harness.

## AI-assisted engineering at scale

| Folder | What it is |
|---|---|
| [`session-lock/`](session-lock/) | File-lock coordination for 5–8 concurrent AI coding sessions sharing one git checkout: O_EXCL atomic locks keyed on the real sharing boundary (`git rev-parse --git-path index`), PID-liveness + TTL steal, guard hooks that block the unrecoverable git operations — and fail *open* by design. |
| [`fleet-scripts/`](fleet-scripts/) | Spawn one terminal tab per work slice (each agent in its own git worktree), reap finished sessions, and audit worktrees for finished-but-unmerged work — including the `git diff A...B` three-dot trap that let finished features rot unmerged. |
| [`ai-context-tools/`](ai-context-tools/) | Keep an AI agent's persistent memory index *generated* from per-file frontmatter (no index/file drift, no silent truncation), plus a read-only SQLite-graph visualizer that renders a codebase's module architecture as one interactive map. |
| [`agent-configs/`](agent-configs/) | The transferable core of a multi-model review discipline: a second *model* (not a second pass) reviews before work whose mistakes are expensive to find or undo — triggered by consequence, never by diff size. |

## Warehouse, printing and scanning

| Folder | What it is |
|---|---|
| [`barcode-parsers/`](barcode-parsers/) | Pure-function GS1 Application Identifier parser (GTIN equivalence, FNC1 handling) and carrier-label barcode → tracking-number extraction (USPS IMpb, FedEx "96", UPS 1Z), with the ambiguity cases documented. |
| [`camera-scanner/`](camera-scanner/) | A zxing-wasm camera decode loop with an N-frame agreement policy, plus a statistical bench that models hand tremor as an AR(1) walk — so the acceptance gate measures repeatability, not amplitude. |
| [`zpl-layout-kit/`](zpl-layout-kit/) | Foundations of a JSON-layout → ZPL II renderer for thermal printers: a real glyph-advance text-width model, barcode module-width fitting, Floyd–Steinberg 1-bit dithering for photos, and a render-and-look preview loop via Labelary. |
| [`epl-to-zpl/`](epl-to-zpl/) | A 184-line EPL2 → ZPL II converter that fixes the "printer under a ZPL driver prints EPL as a blank page" failure. |
| [`device-agent/`](device-agent/) | A self-updating Windows device agent and its supervisor: manifest polling, sha256 + syntax-check verification, probation window, crash-loop rollback with version blacklist — and a rollback executor that is never allowed to update itself. |

## Data plumbing and guardrails

| Folder | What it is |
|---|---|
| [`carrier-invoice-parsers/`](carrier-invoice-parsers/) | UPS Billing Data File (headerless, exactly 250 CSV fields) and FedEx PDF invoice parsers — with column semantics derived *empirically* against invoice totals rather than trusted from a spec. |
| [`server-utils/`](server-utils/) | Small sharp server primitives: a Postgres savepoint helper that explains why catching a unique-violation inside a transaction is a trap, an SQL-shape guard for an LLM-driven write endpoint, AES-256-GCM secret storage, RFC 6238 TOTP with zero deps, concurrency limiters and caches. |
| [`client-utils/`](client-utils/) | React list-state hooks (URL + localStorage persistence with TTL expiry), a freeform US-address parser, a unified browser CSV/XLSX/XML reader, and the Vite lazy-chunk-404-after-deploy reloader. |
| [`arch-guard/`](arch-guard/) | A source-scan invariant engine for the rules an import graph cannot see ("no channel code may write the product master"), complementing import-boundary tools like dependency-cruiser. |

## Provenance

Everything here shipped and runs (or ran) in production. Extraction preserved
the load-bearing comments — the *why* — while replacing company vocabulary,
real order/tracking numbers, fixture data and internal endpoints with neutral
stand-ins. Where a module depended on app internals, the seam was cut and the
README says so.
