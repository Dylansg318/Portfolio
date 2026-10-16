/**
 * background-sessions — what the spawner and reaper share about background slices: the launch
 * argv, reading what `claude --bg` and `claude agents --json` print, and who a run belongs to.
 *
 * WHY: slices start as background sessions by default (2026-10-06): each is a real Claude session
 * in its own worktree, started with `--bg` and watched in agent view, with iTerm2 tabs (`--tabs`)
 * for when you want to watch one live. Agent view lists every session working / waiting / done in
 * one place. Measured with Claude Code 2.1.291 the same day:
 *   - `claude --bg -w <slice> -n <slice> … "<prompt>"` from the main checkout enters the worktree the
 *     spawner made and prints `backgrounded · <id> · <name>` — in colour even into a pipe.
 *   - the session does NOT inherit the spawner's environment (it starts from Claude's background
 *     service). Its process is `claude bg-spare …` with no tty and no `-w` in its argv, so a reaper
 *     that looks for tabs never sees it.
 *   - `claude agents --json [--all]` lists `{ pid, id, cwd, kind: 'background', sessionId, name,
 *     status: 'busy'|'idle', state: 'working'|'done'|… }`; a name need not match the slice, so a
 *     slice is matched by its recorded id or its worktree.
 *   - `claude rm <id>` on a live session stops it and removes its worktree and local branch; the
 *     transcript stays on disk. Once it left the worktree's git admin folder behind, so the reaper
 *     runs `git worktree prune` after it.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

/** The argv after the claude binary for one background slice. The prompt is one argument, no shell. */
export function launchArgv({ name, prompt, skipPermissions = false }) {
  return ['--bg', '-w', name, '-n', name, ...(skipPermissions ? ['--dangerously-skip-permissions'] : []), prompt];
}

/** `backgrounded · <id> · <name>` → { id, name }, or null when the launch printed something else. */
export function parseBackgrounded(stdout) {
  const m = /backgrounded\s+·\s+(\S+)\s+·\s+(.+)/.exec(String(stdout || '').replace(ANSI, ''));
  return m ? { id: m[1], name: m[2].trim() } : null;
}

/** `claude agents --json` output → its background sessions. Throws on anything that isn't the list. */
export function parseAgents(raw) {
  const text = String(raw || '').replace(ANSI, '');
  const list = JSON.parse(text.slice(text.indexOf('[')));
  if (!Array.isArray(list)) throw new Error('claude agents --json did not return a list');
  return list.filter((a) => a && a.kind === 'background' && a.id);
}

/**
 * Every background session (`--all`: exited ones too). A machine with no claude binary has none;
 * any other failure throws — a list that could not be read is not an empty one.
 */
export function listBackground(claudeBin, { all = false } = {}) {
  let raw;
  try {
    raw = execFileSync(claudeBin, ['agents', '--json', ...(all ? ['--all'] : [])], {
      encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000,
    });
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw new Error(`could not list background sessions (claude agents: ${String(e.stderr || e.message || e).trim().split('\n').pop()})`);
  }
  return parseAgents(raw);
}

/** The background session working in `dir` (its own folder or one below it), or the one with `id`. */
export function agentIn(agents, dir, id) {
  const root = path.resolve(dir);
  return agents.find((a) => id && a.id === id)
    || agents.find((a) => { const c = path.resolve(a.cwd || '/'); return c === root || c.startsWith(`${root}${path.sep}`); })
    || null;
}

// WHO A RUN BELONGS TO. The iTerm2 tab that spawned it when there is one (what the status bar's
// "orchestrator of N" chip has always keyed on), else the Claude session the spawner runs under,
// as `claude:<session id>` — a background orchestrator has no tab, and recorded 'unknown' until
// 2026-10-06.
export function ownerId({ itermSessionId, claudeSessionId }) {
  const tab = String(itermSessionId || '').split(':').pop();
  if (tab) return tab;
  return claudeSessionId ? `claude:${claudeSessionId}` : 'unknown';
}
