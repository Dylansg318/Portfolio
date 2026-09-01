---
name: change-record
description: "Write a change record (decision + scope ledger + verification contract, ~60-90 lines) instead of a full implementation plan. Use when planning any change — 'plan this', 'spec this out', 'break this into steps'. Full plans only for parallel sessions, ordering-critical migrations, novel subsystems, or irreversible/money changes."
---

# Change Record

The default planning artifact: a ~60–90-line decision + scope ledger + verification
contract, instead of a hundreds-of-lines implementation plan.

## Why this replaces long plans — measured, not assumed

An audit of the project's plans directory found **477 plans / 431,744 lines**, averaging
**905 lines**, at **1.35 commits per plan file** (written once, never updated) with
**~13 status markers total across all 477**. Plans were functioning as single-use
*prediction* artifacts that frequently cost more tokens than the implementation they
described — and the corpus couldn't say what actually shipped.

The deeper problem is accuracy: a spec-compliance reviewer checks the diff against the
plan, so a wrong 905-line plan gets faithfully implemented and then certified correct.
More prescriptive detail = more surface for that failure. Detail past step ~3 is
precision without accuracy. The only gate that catches a wrong plan is reality — a
command whose output you did not choose.

The distinction that resolves it: **scope enumeration** (*what* must end up true) is
cheap, durable, and worth being exhaustive about; **implementation prescription** (*how*)
is expensive, decays on contact with the code, and is worth writing only for the slice
you are about to do. Be exhaustive about scope; be just-in-time about implementation.

## Route first

Write a **full plan** only if one of these holds:

- Parallel execution across sessions — independent sessions can't renegotiate an
  interface mid-flight, so contracts must be frozen up front
- The ordering is the hard part (migrations, backfills, teardowns — step N+1 is only
  safe because step N ran; the sequence *is* the design)
- A genuinely novel subsystem with no existing pattern to match
- Irreversible, or it touches money

Otherwise write a **change record**. If unsure, ask the user which case they're in —
one question, then proceed.

## Steps

1. **Investigate before writing.** Lead with the project's code index / knowledge graph
   if one exists. Do not fan out grep/Read to re-derive what an index already has.
2. **Write the four sections** from the template below: Decision, Verification contract,
   Scope ledger, and slice detail for **slice 1 only**. Target 60–90 lines total. Name
   the project's locked invariants explicitly (e.g. "sync code writes mirror tables
   only", "reservations only via the shared helper", "metrics window on the business
   date", "external ids scoped by account", "shared permission helper, never inline
   flag checks").
3. **Verification contract before code.** Every slice names a proof command and its
   expected observable output. A slice with no nameable proof is not understood yet —
   resolve that before writing any slice detail.
4. **Save it** to the project's plans directory as `<YYYY-MM-DD>-<slug>.md`.
5. **Optional, cheap:** second-model review of the Decision section only (the quick
   review agent on ~30 lines) — catches a wrong approach while backing out is still
   free. Do **not** deep-review a long prose plan.
6. **Execute:** 1–3 slices → inline (you keep the project rules and memory loaded;
   subagents don't). 4+ independent slices → dispatch each slice to the matching domain
   specialist agent, briefing each with the slice detail plus the project rules.
7. **Update the scope-ledger line as each slice lands** (`DONE <sha7>`). That line is
   what survives context compaction. Append slices execution reveals; do not append
   prescription for slices you haven't started.
8. **Write slice N+1's detail only after slice N lands** — using what it taught you.
9. **Don't stop at slice boundaries.** A passing proof command *is* the checkpoint —
   update the ledger and keep going. Stop only when a proof fails for a reason that
   indicts the Decision (not the code), the next slice's proof can't be named, an
   invariant turns out not to hold, or the next step is outward-facing/irreversible
   (push, deploy, external-API write, money movement, destructive SQL).

## Template

```markdown
# <change name>
<!-- Decision record + scope ledger + verification contract. Slice detail added JIT. -->

## Decision
**Problem:** <what is broken or missing, in one or two sentences>
**Approach:** <the chosen shape, 2-4 sentences>
**Rejected:**
- <alternative> — <why not>
- <alternative> — <why not>
**Invariants that must hold:** <the locked rules this change must not break>

## Verification contract
| # | Slice | Proof command | Expected observable |
|---|---|---|---|
| 1 | <slice> | `npm run typecheck` | 0 errors |
| 2 | <slice> | `npm run test:unit -- <file>` | <n>/<n> pass |
| 3 | <slice> | read-only DB query | <expected rows> |

## Scope ledger
- [ ] 1. <slice, one line>            TODO
- [ ] 2. <slice, one line>            TODO
- [ ] 3. <slice, one line>            TODO

## Slice detail — <only the current slice>
### Slice 1: <name>
**Files:** <paths>
**Change:** <what to do, exact values that matter>
**Proves it:** <the command from the contract, and its expected output>
```

A slice = one commit-able, independently verifiable behavior change — with a fast
verification loop, usually one sitting. Optimal plan detail is **inversely proportional
to verification speed**: the faster reality can check you, the thinner the plan should be.

## Red flags

| Thought | Reality |
|---|---|
| "Let me spec all 9 slices properly while I have context" | Detail past ~slice 3 is precision without accuracy. It will be wrong and it will be obeyed. |
| "The reviewer will catch it if the plan's wrong" | Spec-compliance review checks the diff against the plan. It cannot catch error *in* the plan. Only a proof command can. |
| "I'll add the verification steps once it works" | Backwards. The contract written first is what constrains the implementation — and what catches a wrong plan. |
| "This is a small fix, no artifact needed" | Then it's a slice, not a plan. Do it inline and skip both. A one-line fix should not trigger a planning pipeline. |
| "Scope list feels redundant with the slice details" | Scope is exhaustive and cheap; prescription is thin and expensive. Different jobs. |
| "Slice 2 passed — I'll check in before starting slice 3" | The proof command already checked in. Continue; report at the end of the ledger, not between its lines. |
