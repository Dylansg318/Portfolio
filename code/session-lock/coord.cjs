#!/usr/bin/env node
// Hook dispatcher + CLI for cross-session coordination. See lib/coord-core.cjs for the
// primitives and the incident that motivated them, and DESIGN.md for the operator-facing
// writeup.
//
//   Hook mode:  node coord.cjs <event>   (reads hook JSON on stdin)
//   CLI  mode:  node coord.cjs who|locks|say|owner|unlock|doctor
//
// HARD RULE: a coordination layer must never break the session it coordinates. Every hook
// path is wrapped so an unexpected throw exits 0 (allow) rather than wedging a tool call.
// The only non-zero exit is a deliberate, explained block.

const C = require("./lib/coord-core.cjs");

const EVENT = process.argv[2] || "";
const CLI = ["who", "locks", "say", "owner", "unlock", "doctor", "inbox", "gc"];

function readStdin() {
  return new Promise((res) => {
    let raw = "";
    if (process.stdin.isTTY) return res({});
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => {
      try { res(JSON.parse(raw)); } catch { res({}); }
    });
    setTimeout(() => res({}), 4000).unref();
  });
}

// PreToolUse/UserPromptSubmit deliver this straight into the model's context.
function context(event, text) {
  if (!text) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: event, additionalContext: text },
  }));
}

function block(msg) {
  process.stderr.write(msg);
  process.exit(2);
}

function describe(s, selfCwd) {
  const where = s.worktree === selfCwd ? "THIS checkout" : s.worktree.replace(process.env.HOME, "~");
  return `${C.short(s.id)} on ${s.branch} — ${where}`;
}

/* ------------------------------------------------------------------- handlers */

function onSessionStart(d, base) {
  const cwd = d.cwd || process.cwd();
  C.register(base, { id: d.session_id, cwd });
  C.seedCursor(base, d.session_id); // don't replay the backlog to a new session

  const peers = C.sessions(base, { excludeId: d.session_id });
  const held = C.locks(base).filter((l) => l.owner !== d.session_id);
  if (!peers.length && !held.length) return;

  const lines = [];
  const same = peers.filter((p) => p.worktree === (C.sh(["rev-parse", "--show-toplevel"], cwd) || cwd));
  lines.push(`Session coordination: ${peers.length} other live agent session(s) on this repo.`);
  for (const p of peers) lines.push(`  · ${describe(p, cwd)}`);
  if (same.length) {
    lines.push(
      `WARNING: ${same.length} of them share THIS checkout, so the git index and working ` +
      `tree are shared. Stage and commit by explicit path only, and expect your git calls ` +
      `to queue behind theirs.`
    );
  }
  if (held.length) {
    lines.push("Locks currently held by others:");
    for (const l of held) lines.push(`  · ${l.resource} — ${C.short(l.owner)}, ${C.ago(l.acquired)}${l.reason ? ` (${l.reason})` : ""}`);
  }
  lines.push(`Post a finding for the others with: node coord.cjs say "..."`);
  context("SessionStart", lines.join("\n"));
}

