#!/usr/bin/env node
/**
 * rebuild-memory-index.mjs — regenerate MEMORY.md from each memory file's frontmatter.
 *
 * WHY: MEMORY.md is loaded into context every session. When its entries are hand-written
 * AND the files carry their own frontmatter `description`, the two drift and the index
 * bloats past the harness truncation limit, silently dropping its own tail.
 * Making MEMORY.md a GENERATED artifact (single source of truth = frontmatter) kills that
 * whole class of drift/bloat and lets a nightly job keep it lean with zero LLM cost.
 *
 * USAGE:
 *   node rebuild-memory-index.mjs            # check mode: report drift, exit 1 if stale/over-budget
 *   node rebuild-memory-index.mjs --write    # rewrite MEMORY.md from frontmatter
 *
 * Portable: derives the per-user memory dir from $HOME + the repo path, so any teammate
 * can run it against their own ~/.claude memory store.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const WRITE = process.argv.includes('--write');
const DESC_CAP = 200;          // hard cap per index hook (harness wants ~200 chars/line)
const FILE_LINE_CAP = 60;      // topic file soft cap; over → flagged, not failed

// The REAL cap, from https://code.claude.com/docs/en/memory: MEMORY.md loads
// "the first 200 lines … or the first 25KB, whichever comes first", and content
// past that "is not loaded at session start" — silently. It is the only memory
// surface that truncates at all (CLAUDE.md is "loaded in full regardless of
// length"). Both budgets below sit under the real cap so a run of new memories
// can't cross it between two maintenance passes.
//
// WHICHEVER COMES FIRST is the part this script used to miss: it enforced bytes
// only, so the index could sail past 200 lines with bytes well inside budget and
// silently drop its tail. In one measured incident the index sat at 24,862 B /
// 188 lines — 138 bytes and 12 ENTRIES from the wall — and a description-trim
// pass bought 3 KB of byte headroom while moving the line count not at all.
// Lines are one per memory, so only MERGING or DELETING entries buys line headroom.
const MEMORY_BYTE_BUDGET = 22000; // real cap 25000
const MEMORY_LINE_BUDGET = 180;   // real cap 200

// repo root = env override, or cwd when run ad hoc
const repoRoot = resolve(process.env.CONTEXT_REPO || process.cwd());
const encoded = repoRoot.replace(/\//g, '-');
const MEM_DIR = process.env.CLAUDE_MEMORY_DIR
  || join(homedir(), '.claude', 'projects', encoded, 'memory');

if (!existsSync(MEM_DIR)) {
  console.error(`[memory-index] no memory dir at ${MEM_DIR} — nothing to do (expected in CI; this maintains a per-user store).`);
  process.exit(0);
}

// --- tolerant frontmatter parse (handles both `metadata:` block and flat formats; no yaml dep) ---
function parseFrontmatter(text) {
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  const fm = text.slice(3, end);
  const out = {};
  let inMeta = false;
  for (const raw of fm.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const indented = /^\s+\S/.test(raw);
    const m = line.match(/^\s*([A-Za-z_]+):\s*(.*)$/);
    if (!m) continue;
    const [, key, valRaw] = m;
    let val = valRaw.trim().replace(/^["']|["']$/g, '');
    if (key === 'metadata' && val === '') { inMeta = true; continue; }
    if (inMeta && !indented) inMeta = false;
    if (key === 'type' && (inMeta || !out.type)) out.type = val;
    else if (!inMeta && key in { name: 1, description: 1, section: 1 }) out[key] = val;
    else if (key === 'section') out.section = val;
  }
  return out;
}

// section ordering + default section per type
const SECTION_ORDER = ['Profile', 'How to work', 'Finance', 'Infra', 'Operations', 'Tooling', 'External APIs'];
const SECTION_TITLES = {
  'Profile': 'Profile',
  'How to work': 'How to work (feedback rules)',
  'Finance': 'Finance state (project)',
  'Infra': 'Infra (project)',
  'Operations': 'Operations state (project)',
  'Tooling': 'Tooling (reference)',
  'External APIs': 'External APIs (reference)',
};
const DEFAULT_SECTION = { user: 'Profile', feedback: 'How to work', project: 'Operations', reference: 'External APIs' };

const files = readdirSync(MEM_DIR).filter(f => f.endsWith('.md') && f !== 'MEMORY.md').sort();
const entries = [];
const warnings = [];
for (const f of files) {
  const fm = parseFrontmatter(readFileSync(join(MEM_DIR, f), 'utf8'));
  if (!fm || !fm.description) { warnings.push(`MISSING-FRONTMATTER: ${f}`); continue; }
  let desc = fm.description.replace(/\s+/g, ' ').trim();
  if (desc.length > DESC_CAP) { warnings.push(`OVER-CAP(${desc.length}): ${f}`); desc = desc.slice(0, DESC_CAP - 1) + '…'; }
  const lines = readFileSync(join(MEM_DIR, f), 'utf8').split('\n').length;
  if (lines > FILE_LINE_CAP) warnings.push(`LARGE-FILE(${lines} lines): ${f}`);
  const section = fm.section && SECTION_TITLES[fm.section] ? fm.section : (DEFAULT_SECTION[fm.type] || 'Operations');
  const title = fm.name || f.replace(/\.md$/, '');
  entries.push({ f, title, desc, section });
}

let md = '# Memory Index\n\n<!-- GENERATED by rebuild-memory-index.mjs from each file\'s frontmatter `description`.\n     Do NOT hand-edit entries — edit the memory file\'s frontmatter, then rerun with --write. -->\n';
for (const sec of SECTION_ORDER) {
  const items = entries.filter(e => e.section === sec);
  if (!items.length) continue;
  md += `\n## ${SECTION_TITLES[sec]}\n\n`;
  // Description IS the link text (it's the recall signal); the `name` title was
  // redundant with it and cost ~30 bytes/line × ~190 entries — dropping it keeps
  // the index well under the harness truncation budget losslessly. Sanitize any
  // [] in the description so it can't break the markdown link.
  for (const e of items) {
    const text = e.desc.replace(/\[/g, '(').replace(/\]/g, ')');
    md += `- [${text}](${e.f})\n`;
  }
}

const target = join(MEM_DIR, 'MEMORY.md');
const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
const bytes = Buffer.byteLength(md, 'utf8');
const lineCount = md.split('\n').length;

console.log(`[memory-index] ${entries.length} entries, ${bytes} bytes (budget ${MEMORY_BYTE_BUDGET}), ${lineCount} lines (budget ${MEMORY_LINE_BUDGET}).`);
if (warnings.length) { console.log('[memory-index] warnings:'); for (const w of warnings) console.log('  - ' + w); }
if (bytes > MEMORY_BYTE_BUDGET) console.log(`[memory-index] ⚠ index exceeds byte budget by ${bytes - MEMORY_BYTE_BUDGET} — tighten the longest frontmatter descriptions.`);
// Deliberately a DIFFERENT instruction from the byte one: shortening hooks does
// nothing here. One entry is one line, so the only fixes are merge and delete.
if (lineCount > MEMORY_LINE_BUDGET) console.log(`[memory-index] ⚠ index exceeds line budget by ${lineCount - MEMORY_LINE_BUDGET} — MERGE related memories or drop stale ones; trimming descriptions will NOT help.`);

if (WRITE) {
  writeFileSync(target, md);
  console.log(`[memory-index] wrote ${target}`);
  process.exit(0);
}
const drift = current.trim() !== md.trim();
if (drift) console.log('[memory-index] DRIFT: MEMORY.md is out of date — run with --write.');
process.exit(drift || warnings.some(w => w.startsWith('OVER-CAP') || w.startsWith('MISSING'))
  || bytes > MEMORY_BYTE_BUDGET || lineCount > MEMORY_LINE_BUDGET ? 1 : 0);
