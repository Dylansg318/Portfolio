#!/usr/bin/env node
// Cross-session coordination primitives for parallel AI coding-agent sessions on one repo.
//
// WHY THIS EXISTS
// The source checkout routinely had 5-8 agent sessions live at once plus ~40 git worktrees,
// all feeding one shared integration branch. Sessions have no native awareness of each
// other, which produced a documented, expensive failure: one session spent 24 minutes
// discovering by accident that another was mid-`git commit` in the same checkout, then
// found its own staged files "exposed to being swept into their commit" — because the git
// index is shared per-checkout while `git add` and `git commit` are two separate tool calls
// with a gap in between.
//
// DESIGN NOTES (each one is load-bearing; read before changing)
//   * The critical section is the INDEX, not the push. Keyed on `git rev-parse --git-path
//     index`, so two sessions in the SAME checkout contend and two different worktrees do
//     not — which is the true sharing boundary. Keying on the repo would serialize 40
//     worktrees that never actually collide.
//   * Locks are files created with O_EXCL (`flag: 'wx'`), which is atomic on POSIX. No
//     daemon, no SQLite, no dependency.
//   * Every lock carries a PID and a TTL. A holder that crashed is detected via
//     `process.kill(pid, 0)` and stolen from; a holder that hung expires. A coordination
//     layer that can deadlock the thing it coordinates is worse than none.
//   * Reentrant by session_id: re-acquiring a lock you already hold refreshes it.
//   * State lives under ~/.claude/ keyed by the git common dir, NOT in the repo — the whole
//     point is visibility ACROSS worktrees, and each worktree has its own checkout.
//   * Set COORD_OFF=1 to disable every guard without editing settings.json.

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const DISABLED = process.env.COORD_OFF === "1";

// How long a lock stays valid without a heartbeat. The index TTL spans a full
// add -> commit sequence (two tool calls plus the model's thinking between them).
const TTL = { index: 300_000, push: 180_000, default: 120_000 };

// The deploy pipeline debounces builds for 60s; two pushes inside that window cancel each
// other's deploy. Warn, never block — sometimes you do mean it.
const PUSH_DEBOUNCE_MS = 60_000;

const MAX_BROADCASTS = 500;

// Retention. Broadcasts and authorship exist so ACTIVE sessions can coordinate; they are
// not an archive. Without these bounds the state dir rots — measured in production: 9.0MB /
// 26,686 lines of authors.jsonl (parsed in FULL by every pre-edit hook), 980 orphaned
// cursor files, broadcasts held only by the count cap. gc() enforces them from session-end.
const MAX_BROADCAST_AGE_MS = 48 * 60 * 60 * 1000; // notes outlive a working day, not a week
const MAX_AUTHOR_AGE_MS = 7 * 24 * 60 * 60 * 1000; // authorship archaeology window
const MAX_AUTHOR_LINES = 5000;
const ORPHAN_CURSOR_AGE_MS = 24 * 60 * 60 * 1000; // live cursors are rewritten every prompt
const GC_INTERVAL_MS = 60 * 60 * 1000; // simultaneous exits shouldn't all rewrite the files

function sh(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd: cwd || process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim();
  } catch {
    return "";
  }
}

function sha(s) {
  return crypto.createHash("sha1").update(s).digest("hex").slice(0, 16);
}

// All worktrees of one repo resolve to the same common dir, so it is the natural repo key.
// It comes back relative from the main checkout and absolute from a worktree - resolve both.
function repoKey(cwd) {
  const common = sh(["rev-parse", "--git-common-dir"], cwd);
  if (!common) return null;
  const abs = path.resolve(cwd, common);
  try {
    return sha(fs.realpathSync(abs));
  } catch {
    return sha(abs);
  }
}

// Per-worktree: main checkout -> .git/index, worktree -> .git/worktrees/<n>/index.
// This is the real boundary for "can we clobber each other's staged files".
function indexKey(cwd) {
  const p = sh(["rev-parse", "--git-path", "index"], cwd);
  if (!p) return null;
  return "index:" + sha(path.resolve(cwd, p));
}

function root(cwd) {
  const key = repoKey(cwd);
  if (!key) return null;
  return path.join(os.homedir(), ".claude", "session-coord", key);
}