function onPreBash(d, base) {
  const cmd = (d.tool_input && (d.tool_input.command || "")) || "";
  const cwd = d.cwd || process.cwd();
  const ops = C.gitOps(cmd);
  if (!ops.length) return;

  const notes = [];

  // --- index ops: the real critical section -------------------------------------
  if (ops.some((o) => o.kind === "index")) {
    const res = C.indexKey(cwd);
    if (res) {
      const sub = ops.find((o) => o.kind === "index").sub;
      const got = C.acquire(base, res, { id: d.session_id, cwd, reason: `git ${sub}` });
      if (!got.ok) {
        const h = got.held;
        block(
          `BLOCKED: another agent session holds the git index lock for this checkout.\n` +
          `  holder: ${C.short(h.owner)}  doing: ${h.reason || "git work"}  since: ${C.ago(h.acquired)}\n` +
          `  you:    git ${sub}\n\n` +
          `This checkout's index is shared. Running now risks sweeping their staged files into ` +
          `your commit, or losing yours to theirs — the exact failure this layer exists to stop.\n` +
          `Wait and retry; the lock auto-expires after 5 minutes or when they finish. Check with:\n` +
          `  node coord.cjs locks\n` +
          `If you are certain the holder is gone: node coord.cjs unlock ${res}`
        );
      }
    }
  }

  // --- push: serialize, and protect the deploy debounce ---------------------------
  if (ops.some((o) => o.kind === "push")) {
    const res = C.pushTarget(cmd);
    const got = C.acquire(base, res, { id: d.session_id, cwd, reason: "git push" });
    if (!got.ok) {
      const h = got.held;
      block(
        `BLOCKED: another agent session is pushing to the same target.\n` +
        `  holder: ${C.short(h.owner)}  since: ${C.ago(h.acquired)}  resource: ${res}\n\n` +
        `Pushing now will either be rejected non-fast-forward, or land inside their deploy ` +
        `pipeline's build debounce and cancel their deploy. Wait for them to finish, then pull and retry.`
      );
    }
    const lp = C.lastPush(base);
    if (lp && lp.id !== d.session_id && Date.now() - lp.ts < C.PUSH_DEBOUNCE_MS) {
      notes.push(
        `Heads up: session ${C.short(lp.id)} pushed ${C.ago(lp.ts)} — inside the deploy pipeline's ` +
        `60s build debounce. Pushing now may cancel their in-flight deploy. ` +
        `Not blocking; consider waiting ~${Math.ceil((C.PUSH_DEBOUNCE_MS - (Date.now() - lp.ts)) / 1000)}s.`
      );
    }
  }

  if (notes.length) context("PreToolUse", notes.join("\n"));
}

function onPostBash(d, base) {
  const cmd = (d.tool_input && (d.tool_input.command || "")) || "";
  const cwd = d.cwd || process.cwd();
  const ops = C.gitOps(cmd);
  if (!ops.length) return;

  const failed = Boolean(d.tool_error);
  const subs = ops.map((o) => o.sub);

  if (subs.includes("commit") && !failed) {
    const line = C.sh(["log", "-1", "--format=%h %s"], cwd);
    const files = C.sh(["show", "--name-only", "--format=", "HEAD"], cwd)
      .split("\n").filter(Boolean);
    if (line) {
      C.say(base, {
        id: d.session_id, cwd, kind: "commit",
        text: `committed ${line}` + (files.length ? ` — ${files.length} file(s): ${files.slice(0, 6).join(", ")}${files.length > 6 ? ", …" : ""}` : ""),
      });
    }
  }

  if (subs.includes("push") && !failed) {
    const br = C.sh(["branch", "--show-current"], cwd);
    const head = C.sh(["log", "-1", "--format=%h %s"], cwd);
    C.say(base, { id: d.session_id, cwd, kind: "push", text: `pushed ${br} → ${head}` });
    C.release(base, C.pushTarget(cmd), d.session_id);
  }
  if (subs.includes("push") && failed) C.release(base, C.pushTarget(cmd), d.session_id);

  // Release the index lock once the index is quiet again. Holding it open across a bare
  // `git add` is deliberate: that is exactly the window where staged files get stolen.
  if (ops.some((o) => o.kind === "index")) {
    const res = C.indexKey(cwd);
    if (res && (staged(cwd) === false || failed)) C.release(base, res, d.session_id);
  }
  C.touch(base, d.session_id, {});
}

// true = staged changes present, false = clean index, null = unknown.
function staged(cwd) {
  try {
    require("child_process").execFileSync("git", ["diff", "--cached", "--quiet"], {
      cwd, stdio: "ignore", timeout: 5000,
    });
    return false;
  } catch (e) {
    return e.status === 1 ? true : null;
  }
}

