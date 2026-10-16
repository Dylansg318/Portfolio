/**
 * session-info — what a Claude Code session is, what it was asked, and whether it is waiting
 * on a person, read straight from Claude Code's own files. Shared by session-board.mjs (`board`)
 * and, in the full setup, the status line's job strip and a one-session `brief`.
 *
 *   <config>/sessions/<pid>.json        live registry: pid, sessionId, cwd, name, status
 *                                       (busy | idle | waiting | shell)
 *   <config>/projects/<key>/<id>.jsonl  transcript: the first prompt, custom-title (`-n` /
 *                                       rename), ai-title (Claude's own summary), and every
 *                                       AskUserQuestion call with its answer
 *   <config>/jobs/<jobId>/state.json    a background session's agent-view row: working | blocked
 *     + timeline.jsonl                  | done, and its one line; the timeline dates each update
 *   <repo>/.claude/worktrees/.spawn-owners.json
 *                                       written by spawn-claude-sessions: slice -> run, brief,
 *                                       spawn time, the run's orchestrator (its tab, or
 *                                       `claude:<session id>`), and a background slice's id
 *
 * Why (2026-10-01): with a dozen-plus tabs open, a session's job was only knowable by
 * scrolling back to its first message, and a question arrived with no reminder of the task.
 * Every reader here is best-effort: a missing or half-written file yields nothing, never a throw.
 */

