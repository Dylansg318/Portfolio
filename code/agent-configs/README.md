# Agent Configs — a multi-model review discipline

Extracted from a private production ERP's agent setup; project-specific trip-wires rewritten as generic examples.

These are working agent definitions and skills from a Claude Code setup that runs
a real production system — a codebase where an unreviewed mistake can move money,
corrupt a ledger, or write bad data to a vendor's API. They encode three ideas
that transfer to any team putting AI agents on consequential code.

## 1. Second *model*, not second pass — triggered by consequence, not diff size

A model re-reading its own work buys fresh context but keeps the same blind
spots. The review agents here are dispatched **cross-model**: an Opus session
sends work to a Fable reviewer ([`agents/fable-review-deep.md`](agents/fable-review-deep.md)),
and a Fable or Sonnet session sends work to an Opus reviewer
([`agents/opus-review-deep.md`](agents/opus-review-deep.md)) — the mirror-image
agent exists precisely so the reviewer is never the session model. The Opus
variant even flags it in its report when it detects it was dispatched by an
Opus session: "the finding still stands, but the caller should know what they
bought."

The trigger is **consequence, not size**. A long UI diff needs no pass — its
failure is visible on screen and revertible in a prompt. A 20-line ledger change
does — its failure is a plausible-looking number nobody questions for weeks. The
descriptions bake the trigger list in: money/books, bulk production writes,
vendor-API writes, migrations/backfills/teardowns/deletes, permissions, and
anything that can be *silently* wrong (a job that reports success while doing
nothing, a filter that fails open, a checkpoint stamped only on success).

Three effort tiers keep the cost proportional:

| Agent | When |
|---|---|
| [`fable-review-deep`](agents/fable-review-deep.md) / [`opus-review-deep`](agents/opus-review-deep.md) | Before executing consequential work (high effort, exhaustive) |
| [`fable-review-quick`](agents/fable-review-quick.md) | A small diff you're genuinely unsure about — doubt, not size (medium effort) |
| *no review* | UI, layout, copy, docs, read-only reports — ship on sight |

All reviewers are **read-only** (no Edit/Write tools), return **ranked findings**
(`BLOCKER` / `SHOULD-FIX` / `NIT`) with file:line evidence and a concrete fix,
and are explicitly told that finding nothing is an acceptable answer — a review
that invents findings to look thorough is as useless as a rubber stamp.

[`agents/fable-implement.md`](agents/fable-implement.md) is the same
cross-model idea applied to *doing* rather than reviewing: the second model
builds a scoped change end-to-end, runs the real verification gates, but is
hard-stopped from git — staging and commits stay with the orchestrating
session, which matters when many agent sessions share one checkout.

## 2. Review-before-execute, ship-on-sight — a bright line, written down

The dividing line the whole setup runs on: **is the failure visible, and is it
cheap to undo?** A wrong pixel is not a wrong ledger. Work whose failure shows
up on screen and reverts in a prompt ships immediately; work whose failure is
expensive to *find* (silently wrong) or expensive to *undo* (irreversible,
outward-facing) gets the second-model pass *before* execution — reviewing the
plan or diff while backing out is still free, not auditing the damage after.

Encoding this in the agent descriptions themselves means the dispatching model
reads the trigger criteria at the moment it chooses whether to dispatch —
the policy lives where the decision happens, not in a wiki nobody re-reads.

## 3. Planning as a decision ledger, not a step list

[`skills/change-record.md`](skills/change-record.md) replaces long
implementation plans with a ~60–90-line **change record**, on measured evidence:
an audit of the project's plan corpus found 477 plans averaging 905 lines, at
1.35 commits per plan file — written once, never updated, unable to say what
shipped. Worse, a detailed wrong plan gets *faithfully implemented and then
certified correct*, because spec-compliance review checks the diff against the
plan and can never catch error in the plan itself.

The replacement separates what a plan conflates:

- **Decision** (~30 lines) — the problem, chosen approach, rejected alternatives
  and why, and the invariants that must hold. The only part worth keeping in six
  months, and the only part worth a second-model review before code.
- **Verification contract** — written *before* any code: each slice names a
  proof command and its expected observable output. A slice with no nameable
  proof is not understood yet. The gate that catches a wrong plan is never a
  reviewer reading the plan; it is a command whose output you did not choose.
- **Scope ledger** — one line per slice with a status token (`TODO` / `WIP` /
  `DONE <sha7>` / `PARKED`). Exhaustive and cheap; the artifact that survives
  context compaction and prevents premature "done."
- **Slice detail** — written just-in-time, only for the slice being started,
  using what the previous slice taught. Detail past slice ~3 is precision
  without accuracy: it will be wrong, and it will be obeyed.

Full up-front plans remain correct in four named cases: parallel sessions that
can't renegotiate an interface, ordering-critical work (migrations, teardowns),
genuinely novel subsystems, and irreversible or money-touching changes.

## Supporting piece: the crew pattern

[`skills/crew.md`](skills/crew.md) generalizes the second-model idea into an
orchestration skill: Claude subagents for parallel in-repo throughput, a
different model family (Codex, via CLI) when *independence* is the point, and a
live-web research model (Perplexity) for facts that change outside the repo —
with guardrails (the orchestrator owns git; delegation is not abdication;
match the cost to the task) and the default move spelled out: *you plan → the
other model family reviews → you integrate*.

## Sanitization note

These files are real configuration, lightly genericized for publication. The
original "project trip-wires" sections named internal tables, columns, and
helpers; they are rewritten here as generic examples of the same lessons —
"use the shared permission helper, never an inline flag check," "window metrics
on the business date, not the row-insert date," "one table per concept — don't
create a synonym table," "sync code writes mirror tables, never the master
catalog," "an external id is only unique per account — scope every lookup."
The lessons are the point; the vocabulary was the only thing private.