function onPreEdit(d, base) {
  const f = (d.tool_input && (d.tool_input.file_path || d.tool_input.notebook_path)) || "";
  if (!f) return;
  const cwd = d.cwd || process.cwd();
  const others = C.authorsOf(base, f, cwd).filter((a) => a.id !== d.session_id);
  if (!others.length) return;

  const live = new Set(C.sessions(base).map((s) => s.id));
  const top = C.sh(["rev-parse", "--show-toplevel"], cwd) || cwd;
  const notes = [];
  for (const a of others.slice(0, 3)) {
    const sameTree = (C.sh(["rev-parse", "--show-toplevel"], a.cwd) || a.cwd) === top;
    if (live.has(a.id) && sameTree) {
      notes.push(
        `CONFLICT RISK: live session ${C.short(a.id)} edited this same file in THIS checkout ` +
        `${C.ago(a.ts)}. You share a working tree — your write may clobber unsaved-to-git work. ` +
        `Re-read the file before editing, and commit by explicit path.`
      );
    } else if (live.has(a.id)) {
      notes.push(
        `Note: live session ${C.short(a.id)} edited this file ${C.ago(a.ts)} in a different ` +
        `worktree (${a.cwd.replace(process.env.HOME, "~")}). Not an immediate clobber, but a ` +
        `merge conflict on the integration branch is likely. Consider coordinating via coord.cjs say.`
      );
    }
  }
  if (notes.length) context("PreToolUse", notes.join("\n"));
}

function onPostEdit(d, base) {
  const f = (d.tool_input && (d.tool_input.file_path || d.tool_input.notebook_path)) || "";
  if (!f || d.tool_error) return;
  C.recordFile(base, { id: d.session_id, cwd: d.cwd || process.cwd(), file: f, tool: d.tool_name });
}

function onStop(d, base) {
  const cwd = d.cwd || process.cwd();
  C.touch(base, d.session_id, {});
  // Turn is over. Drop the index lock unless files are still staged — that half-finished
  // add-without-commit state is precisely what needs protecting until the commit lands.
  const res = C.indexKey(cwd);
  if (res) {
    const s = staged(cwd);
    if (s === false) C.release(base, res, d.session_id);
    else if (s === true) {
      process.stdout.write(
        `⚠  Holding the git index lock — you have staged but uncommitted files. ` +
        `Other sessions in this checkout are blocked from git until you commit or reset.\n`
      );
    }
  }
}

function onSessionEnd(d, base) {
  C.releaseAllFor(base, d.session_id);
  C.unregister(base, d.session_id);
  // Retention sweep piggybacks on exits (hourly-stamped inside): aged broadcasts and
  // authorship, orphaned cursors. Notes are for active collaboration, not an archive.
  C.gc(base);
}

function onPrompt(d, base) {
  // Deliver peer broadcasts into the turn. This is the half MCP tools cannot do reliably:
  // the message lands whether or not the model thought to go looking for it.
  const msgs = C.unread(base, d.session_id);
  if (!msgs.length) return;
  const lines = msgs.slice(-12).map((m) => `  · [${C.short(m.id)}, ${C.ago(m.ts)}] ${m.kind}: ${m.text}`);
  context("UserPromptSubmit",
    `Since your last turn, other agent sessions on this repo reported:\n${lines.join("\n")}\n` +
    `If any of it touches what you are doing (same files, same branch, a push you were about ` +
    `to make), account for it before acting.`
  );
}

/* ------------------------------------------------------------------------ CLI */