function ensure(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

// Write-temp-then-rename: rename is atomic, so a reader never sees a half-written file.
function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM"; // exists but owned by another user
  }
}

// A hook is a short-lived process: by the time anyone reads the lock it wrote, its own pid
// is long gone and naive liveness would reap every lock the instant it was taken. The
// meaningful pid is the agent host process that OWNS the session, so walk the ancestor
// chain once at SessionStart and cache it on the session record.
// Match the host process by its EXECUTABLE, never by a substring of the command
// line. Substring matching ("does the command mention claude") is wrong here: every hook
// runs from a path under .claude/, so a loose test matches the hook itself, resolves to a
// process that exits milliseconds later, and every lock gets reaped the instant it is
// taken — silently turning the whole layer into a no-op.
function isClaudeHost(cmd) {
  const tokens = cmd.trim().split(/\s+/);
  const base = (tokens[0] || "").split("/").pop();
  if (/^claude$/i.test(base)) return true;                 // /Users/x/.local/bin/claude
  if (/^Claude( Helper)?/.test(base)) return true;         // desktop app bundle
  if (/^(node|bun|deno)$/i.test(base)) {                   // npm-shim: node .../bin/claude
    const script = tokens.slice(1).find((t) => !t.startsWith("-"));
    if (script && /\/claude(\.[cm]?js)?$/.test(script)) return true;
  }
  return false;
}

function findClaudePid(startPid = process.pid) {
  let pid = startPid;
  for (let i = 0; i < 12 && pid && pid > 1; i++) {
    let line = "";
    try {
      line = execFileSync("ps", ["-o", "ppid=,command=", "-p", String(pid)], {
        encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000,
      }).trim();
    } catch {
      return null;
    }
    if (!line) return null;
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!m) return null;
    const [, ppid, cmd] = m;
    if (isClaudeHost(cmd)) return pid;
    pid = Number(ppid);
  }
  return null;
}

// Presence heartbeat ceiling. Only used when the host pid could not be resolved, so a
// registry entry can still age out instead of lingering forever.
const HEARTBEAT_MAX = 8 * 60 * 60 * 1000;

function sessionLive(rec) {
  if (!rec) return false;
  if (rec.claude_pid) return alive(rec.claude_pid);
  return Date.now() - (rec.last_seen || 0) < HEARTBEAT_MAX;
}

function short(id) {
  return String(id || "").slice(0, 8);
}

/* ------------------------------------------------------------------ presence */

function sessionFile(base, id) {
  return path.join(ensure(path.join(base, "sessions")), `${id}.json`);
}

function register(base, { id, cwd, pid }) {
  const file = sessionFile(base, id);
  const prev = readJson(file, {});
  const rec = {
    id,
    // Resolved once here — walking `ps` on every hook fire would be far too expensive.
    claude_pid: pid || prev.claude_pid || findClaudePid(),
    cwd,
    branch: sh(["branch", "--show-current"], cwd) || "(detached)",
    // A worktree's path is its identity; the main checkout shows as the repo root.
    worktree: sh(["rev-parse", "--show-toplevel"], cwd) || cwd,
    started: prev.started || Date.now(),
    last_seen: Date.now(),
    files: prev.files || [],
  };
  writeJson(file, rec);
  return rec;
}

function touch(base, id, patch = {}) {
  const file = sessionFile(base, id);
  const rec = readJson(file);
  if (!rec) return null;
  Object.assign(rec, patch, { last_seen: Date.now() });
  writeJson(file, rec);
  return rec;
}

// Live = process still running. Dead session files are reaped here so the registry
// self-heals after crashes, force-quits, and reboots without any cleanup daemon.
function sessions(base, { excludeId } = {}) {
  const dir = path.join(base, "sessions");
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const n of names) {
    if (!n.endsWith(".json")) continue;
    const file = path.join(dir, n);
    const rec = readJson(file);
    if (!rec) continue;
    if (!sessionLive(rec)) {
      try { fs.unlinkSync(file); } catch {}
      continue;
    }
    if (excludeId && rec.id === excludeId) continue;
    out.push(rec);
  }
  return out.sort((a, b) => a.started - b.started);
}

