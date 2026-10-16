#!/usr/bin/env node
/**
 * board — every live Claude Code session on this machine (tabs and background sessions alike),
 * grouped by run, with its job, its state, and the question it is waiting on. Answers "which of
 * these sessions needs me?" without opening any of them.
 *
 *   board             all sessions; groups with someone waiting come first
 *   board --waiting   only the sessions waiting on you, each with its question and options
 *   board --json      the same groups as data, for the iTerm2 session panel
 *                     (session-panel/panel.py), which draws them instead of copying this logic
 *
 * Groups: a spawned slice's run (from .spawn-owners.json, written by spawn-claude-sessions), with
 * the session that spawned it listed first; everything else is "<repo> · started by hand".
 * State comes from Claude Code's own registry
 * (~/.claude/sessions): working, waiting (on you), idle, or shell (a `!` command is running).
 * A background session also has agent view's job files: one that ended its turn with a question
 * in plain text (job state "blocked") is waiting, one that finished is done, and its row gets a
 * second line saying where it stands now — flagged when that line is only your own reply echoed
 * back, and with "no update for 15m" when it has read the same for 5+ minutes while working.
 * Orchestrators: `board --waiting` is the quick form of the supervision rule (a waiting slice is
 * blocked on a person — read its question and put it to the person).
 */

import path from 'node:path';
import { liveSessions, describe, pendingQuestion, truncate, jobNow, jobLine, runColour } from './lib/session-info.mjs';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('usage: board [--waiting] [--json]');
  process.exit(0);
}
const waitingOnly = args.includes('--waiting');
const asJson = args.includes('--json');
const tty = process.stdout.isTTY;
const width = process.stdout.columns || 160;
const paint = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);

const STATE = {
  waiting: { word: 'waiting', color: '33;1', rank: 0 },
  busy: { word: 'working', color: '32', rank: 1 },
  shell: { word: 'shell', color: '36', rank: 2 },
  done: { word: 'done', color: '0', rank: 3 },
  idle: { word: 'idle', color: '2', rank: 4 },
};
const stateOf = (s) => STATE[s] || { word: s || '?', color: '2', rank: 5 };

/** A working session whose line has read the same this long gets "no update for …". */
const QUIET_MS = 5 * 60e3;
/** …and this long, it has stalled (the panel's amber), unless it is in a wait that ends by itself. */
const STALLED_MS = 30 * 60e3;

/**
 * The command a session is in, in the panel's words. The repo's shared deploy waiter
 * (scripts/wait-deploy.mjs [commit] [minutes=30]) always exits with an answer by its deadline,
 * so the board knows when it gives up and doesn't call the wait stalled before then.
 */