function cli(cmd, args) {
  const cwd = process.cwd();
  const base = C.root(cwd);
  if (!base) { console.error("not a git repo"); process.exit(1); }
  C.ensure(base);

  if (cmd === "who") {
    const all = C.sessions(base);
    if (!all.length) return console.log("No live agent sessions registered on this repo.");
    console.log(`${all.length} live session(s):`);
    for (const s of all) {
      console.log(`  ${C.short(s.id)}  ${s.branch.padEnd(28)} ${s.worktree.replace(process.env.HOME, "~")}`);
      console.log(`           started ${C.ago(s.started)}, seen ${C.ago(s.last_seen)}, ${(s.files || []).length} file(s) touched`);
    }
    return;
  }
  if (cmd === "locks") {
    const l = C.locks(base);
    if (!l.length) return console.log("No locks held.");
    for (const x of l) console.log(`  ${x.resource}\n    owner ${C.short(x.owner)} · ${C.ago(x.acquired)} · ${x.reason || "-"} · pid ${x.pid}`);
    return;
  }
  if (cmd === "unlock") {
    const r = args[0];
    if (!r) { console.error("usage: unlock <resource>"); process.exit(1); }
    console.log(C.release(base, r, null) ? `released ${r}` : `no such lock: ${r}`);
    return;
  }
  if (cmd === "say") {
    const text = args.join(" ").trim();
    if (!text) { console.error('usage: say "your finding"'); process.exit(1); }
    C.say(base, { id: process.env.CLAUDE_SESSION_ID || `cli-${process.pid}`, cwd, text, kind: "note" });
    console.log(`broadcast to ${C.sessions(base).length} live session(s)`);
    return;
  }
  if (cmd === "inbox") {
    const all = C.allBroadcasts(base).slice(-20);
    if (!all.length) return console.log("No broadcasts.");
    for (const m of all) console.log(`  [${C.short(m.id)}, ${C.ago(m.ts)}] ${m.kind}: ${m.text}`);
    return;
  }
  if (cmd === "owner") {
    const f = args[0];
    if (!f) { console.error("usage: owner <file>"); process.exit(1); }
    const a = C.authorsOf(base, f, cwd);
    if (!a.length) return console.log(`No agent session on record for ${f}.`);
    for (const x of a) console.log(`  ${C.short(x.id)}  ${C.ago(x.ts)}  via ${x.tool}  in ${x.cwd.replace(process.env.HOME, "~")}`);
    return;
  }
  if (cmd === "gc") {
    const r = C.gc(base, { force: true });
    console.log(`pruned: ${r.cursors} orphan cursor(s), ${r.broadcasts} aged broadcast(s), ${r.authors} aged authorship line(s)`);
    return;
  }
  if (cmd === "doctor") {
    const cp = C.findClaudePid();
    console.log(`host pid  : ${cp || "UNRESOLVED — falling back to heartbeat-only liveness"}`);
    if (cp) {
      try {
        const l = require("child_process")
          .execFileSync("ps", ["-o", "command=", "-p", String(cp)], { encoding: "utf8" })
          .trim();
        console.log(`            ${l.slice(0, 90)}`);
      } catch {}
    }
    console.log(`state dir : ${base}`);
    console.log(`repo key  : ${C.repoKey(cwd)}`);
    console.log(`index key : ${C.indexKey(cwd)}`);
    console.log(`disabled  : ${C.DISABLED}`);
    console.log(`sessions  : ${C.sessions(base).length} live`);
    console.log(`locks     : ${C.locks(base).length} held`);
    console.log(`broadcasts: ${C.allBroadcasts(base).length}`);
    return;
  }
}

/* ----------------------------------------------------------------------- main */

(async () => {
  if (CLI.includes(EVENT)) {
    try { cli(EVENT, process.argv.slice(3)); } catch (e) { console.error(e.message); process.exit(1); }
    return;
  }

  const d = await readStdin();
  if (C.DISABLED || !d.session_id) return;

  let base;
  try {
    base = C.root(d.cwd || process.cwd());
    if (!base) return;
    C.ensure(base);
  } catch { return; }

  try {
    switch (EVENT) {
      case "session-start": onSessionStart(d, base); break;
      case "pre-bash":      onPreBash(d, base); break;
      case "post-bash":     onPostBash(d, base); break;
      case "pre-edit":      onPreEdit(d, base); break;
      case "post-edit":     onPostEdit(d, base); break;
      case "stop":          onStop(d, base); break;
      case "session-end":   onSessionEnd(d, base); break;
      case "prompt":        onPrompt(d, base); break;
    }
  } catch (e) {
    // Never wedge the session over a coordination bug. Surface it and allow.
    if (process.env.COORD_DEBUG) process.stderr.write(`coord ${EVENT} error: ${e.stack}\n`);
  }
})();