import { readFileSync, readdirSync, existsSync, openSync, readSync, closeSync, fstatSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = os.homedir();
const CACHE_DIR = path.join(os.tmpdir(), 'claude-session-brief');

/**
 * Every Claude Code config home on this machine: ~/.claude, one account profile per folder under
 * ~/.claude-profiles/<name> (a session started under one registers and writes its transcript
 * there), and $CLAUDE_CONFIG_DIR when it points elsewhere.
 */
function configRoots() {
  const roots = [process.env.CLAUDE_CONFIG_DIR, path.join(HOME, '.claude')];
  try {
    for (const d of readdirSync(path.join(HOME, '.claude-profiles'))) roots.push(path.join(HOME, '.claude-profiles', d));
  } catch { /* no profiles */ }
  return [...new Set(roots.filter(Boolean))];
}

// ---------------------------------------------------------------- live registry

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** Every live session Claude Code has registered, dead pids dropped. */
export function liveSessions() {
  const out = [];
  for (const root of configRoots()) {
    const dir = path.join(root, 'sessions');
    let files = [];
    try { files = readdirSync(dir).filter((f) => /^\d+\.json$/.test(f)); } catch { continue; }
    for (const f of files) {
      let s;
      try { s = JSON.parse(readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
      if (s?.pid && s.sessionId && alive(s.pid)) out.push({ ...s, configRoot: root });
    }
  }
  return out;
}

export function findTranscript(sessionId) {
  for (const root of configRoots()) {
    let dirs = [];
    try { dirs = readdirSync(path.join(root, 'projects')); } catch { continue; }
    for (const d of dirs) {
      const p = path.join(root, 'projects', d, `${sessionId}.jsonl`);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

// ---------------------------------------------------------------- transcript reading

/** Whole JSONL lines from the head or the tail of a file, without reading all of it. */
function readLines(file, bytes, fromEnd) {
  let fd;
  try {
    fd = openSync(file, 'r');
    const size = fstatSync(fd).size;
    const len = Math.min(bytes, size);
    const start = fromEnd ? size - len : 0;
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, start);
    const lines = buf.toString('utf8').split('\n');
    if (fromEnd && start > 0) lines.shift();
    if (!fromEnd && start + len < size) lines.pop();
    return lines;
  } catch {
    return [];
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function* records(lines) {
  for (const l of lines) {
    if (!l) continue;
    try { yield JSON.parse(l); } catch { /* partial or foreign line */ }
  }
}

/** The text a person typed, or null for tool results, injected context and command echoes. */
function promptText(rec) {
  if (rec?.type !== 'user' || rec.isMeta || rec.isCompactSummary || rec.toolUseResult) return null;
  const c = rec.message?.content;
  let parts;
  if (typeof c === 'string') parts = [c];
  else if (Array.isArray(c)) {
    if (c.some((b) => b?.type === 'tool_result')) return null;
    parts = c.filter((b) => b?.type === 'text').map((b) => b.text || '');
  } else return null;
  const text = parts
    .map((t) => t.trim())
    .filter((t) => t && !t.startsWith('<') && !t.startsWith('Caveat:') && !t.startsWith('This session is being continued'))
    .join('\n')
    .trim();
  return text || null;
}

/** The first thing the person asked this session — for a spawned slice, its whole brief. */
export function firstPrompt(transcript, sessionId) {
  const cacheFile = sessionId ? path.join(CACHE_DIR, `${sessionId}.json`) : null;
  if (cacheFile) {
    try { return JSON.parse(readFileSync(cacheFile, 'utf8')).firstPrompt; } catch { /* not cached yet */ }
  }
  if (!transcript) return null;
  let found = null;
  for (const bytes of [1 << 20, 16 << 20]) {
    for (const rec of records(readLines(transcript, bytes, false))) {
      found = promptText(rec);
      if (found) break;
    }
    if (found) break;
  }
  if (found && cacheFile) {
    try { mkdirSync(CACHE_DIR, { recursive: true }); writeFileSync(cacheFile, JSON.stringify({ firstPrompt: found })); } catch { /* cache is optional */ }
  }
  return found;
}

/** The session's names: `custom` from `-n`/rename (a slice's name), `ai` from Claude's own summary. */
export function titles(transcript) {
  const out = { custom: null, ai: null };
  if (!transcript) return out;
  for (const lines of [readLines(transcript, 256 << 10, true), readLines(transcript, 1 << 20, false)]) {
    for (const rec of records(lines)) {
      if (rec.type === 'custom-title' && rec.customTitle) out.custom = rec.customTitle;
      if (rec.type === 'ai-title' && rec.aiTitle) out.ai = rec.aiTitle;
    }
    if (out.custom || out.ai) break;
  }
  return out;
}

/** The AskUserQuestion still unanswered at the end of the transcript, or null. */
export function pendingQuestion(transcript) {
  if (!transcript) return null;
  const open = new Map();
  for (const rec of records(readLines(transcript, 1 << 20, true))) {
    const content = rec.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (rec.type === 'assistant' && b?.type === 'tool_use' && b.name === 'AskUserQuestion') open.set(b.id, b.input?.questions || []);
      if (rec.type === 'user' && b?.type === 'tool_result') open.delete(b.tool_use_id);
    }
  }
  const pending = [...open.values()];
  return pending.length ? pending[pending.length - 1] : null;
}

// ---------------------------------------------------------------- background jobs (agent view)

/** The last thing the person typed, scanning back from the end of the transcript's last 1 MB. */
export function lastPrompt(transcript) {
  if (!transcript) return null;
  const lines = readLines(transcript, 1 << 20, true);
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (!l.includes('"type":"user"') || l.includes('"tool_result"')) continue;
    let rec;
    try { rec = JSON.parse(l); } catch { continue; }
    const text = promptText(rec);
    if (text) return text;
  }
  return null;
}

const squash = (s) => clean(s).replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Whether a job's line is only the person's own last message echoed back. Cached per session
 * and line, so the 5 s board poll reads the transcript once per new line, not every time.
 */
function isReplyEcho(sessionId, transcript, line) {
  const cacheFile = sessionId ? path.join(CACHE_DIR, `${sessionId}.echo.json`) : null;
  if (cacheFile) {
    try {
      const c = JSON.parse(readFileSync(cacheFile, 'utf8'));
      if (c.line === line) return c.reply;
    } catch { /* not cached yet */ }
  }
  const said = lastPrompt(transcript);
  const a = said ? squash(said) : '';
  const b = squash(line).replace(/…$/, '');
  const reply = !!a && (a === b || (b.length >= 12 && a.startsWith(b)));
  if (cacheFile) {
    try { mkdirSync(CACHE_DIR, { recursive: true }); writeFileSync(cacheFile, JSON.stringify({ line, reply })); } catch { /* cache is optional */ }
  }
  return reply;
}

/** When a job's current line first appeared: walk its timeline back while the line reads the same. */
function lineSince(timeline, detail) {
  let since = null;
  const lines = readLines(timeline, 256 << 10, true);
  for (let i = lines.length - 1; i >= 0; i--) {
    let e;
    try { e = JSON.parse(lines[i]); } catch { continue; }
    if (!e?.detail) continue; // a blank update between two lines is not a change
    if (e.detail !== detail) break;
    since = Date.parse(e.at) || since;
  }
  return since;
}

/**
 * Where a background session stands, from the files agent view draws its list from:
 * <config>/jobs/<jobId>/state.json (`state` working | blocked | done; `detail`, the row's one
 * line) and timeline.jsonl (every update, so how long the line has read the same). A line only
 * changes when the session writes a sentence, so a session running commands for 15 minutes
 * keeps an old one. `reply`: the line is the person's own last message — agent view shows a
 * reply as the row's line until the session next writes one (2026-10-14: a row read "go ahead
 * with 1", the person's own words, as if the session had said them). Null for a tab session, which has no job files.
 */
export function jobNow(registry, transcript) {
  if (!registry?.jobId) return null;
  const dir = path.join(registry.configRoot || path.join(HOME, '.claude'), 'jobs', registry.jobId);
  let st;
  try { st = JSON.parse(readFileSync(path.join(dir, 'state.json'), 'utf8')); } catch { return null; }
  const raw = String(st.detail || '').replace(/\s+/g, ' ').replace(/^[-•*]\s+/, '').trim();
  // A raw tool step ("Reading /private/tmp/…/reference.md") names the file, not its whole path.
  const line = raw.replace(/(?<![^\s(])(?:~|\/)(?:[^\s/]+\/)+([^\s/]+)/g, '$1');
  return {
    // What the session was dispatched with: the transcript's first prompt can be a later "go ahead"
    // after a resume, or missing; agent view keeps the original ask here.
    asked: st.intent || st.displayIntent || null,
    state: st.state || null,
    line,
    since: raw ? lineSince(path.join(dir, 'timeline.jsonl'), st.detail) : null,
    reply: raw ? isReplyEcho(registry.sessionId, transcript, raw) : false,
    running: newestCommand(st.fan),
  };
}

/** The command a session started last and is still in, from agent view's list of what is running. */
function newestCommand(fan) {
  const cmds = (fan || []).filter((f) => f.kind === 'shell' && f.label && f.startedAt);
  if (!cmds.length) return null;
  const f = cmds.reduce((a, b) => (b.startedAt > a.startedAt ? b : a));
  return { command: f.label, since: f.startedAt };
}

// ---------------------------------------------------------------- spawned runs

function spawnBook(repo) {
  try { return JSON.parse(readFileSync(path.join(repo, '.claude', 'worktrees', '.spawn-owners.json'), 'utf8')) || {}; } catch { return {}; }
}

/** A gap this long between two spawns under one run name starts a new run. */
const RUN_GAP_MS = 6 * 3600e3;

/**
 * Every run in the spawn book, each its slices in spawn order. A run is one run name from one
 * spawning tab: a later phase or a relaunched slice joins it, the same name reused days later
 * starts a new one.
 */
function runsOf(book) {
  const groups = new Map();
  for (const [slice, rec] of Object.entries(book)) {
    if (!rec?.run) continue;
    const key = `${rec.run}\0${rec.owner || ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ slice, run: rec.run, owner: rec.owner || null, t: Date.parse(rec.at) || 0 });
  }
  const runs = [];
  for (const list of groups.values()) {
    list.sort((a, b) => a.t - b.t || a.slice.localeCompare(b.slice));
    let cur = [];
    for (const r of list) {
      if (cur.length && r.t - cur[cur.length - 1].t > RUN_GAP_MS) { runs.push(cur); cur = []; }
      cur.push(r);
    }
    if (cur.length) runs.push(cur);
  }
  return runs;
}

/**
 * For a session inside a spawned slice's worktree: its slice, run and brief file, and where it
 * sits in its run (`index` of `of`, in spawn order — the status bar's "2/13").
 */
export function sliceOf(cwd) {
  const m = /^(.*)\/\.claude\/worktrees\/([^/]+)/.exec(cwd || '');
  if (!m) return null;
  const [, repo, slice] = m;
  const book = spawnBook(repo);
  const rec = book[slice] || null;
  const run = rec ? runsOf(book).find((r) => r.some((s) => s.slice === slice)) : null;
  return {
    repo, slice, spawned: !!rec, run: rec?.run || null, promptFile: rec?.promptFile || null, spawnedAt: rec?.at || null,
    index: run ? run.findIndex((s) => s.slice === slice) + 1 : null,
    of: run ? run.length : null,
  };
}

/** The repo whose spawn book covers `cwd`: the checkout above a worktree, else the nearest folder that has one. */
function repoOf(cwd) {
  const m = /^(.*)\/\.claude\/worktrees\/[^/]+/.exec(cwd || '');
  if (m) return m[1];
  for (let d = cwd; d && d !== path.dirname(d); d = path.dirname(d)) {
    if (existsSync(path.join(d, '.claude', 'worktrees', '.spawn-owners.json'))) return d;
  }
  return null;
}

/**
 * The runs a session is leading, oldest first: `[{ run, of }]`. `owners` are the ids the spawner may
 * have recorded for it as each slice's owner: its iTerm2 tab's GUID, and `claude:<session id>` for a
 * run spawned from a background session, which has no tab (2026-10-06). A run counts while any of
 * its slices' worktrees is still there, so a finished, reaped run drops off.
 */
export function orchestratorOf(cwd, owners) {
  const ids = (Array.isArray(owners) ? owners : [owners]).filter(Boolean);
  const repo = ids.length && repoOf(cwd);
  if (!repo) return [];
  return runsOf(spawnBook(repo))
    .filter((r) => ids.includes(r[0].owner) && r.some((s) => existsSync(path.join(repo, '.claude', 'worktrees', s.slice))))
    .sort((a, b) => a[a.length - 1].t - b[b.length - 1].t)
    .map((r) => ({ run: r[0].run, of: r.length }));
}

/**
 * The tab colour the spawner gives a run — the same palette and hash as runColour in
 * spawn-claude-sessions.mjs; change both together.
 */
const RUN_COLOURS = [
  [52, 101, 164], [78, 154, 6], [196, 160, 0], [117, 80, 123],
  [206, 92, 0], [6, 152, 154], [164, 0, 0], [143, 89, 2],
];
export function runColour(run) {
  let h = 0;
  for (const ch of String(run || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return RUN_COLOURS[h % RUN_COLOURS.length];
}

// ---------------------------------------------------------------- text shaping

const ATTACH_EXT = '(?:png|jpe?g|gif|webp|heic|heif|avif|tiff?|bmp|pdf)';
// A dropped or pasted file: quoted (may hold spaces), or a bare absolute / ~ path with 2+ slashes
// (`\ ` escapes allowed) that starts a word — so the path inside a URL is left alone.
const BARE = String.raw`(?:\\ |[^\s"'\]])`;
const ATTACHMENT = new RegExp(
  String.raw`"([^"\n]+\.${ATTACH_EXT})"|'([^'\n]+\.${ATTACH_EXT})'|(?<![^\s(])((?:~|/)(?:${BARE}+/)+${BARE}+\.${ATTACH_EXT})(?![\w.])`,
  'gi',
);
const PLURAL = { screenshot: 'screenshots', photo: 'photos', PDF: 'PDFs' };
function attachmentKind(p) {
  if (/\.pdf$/i.test(p)) return 'PDF';
  return /(?:^|\/)pasted-[^/]*$|screen ?shot/i.test(p) ? 'screenshot' : 'photo';
}

/**
 * Drop the placeholders Claude Code leaves where images and pastes were, and say what a dropped
 * file was instead of its path: a background session records a pasted screenshot as
 * `/Users/…/jobs/<id>/tmp/pasted-….png`, which used to fill the whole "asked" line (2026-10-14).
 */
export function clean(text) {
  return String(text || '')
    .replace(/\[Image #\d+\]/g, '')
    .replace(/\[Image: [^\]]*\]/g, '')
    .replace(/\[Pasted text #\d+[^\]]*\]/g, '')
    .replace(ATTACHMENT, (m, a, b, c) => `\u0001${attachmentKind(a || b || c)}\u0002`)
    .replace(/(?:\u0001\w+\u0002[ \t]*)+/g, (run) => {
      const counts = new Map();
      for (const [, kind] of run.matchAll(/\u0001(\w+)\u0002/g)) counts.set(kind, (counts.get(kind) || 0) + 1);
      const words = [...counts].map(([kind, n]) => (n === 1 ? kind : `${n} ${PLURAL[kind]}`));
      return `(${words.join(', ')}) `;
    })
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * One line saying what was asked: a brief's `Job:` line when it has one, then a `Goal:` (briefs
 * written before the Job line, e.g. "Slice: dr-floor. Goal: the floor's scoreboards …"), else
 * the opening line without markdown heading marks.
 */
export function jobLine(text) {
  const lines = clean(text).split('\n').map((l) => l.trim()).filter(Boolean);
  for (const key of ['job', 'goal']) {
    const re = new RegExp(`(?:^|\\.\\s+)${key}:\\s*(.+)$`, 'i');
    for (const l of lines) {
      const m = re.exec(l);
      if (m) return m[1].trim();
    }
  }
  return (lines[0] || '').replace(/^#+\s*/, '').replace(/`/g, '');
}

export function truncate(s, width) {
  if (!s || width <= 0) return '';
  return s.length > width ? `${s.slice(0, Math.max(0, width - 1))}…` : s;
}

// ---------------------------------------------------------------- one call for the scripts

/**
 * `tab`: the session's own iTerm2 GUID, when the caller runs inside it. With the session id it fills
 * `leads` (orchestratorOf) — a background orchestrator is found by its session id alone.
 */
export function describe({ sessionId, transcript, cwd, registry, tab }) {
  const file = transcript || (sessionId ? findTranscript(sessionId) : null);
  const t = titles(file);
  const slice = sliceOf(cwd || registry?.cwd);
  const prompt = firstPrompt(file, sessionId);
  return {
    sessionId,
    transcript: file,
    name: registry?.name || t.custom || null,
    title: t.custom || t.ai || null,
    aiTitle: t.ai,
    slice,
    leads: !slice?.spawned ? orchestratorOf(cwd || registry?.cwd, [tab, sessionId && `claude:${sessionId}`]) : [],
    prompt,
    job: jobLine(prompt),
    status: registry?.status || null,
  };
}