function unregister(base, id) {
  try { fs.unlinkSync(sessionFile(base, id)); } catch {}
  // A session takes its broadcast cursor with it — cursors were the one per-session file
  // clean exits left behind (980 orphans by the time this landed).
  try { fs.unlinkSync(cursorFile(base, id)); } catch {}
}

/* --------------------------------------------------------------------- locks */

function lockFile(base, resource) {
  return path.join(ensure(path.join(base, "locks")), `${sha(resource)}.json`);
}

function ttlFor(resource) {
  if (resource.startsWith("index:")) return TTL.index;
  if (resource.startsWith("push:")) return TTL.push;
  return TTL.default;
}

// A lock is valid only while BOTH hold: the owning session is still alive, and the lock has
// not aged past its TTL. Either alone is insufficient — a crashed session must not hold the
// index forever, and a live-but-wedged session must not either.
function readLock(base, resource) {
  const file = lockFile(base, resource);
  const rec = readJson(file);
  if (!rec) return null;
  const expired = Date.now() - (rec.renewed || rec.acquired) > ttlFor(resource);
  const ownerRec = readJson(sessionFile(base, rec.owner));
  const ownerGone = ownerRec ? !sessionLive(ownerRec) : false; // no record yet != dead
  if (expired || ownerGone) {
    try { fs.unlinkSync(file); } catch {}
    return null;
  }
  return rec;
}

// Returns {ok:true, rec} or {ok:false, held} — never throws, never waits.
// Callers decide whether a refusal blocks a tool call or just prints a note.
function acquire(base, resource, { id, cwd, reason }) {
  const file = lockFile(base, resource);
  const held = readLock(base, resource);
  if (held && held.owner !== id) return { ok: false, held };

  const rec = {
    resource,
    owner: id,
    pid: process.pid,
    cwd,
    reason: reason || "",
    acquired: held && held.owner === id ? held.acquired : Date.now(),
    renewed: Date.now(),
  };
  if (held && held.owner === id) {
    writeJson(file, rec); // reentrant refresh
    return { ok: true, rec, reentrant: true };
  }
  try {
    // O_EXCL: atomic create-or-fail. This is the actual mutual exclusion.
    fs.writeFileSync(file, JSON.stringify(rec), { flag: "wx" });
    return { ok: true, rec };
  } catch {
    const now = readLock(base, resource);
    if (!now) return acquire(base, resource, { id, cwd, reason }); // raced with a reap
    if (now.owner === id) return { ok: true, rec: now, reentrant: true };
    return { ok: false, held: now };
  }
}

function release(base, resource, id) {
  const rec = readJson(lockFile(base, resource));
  if (!rec) return false;
  if (id && rec.owner !== id) return false; // never release someone else's lock
  try { fs.unlinkSync(lockFile(base, resource)); return true; } catch { return false; }
}

function locks(base) {
  const dir = path.join(base, "locks");
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names
    .map((n) => readJson(path.join(dir, n)))
    .filter((r) => r && readLock(base, r.resource));
}

function releaseAllFor(base, id) {
  let n = 0;
  for (const l of locks(base)) if (l.owner === id && release(base, l.resource, id)) n++;
  return n;
}

/* ---------------------------------------------------------------- broadcasts */

function broadcastFile(base) {
  return path.join(ensure(base), "broadcasts.jsonl");
}

// O_APPEND writes under PIPE_BUF are atomic on POSIX, so concurrent appends interleave
// cleanly by line without a lock. Keep entries small for that guarantee to hold.
function say(base, { id, cwd, text, kind = "note" }) {
  const rec = { ts: Date.now(), id, kind, cwd, text: String(text).slice(0, 1500) };
  fs.appendFileSync(broadcastFile(base), JSON.stringify(rec) + "\n");
  return rec;
}

function allBroadcasts(base) {
  let raw = "";
  try { raw = fs.readFileSync(broadcastFile(base), "utf8"); } catch { return []; }
  const lines = raw.split("\n").filter(Boolean);
  if (lines.length > MAX_BROADCASTS) {
    const keep = lines.slice(-MAX_BROADCASTS);
    try { fs.writeFileSync(broadcastFile(base), keep.join("\n") + "\n"); } catch {}
    return keep.map((l) => readJsonLine(l)).filter(Boolean);
  }
  return lines.map((l) => readJsonLine(l)).filter(Boolean);
}

