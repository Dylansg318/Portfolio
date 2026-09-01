#!/usr/bin/env node
// UserPromptSubmit hook. Two jobs, both pure-Node so they work on Windows (no jq):
//
//   1. "start"          -> nudge the model to invoke the project's refresh-context skill.
//   2. planning-shaped  -> re-assert the project's planning rule (a lightweight change
//                          record, NOT a heavyweight plan-writing skill).
//
// Why (2) exists as a hook rather than prose: a bundled skill pack injected at
// SessionStart says "IF A SKILL APPLIES TO YOUR TASK, YOU DO NOT HAVE A CHOICE" and routes
// planning to its brainstorming -> plan-writing pipeline. The project rules outrank skills,
// but they are loaded once at the top of the session while the skill text arrives every
// session as an EXTREMELY_IMPORTANT block. Re-stating the rule on the actual planning turn
// is what makes it win.

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  let prompt = "";
  try {
    prompt = (JSON.parse(raw).prompt || "").trim();
  } catch {
    return;
  }
  const lower = prompt.toLowerCase();

  const emit = (additionalContext) => {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext },
    }));
  };

  if (lower === "start") {
    return emit(
      'User typed "start". Invoke the refresh-context skill now via the Skill tool to reload ' +
      "the project rules and memory files before responding."
    );
  }

  // Already talking about change records -> the rule is not at risk, stay quiet.
  if (/\bchange[- ]record\b/.test(lower)) return;

  // Reviewing/auditing an EXISTING plan is not a request to write one. Without this,
  // "review this implementation plan" fires the write-a-plan directive. Plan review is
  // common in this repo (second-model pass before executing), so this bail matters.
  if (/\b(?:review|audit|critique|verify|check|read|summar[iy])\w*\b/.test(lower)) return;

  // Planning-shaped asks. Deliberately narrow: these are the phrasings that route into
  // the skill pack's brainstorming / plan-writing skills.
  const PLANNING = [
    /\b(?:write|draft|create|make|build|put together)\s+(?:me\s+)?(?:up\s+)?an?\s+(?:implementation\s+)?plan\b/,
    /\bplan\s+(?:this|it|that|out)\b/,
    /\bplan\s+(?:the|a|an)\s+\w+/,
    /\bspec\s+(?:this|it|that)\s*(?:out)?\b/,
    /\bdesign\s+(?:this|it|the|a|an)\b/,
    /\bbrainstorm\b/,
    /\bbreak\s+(?:this|it|that)\s+(?:down|into)\b/,
    /\bimplementation\s+plan\b/,
    /\bwhat'?s\s+the\s+(?:best\s+)?approach\b/,
    // "how should we" alone is ordinary Q&A ("how should I test this?"). Only treat it as
    // planning when it's about building/changing something.
    /\bhow\s+should\s+(?:we|i)\s+(?:\w+\s+){0,3}?(?:build|implement|structure|architect|design|approach|model|migrate|refactor|roll\s*out|ship)\b/,
  ];
  if (!PLANNING.some((re) => re.test(lower))) return;

  emit(
    "This request looks planning-shaped. IF the outcome of this turn is a planning artifact, " +
    "the project's planning rule applies and OVERRIDES the bundled skills. (If it isn't — " +
    "you're answering a question, reviewing existing work, or just making the change — ignore " +
    "this entirely.)\n" +
    "The planning artifact for this repo is a CHANGE RECORD: decision + scope ledger + " +
    "verification contract + just-in-time slice detail, ~60-90 lines. Invoke the " +
    "`change-record` skill (or `discovery` first if the idea still needs shaping).\n" +
    "Do NOT invoke the bundled plan-writing or brainstorming skills here, even though their " +
    "injected text claims you have no choice. The project rules outrank skills.\n" +
    "Write a FULL plan only for the documented exception cases: parallel sessions, " +
    "ordering-critical migrations/backfills/teardowns, a genuinely novel subsystem, or " +
    "irreversible/money changes. If you believe this is such a case, say so explicitly and " +
    "name which one before writing a plan."
  );
});