function commandNow(running) {
  if (!running) return null;
  const wait = /\bwait-deploy\.mjs(?:\s+([^\s;&|-][^\s;&|]*))?(?:\s+(\d+)\b)?/.exec(running.command);
  if (wait) {
    const ref = wait[1] && /^[0-9a-f]{7,40}$/.test(wait[1]) ? wait[1].slice(0, 7) : wait[1];
    return { text: `Waiting on deploy${ref && ref !== 'HEAD' ? ` ${ref}` : ''}`, since: running.since, until: running.since + Number(wait[2] || 30) * 60e3 };
  }
  const text = running.command
    .replace(/^cd\s+\S+\s*&&\s*/, '')
    .replace(/(?<![^\s(])(?:~|\/)(?:[^\s/]+\/)+([^\s/]+)/g, '$1') // a path names its file, as jobNow does
    .replace(/\s+/g, ' ');
  return { text: truncate(text, 90), since: running.since, until: null };
}

function ago(ms) {
  if (!ms) return '';
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}

function repoName(cwd) {
  const m = /^(.*)\/\.claude\/worktrees\//.exec(cwd || '');
  return path.basename(m ? m[1] : cwd || '?');
}

// A slice spawned before runs were recorded (2026-10-01) has no run name, but every slice of one
// spawn shares the same `at` — group by that and name the group by the slices' common prefix.
function groupOf(d, reg) {
  if (d.slice?.spawned) return d.slice.run || `spawned@${d.slice.spawnedAt || '?'}`;
  // The orchestrator sits with the newest run it leads, not with the sessions started by hand.
  if (d.leads.length) return d.leads[d.leads.length - 1].run;
  return `${repoName(reg.cwd)} · started by hand`;
}
function commonPrefix(names) {
  let p = names[0] || '';
  for (const n of names) while (!n.startsWith(p)) p = p.slice(0, -1);
  return p;
}
function groupTitle(key, list) {
  if (!key.startsWith('spawned@')) return key;
  const at = new Date(key.slice('spawned@'.length));
  const sameDay = at.toDateString() === new Date().toDateString();
  const opts = sameDay ? { hour: 'numeric', minute: '2-digit' } : { weekday: 'short', hour: 'numeric', minute: '2-digit' };
  const when = Number.isNaN(at.getTime()) ? '' : ` (spawned ${at.toLocaleString([], opts)})`;
  const names = list.map((r) => r.label);
  const prefix = commonPrefix(names);
  const title = names.length === 1 ? names[0] : prefix.length >= 2 ? `${prefix}…` : names.join(', ');
  return `${title}${when}`;
}

const me = process.env.CLAUDE_CODE_SESSION_ID;
const rows = liveSessions()
  .map((reg) => {
    const d = describe({ sessionId: reg.sessionId, cwd: reg.cwd, registry: reg });
    const group = groupOf(d, reg);
    // The session's own name first, so a renamed slice shows its new name; a slice is spawned under its slice name.
    const label = reg.name || (d.slice?.spawned ? d.slice.slice : d.title) || reg.sessionId.slice(0, 8);
    const job = jobNow(reg, d.transcript);
    const title = d.aiTitle && d.aiTitle.toLowerCase() !== label.toLowerCase() ? d.aiTitle : null;
    const asked = (job?.asked && jobLine(job.asked)) || d.job;
    const about = (d.slice?.spawned ? d.job : [title, asked && `asked: ${asked}`].filter(Boolean).join(' · '))
      || '(nothing asked yet)';
    // The registry knows a session is busy; only the job knows an idle one is asking or finished.
    let status = reg.status;
    if (status !== 'busy' && status !== 'waiting' && job?.state === 'blocked' && job.line) status = 'waiting';
    else if (status === 'idle' && job?.state === 'done') status = 'done';
    let question = reg.status === 'waiting' ? pendingQuestion(d.transcript) : null;
    let now = '';
    let quiet = '';
    let quietMs = 0;
    if (status === 'waiting' && !question?.length && job?.line) question = [{ question: job.line, options: [] }];
    else if (job?.line) {
      now = job.reply ? `on your reply: "${job.line}"` : job.line;
      if ((status === 'busy' || status === 'shell') && job.since && Date.now() - job.since >= QUIET_MS) {
        quiet = ago(job.since);
        quietMs = Date.now() - job.since;
      }
    }
    const echo = !!(job?.reply && now);
    const lead = !d.slice?.spawned && d.leads.length > 0;
    const run = d.slice?.run || (lead ? group : null);
    const busy = status === 'busy' || status === 'shell';
    const command = busy ? commandNow(job?.running) : null;
    const stalled = quietMs >= STALLED_MS && !(command?.until && Date.now() < command.until + 2 * 60e3);
    return { reg, group, run, lead, label, about, question, now, echo, quiet, quietMs, stalled, command, status, st: stateOf(status), mine: reg.sessionId === me };
  })
  .filter((r) => !waitingOnly || r.status === 'waiting');

if (!rows.length) {
  if (asJson) {
    console.log(JSON.stringify({ groups: [] }));
    process.exit(0);
  }
  console.log(waitingOnly ? 'Nobody is waiting on you.' : 'No live Claude sessions.');
  process.exit(0);
}

const groups = new Map();
for (const r of rows) {
  if (!groups.has(r.group)) groups.set(r.group, []);
  groups.get(r.group).push(r);
}
const ordered = [...groups.entries()].sort(([, a], [, b]) => {
  const wa = a.some((r) => r.st.rank === 0) ? 0 : 1;
  const wb = b.some((r) => r.st.rank === 0) ? 0 : 1;
  if (wa !== wb) return wa - wb;
  const la = Math.max(...a.map((r) => r.reg.statusUpdatedAt || 0));
  const lb = Math.max(...b.map((r) => r.reg.statusUpdatedAt || 0));
  return lb - la;
});

for (const [, list] of ordered) list.sort((a, b) => b.lead - a.lead || a.st.rank - b.st.rank || a.label.localeCompare(b.label));

if (asJson) {
  console.log(JSON.stringify({
    groups: ordered.map(([group, list]) => {
      const run = list.find((r) => r.run)?.run || null;
      return {
        title: groupTitle(group, list),
        run,
        colour: run ? runColour(run) : null,
        waiting: list.filter((r) => r.st.rank === 0).length,
        sessions: list.map((r) => ({
          id: r.reg.sessionId,
          // What `claude attach` / `claude stop` take: the short id `claude --bg` printed.
          job: r.reg.jobId || r.reg.sessionId.slice(0, 8),
          kind: r.reg.kind || null,
          cwd: r.reg.cwd || null,
          lead: r.lead,
          state: r.st.word,
          label: r.label,
          mine: r.mine,
          ago: ago(r.reg.statusUpdatedAt),
          at: r.reg.statusUpdatedAt || 0, // when it took this state, so the panel can sort by it
          about: r.about || '',
          now: r.now,
          echo: r.echo, // `now` is only your own reply echoed back
          quiet: r.quiet,
          quietMs: r.quietMs,
          stalled: r.stalled,
          running: r.command, // { text, since, until } — what it is in right now; until = when that gives up, if it says
          questions: (r.question || []).map((q) => ({ question: q.question, options: (q.options || []).map((o) => o.label) })),
        })),
      };
    }),
  }));
  process.exit(0);
}

const shown = (r) => `${r.label}${r.lead ? ' (orchestrator)' : ''}${r.mine ? '*' : ''}`;
const nameW = Math.min(24, Math.max(...rows.map((r) => shown(r).length)));
for (const [group, list] of ordered) {
  const waiting = list.filter((r) => r.st.rank === 0).length;
  const counts = `${list.length} session${list.length === 1 ? '' : 's'}${waiting ? ` · ${waiting} waiting on you` : ''}`;
  console.log(`\n${paint('1', groupTitle(group, list))}  ${paint('2', counts)}`);
  for (const r of list) {
    const state = paint(r.st.color, r.st.word.padEnd(8));
    const name = shown(r).padEnd(nameW);
    const when = ago(r.reg.statusUpdatedAt).padStart(4);
    const room = width - (2 + 8 + 1 + nameW + 1 + 4 + 2);
    console.log(`  ${state} ${name} ${paint('2', when)}  ${truncate(r.about || '', room)}`);
    if (r.now) {
      const quiet = r.quiet ? `no update for ${r.quiet}${r.stalled && r.command ? `, in ${r.command.text}` : ''} · ` : '';
      console.log(`  ${' '.repeat(9)}${paint('2', 'now')} ${paint('33', quiet)}${truncate(r.now, width - 15 - quiet.length)}`);
    }
    for (const q of r.question || []) {
      console.log(`  ${' '.repeat(9)}${paint('33', '?')} ${truncate(q.question, width - 14)}`);
      const opts = (q.options || []).map((o, i) => `${i + 1}) ${o.label}`).join('   ');
      if (opts) console.log(`  ${' '.repeat(11)}${paint('2', truncate(opts, width - 14))}`);
    }
  }
}
if (rows.some((r) => r.mine)) console.log(paint('2', '\n* this session'));