function readJsonLine(l) {
  try { return JSON.parse(l); } catch { return null; }
}

function cursorFile(base, id) {
  return path.join(ensure(path.join(base, "cursors")), `${id}.json`);
}

// Unread = posted by someone else since this session's cursor. Cursor advances only when
// the caller actually delivers the messages, so nothing is silently dropped.
function unread(base, id, { advance = true } = {}) {
  const cur = readJson(cursorFile(base, id), { ts: 0 });
  const all = allBroadcasts(base);
  const mine = all.filter((b) => b.ts > cur.ts && b.id !== id);
  if (advance && all.length) {
    writeJson(cursorFile(base, id), { ts: all[all.length - 1].ts });
  }
  return mine;
}

// A session joining late should not be dumped the entire day's backlog.
function seedCursor(base, id) {
  const all = allBroadcasts(base);
  writeJson(cursorFile(base, id), { ts: all.length ? all[all.length - 1].ts : 0 });
}

function lastPush(base) {
  const all = allBroadcasts(base);
  for (let i = all.length - 1; i >= 0; i--) if (all[i].kind === "push") return all[i];
  return null;
}

/* ------------------------------------------------------------ file ownership */

// The incident session had to date untracked files by mtime to guess which of them belonged
// to another session ("43 files frozen at noon five days ago versus everything from 14:21
// today"). Recording authorship as it happens replaces that archaeology with a lookup.

function authorsFile(base) {
  return path.join(ensure(base), "authors.jsonl");
}

function recordFile(base, { id, cwd, file, tool }) {
  if (!file) return;
  const rel = relTo(cwd, file);
  fs.appendFileSync(
    authorsFile(base),
    JSON.stringify({ ts: Date.now(), id, cwd, file: rel, abs: file, tool }) + "\n"
  );
  const s = readJson(sessionFile(base, id));
  if (s) {
    s.files = Array.from(new Set([...(s.files || []), rel])).slice(-300);
    s.last_seen = Date.now();
    writeJson(sessionFile(base, id), s);
  }
}

function relTo(cwd, file) {
  try {
    const top = sh(["rev-parse", "--show-toplevel"], cwd) || cwd;
    return path.relative(top, path.resolve(cwd, file)) || file;
  } catch {
    return file;
  }
}

function authorsOf(base, file, cwd) {
  const rel = relTo(cwd, file);
  let raw = "";
  try { raw = fs.readFileSync(authorsFile(base), "utf8"); } catch { return []; }
  const hits = raw
    .split("\n")
    .filter(Boolean)
    .map(readJsonLine)
    .filter((r) => r && (r.file === rel || r.abs === path.resolve(cwd, file)));
  const seen = new Map();
  for (const h of hits) seen.set(h.id, h); // last write per session
  return [...seen.values()].sort((a, b) => b.ts - a.ts);
}

/* ------------------------------------------------------------------------ gc */

