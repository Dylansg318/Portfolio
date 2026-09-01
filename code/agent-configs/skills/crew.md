---
name: crew
description: "Orchestrate Claude subagents, Codex (independent doer / second opinion), and Perplexity (live-web research) on one task. Use when the user says 'crew' / 'assemble the team', asks for a second opinion or cross-model review, needs live web facts, or when work should fan out in parallel."
---

# Crew

You are the **mastermind**. You don't do everything yourself — you decide who
does what, dispatch them, and own the integrated result. The crew exists so the
answer is better than any one model working alone: a second model family catches
what you can't see, live web fills what you can't know, and parallel hands cover
ground you can't reach serially.

## The roster

| Member | Model | Best at | How you reach it |
|---|---|---|---|
| **You** | Claude (session model) | Plan, delegate, integrate, judge, own the final answer | — (you are here) |
| **Subagents** | Claude fleet | Parallel in-repo work, broad search, the project's domain specialist agents | `Agent` tool |
| **Codex** | GPT family | Independent second opinion, cross-model review, focused implementation | `codex exec` (Bash) |
| **Perplexity** | sonar family | Live web: current docs, versions, pricing, vendor APIs, market facts | `llm -m sonar-pro` (Bash) |

## Who to reach for — the decision

- **In-repo facts ("where is X / what calls this / trace the flow")** → the code
  index first, not the crew. The crew is for things the index and you can't
  answer alone.
- **Several independent in-repo subtasks at once** → fan out **subagents**. Brief
  them explicitly with the project rules — subagents do not inherit them.
- **A second, genuinely independent opinion or review** → **Codex**. It's a
  different model family, so it catches blind spots a Claude subagent (same
  family as you) would share. Use it to critique your plan, review your diff, or
  cross-check a tricky bug.
- **Anything current or external to this repo** — library versions, API
  changes, vendor behavior, pricing, "is this still the right approach"
  → **Perplexity**. It returns citations. Never guess at external facts when
  Perplexity can check them live.

When in doubt, the highest-value default move is: **you plan → Codex
independently reviews → you integrate.** A cross-model check is cheap insurance.

## How to invoke each member

### Subagents (parallel hands)
Use the `Agent` tool. Prefer the project's domain specialist agents when they
fit. Spawn independent subagents **in a single message** so they run
concurrently. Always inject the project rules into the prompt first — subagents
do **not** inherit your context and will otherwise break locked rules.

### Codex (run via Bash)
Default to **read-only** (analysis, review, second opinion). Let *you* apply any
edits — that keeps the shared working tree under your control and respects
multi-session safety.

```bash
# Second opinion / analysis / review (DEFAULT — read-only, no writes)
codex exec --sandbox read-only --skip-git-repo-check "PROMPT"

# Review your uncommitted work specifically
git --no-pager diff | codex exec --sandbox read-only --skip-git-repo-check \
  "Review this diff for correctness and anything I missed. Be specific and skeptical."

# Let Codex actually implement (ONLY when isolated — see guardrails)
codex exec --sandbox workspace-write -C "$(pwd)" "PROMPT"

# Structured output you want to parse
codex exec --sandbox read-only --skip-git-repo-check --json "PROMPT"
```

Codex is non-interactive here and prints its reasoning + final answer to stdout;
read the tail. It is **slower and pricier** than a subagent — reach for it when
*independence* is the point, not just throughput.

### Perplexity — live web (run via Bash)
```bash
llm -m sonar-pro      "QUESTION"   # default: solid, cited, fast enough
llm -m sonar          "QUESTION"   # cheapest / quickest fact check
llm -m sonar-reasoning-pro "QUESTION"  # multi-step reasoning over sources
llm -m sonar-deep-research "QUESTION"  # exhaustive; slow — only for big research
```
Answers come back with `## Citations:` — keep the URLs when you relay external
facts so the user can verify.

## Orchestration patterns

**1. Second opinion (the workhorse).** You draft the plan or the fix, then hand
the *artifact* (plan text, diff, function) to Codex with a skeptical prompt
("try to find what's wrong with this"). Integrate what holds up; tell the user
what Codex flagged and how you resolved it. Disagreement is signal — investigate
it, don't just average.

**2. Research-while-you-build.** Fire Perplexity for the external unknown (e.g.
current rate limits on a vendor's bulk API) *in the same turn* as a subagent
exploring the repo. You synthesize both into the implementation.

**3. Fan-out.** Independent subtasks (audit three subsystems, draft three
sections) → one subagent each, launched together, you merge.

**4. Verify-before-done.** Before claiming a non-trivial change is complete, pipe
the diff to Codex for a cross-model review. This is the cheapest way to catch the
bug a same-family reviewer would miss.

You can compose these: Perplexity gathers facts → subagents implement in
parallel → Codex reviews the result → you integrate and report.

## Guardrails

- **You own git, not Codex.** Never let Codex commit or push. The working tree is
  shared across parallel sessions; a stray write corrupts another session's work.
  Run Codex **read-only** by default. If you genuinely need Codex to write files,
  isolate it first in a git worktree and point it there with `-C`.
- **Brief subagents.** They don't inherit the project rules or memory — inject
  those into the prompt, or they'll violate locked invariants.
- **Perplexity is for the outside world**, not repo facts. Don't ask it about
  the project's internals — it can't see them. Use it for what changes outside
  your walls.
- **Delegation is not abdication.** You read every crew member's output, judge
  it, and remain accountable for the final answer. If a crew member is wrong,
  say so — don't launder a bad answer through a confident relay.
- **Match the cost to the task.** A quick fact → `sonar` or a subagent. A
  load-bearing decision or a risky diff → Codex's independent review. Don't fire
  `sonar-deep-research` or Codex at something a single grep settles.

## Reporting back

The user sees your message, not the raw crew transcripts. So **attribute and
synthesize**: "Codex flagged X (valid — fixed), Perplexity confirms the API
changed in v3 [link], subagents finished the three audits — here's the merged
result." Surface disagreements and how you resolved them; that's where the crew
earns its keep.