// Retention sweep. Sessions and locks self-reap on read; the append-only files and
// per-session cursors do not — this is their bound. Runs from session-end behind an hourly
// stamp (force:true for the CLI). The read-filter-rewrite races a concurrent append the
// same way allBroadcasts' count-cap trim always has: a lost line is a note, not a lock,
// and the window is milliseconds at session exit.
function gc(base, { force = false } = {}) {
  const stamp = path.join(ensure(base), "gc.stamp");
  if (!force) {
    try {
      if (Date.now() - fs.statSync(stamp).mtimeMs < GC_INTERVAL_MS) return null;
    } catch {}
  }
  try { fs.writeFileSync(stamp, String(Date.now())); } catch {}
  const now = Date.now();
  const out = { cursors: 0, broadcasts: 0, authors: 0 };

  // Cursors whose session is gone. sessions() reaps dead session records as it reads, so
  // "not live" is authoritative; the mtime slack covers a session between register and
  // its first prompt.
  const live = new Set(sessions(base).map((s) => s.id));
  try {
    const dir = path.join(base, "cursors");
    for (const n of fs.readdirSync(dir)) {
      if (!n.endsWith(".json")) continue;
      if (live.has(n.slice(0, -5))) continue;
      const file = path.join(dir, n);
      try {
        if (now - fs.statSync(file).mtimeMs > ORPHAN_CURSOR_AGE_MS) {
          fs.unlinkSync(file);
          out.cursors++;
        }
      } catch {}
    }
  } catch {}

  const trimByAge = (file, maxAge, maxLines) => {
    let raw = "";
    try { raw = fs.readFileSync(file, "utf8"); } catch { return 0; }
    const lines = raw.split("\n").filter(Boolean);
    let keep = lines.filter((l) => {
      const r = readJsonLine(l);
      return r && now - r.ts <= maxAge;
    });
    if (maxLines && keep.length > maxLines) keep = keep.slice(-maxLines);
    if (keep.length === lines.length) return 0;
    try {
      fs.writeFileSync(file, keep.length ? keep.join("\n") + "\n" : "");
      return lines.length - keep.length;
    } catch { return 0; }
  };

  out.broadcasts = trimByAge(broadcastFile(base), MAX_BROADCAST_AGE_MS, MAX_BROADCASTS);
  out.authors = trimByAge(authorsFile(base), MAX_AUTHOR_AGE_MS, MAX_AUTHOR_LINES);
  return out;
}

/* ------------------------------------------------------- git command parsing */

// Read-only porcelain: never touches the index, so never worth a lock.
const READ_ONLY = new Set([
  "status", "log", "diff", "show", "rev-parse", "rev-list", "ls-files", "ls-tree",
  "cat-file", "blame", "describe", "shortlog", "name-rev", "reflog", "grep",
  "config", "remote", "fetch", "whatchanged", "count-objects", "check-ignore", "var",
]);

// Take the index (or HEAD) — these are the ones that can eat another session's staged work.
const INDEX_OPS = new Set([
  "add", "rm", "mv", "commit", "stash", "merge", "rebase", "cherry-pick", "revert",
  "checkout", "switch", "restore", "reset", "apply", "am", "pull", "clean",
]);

// Find git invocations at a command boundary (start, or after ; && || | newline), which
// keeps `grep "git commit" file` from registering as a commit. A stray false positive is
// cheap — it takes a lock that PostToolUse releases moments later — but a false BLOCK is
// not, and blocks only fire when another live session genuinely holds the lock.
function gitOps(cmd) {
  if (!cmd) return [];
  const out = [];
  const re = /(?:^|[;&|\n]|\|\||&&)\s*(?:sudo\s+)?git\s+((?:-[cC]\s+\S+\s+|--\S+\s+)*)([a-z-]+)/g;
  let m;
  while ((m = re.exec(cmd))) {
    const sub = m[2];
    if (READ_ONLY.has(sub)) { out.push({ sub, kind: "read" }); continue; }
    if (sub === "push") { out.push({ sub, kind: "push" }); continue; }
    if (sub === "worktree") { out.push({ sub, kind: "read" }); continue; }
    if (INDEX_OPS.has(sub)) { out.push({ sub, kind: "index" }); continue; }
    out.push({ sub, kind: "other" });
  }
  return out;
}

// `git branch` is read-only when listing but mutating with -d/-D/-m/-M.
function pushTarget(cmd) {
  const m = /git\s+push\s+(?:--?\S+\s+)*(\S+)?\s*(\S+)?/.exec(cmd || "");
  const remote = (m && m[1]) || "origin";
  const branch = (m && m[2]) || "";
  return `push:${remote}/${branch || "HEAD"}`;
}

function ago(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const mnt = Math.round(s / 60);
  if (mnt < 60) return `${mnt}m ago`;
  return `${Math.round(mnt / 60)}h ago`;
}

module.exports = {
  DISABLED, TTL, PUSH_DEBOUNCE_MS,
  sh, sha, root, ensure, readJson, writeJson, alive, short, ago,
  findClaudePid, sessionLive, isClaudeHost,
  repoKey, indexKey, relTo,
  register, touch, sessions, unregister, sessionFile,
  acquire, release, readLock, locks, releaseAllFor,
  say, unread, seedCursor, allBroadcasts, lastPush,
  recordFile, authorsOf, gc,
  gitOps, pushTarget,
};
