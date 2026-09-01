#!/usr/bin/env node
/**
 * check-claude-context.mjs — lint the COMMITTED, cross-user context surface so it
 * stays lean for every developer (CLAUDE.md is loaded into every session).
 *
 * Runs anywhere (including CI — it only reads repo files, never the per-user memory).
 *
 *   node check-claude-context.mjs           # report; exit 1 on any violation
 *   node check-claude-context.mjs --warn    # report only; always exit 0
 *
 * Checks:
 *  1. CLAUDE.md line budget (it's loaded every session for everyone).
 *  2. CLAUDE.md must NOT point to `memory/*.md` — those are per-user (~/.claude) files
 *     teammates don't have; cross-user rules must stay self-contained or point to docs/claude.
 *  3. Flag NEW oversized files in docs/claude/ root (curated rules should stay readable;
 *     known-large living references and the archive/ folder are exempt).
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const WARN_ONLY = process.argv.includes('--warn');
const repo = resolve(process.env.CONTEXT_REPO || process.cwd());

// CLAUDE.md NEVER truncates — the docs are explicit that it is "loaded in full
// regardless of length" (code.claude.com/docs/en/memory). Unlike MEMORY.md's
// 200-line/25KB cap this is not a capacity limit at all; it is an ADHERENCE
// limit. Anthropic's own number is "target under 200 lines per CLAUDE.md file",
// and their failure mode is blunt: "Bloated CLAUDE.md files cause Claude to
// ignore your actual instructions." So this budget is house style with a real
// reason behind it, not a cliff — 180 keeps 20 lines of margin under Anthropic's
// target. The old value was 140, chosen only because a past trim happened to
// land at ~122, which made the lint fire at sizes Anthropic considers fine.
// When it does fire, the fix that actually helps is moving an area-specific
// section into .claude/rules/ with `paths:` frontmatter (loads only when Claude
// opens a matching file) — NOT @imports, which still load in full at launch.
const CLAUDE_MD_LINE_BUDGET = 180;
// THE TEST for exemption (adopted after this lint fired on four docs at once):
// a *parked one-off audit* — written once, about a moment, never consulted again — is what
// the flag is for, and it belongs in docs/claude/archive/. A *living area-state record*
// that grows one dated rule-section at a time is legitimately large, and hatcheting one to
// make CI green destroys the institutional memory CLAUDE.md sends every session to read.
// Exempt those, with the reason, rather than trimming them.
const DOCS_LINE_FLAG = 1200;             // flag curated docs over this (reference dumps exempted below)
const DOCS_EXEMPT = new Set([            // legitimately large living references (examples)
  'changelog.md',            // append-only history; read via dated pointers, never in full
  'schema-inventory.md',     // generated table/column reference dump
  'vendor-api.md',           // captured external API reference
  'codebase-map.md',         // whole-repo layout reference
  // Append-one-dated-rule-at-a-time state records:
  'claims-ledger.md',        // policy requires it hold EVERY settled claim WITH its
                             // evidence, and "refute in place, never delete"
  'accounting-integration.md', // dozens of dated, still-operative integration rule sections
  'mapping-center.md',       // consolidation target — absorbed several former one-off docs
  'inventory-state.md',      // dated rule sections (allocation, reservations, ledger guards)
]);

const problems = [];
const notes = [];

// 1 + 2: CLAUDE.md
const claudeMd = join(repo, 'CLAUDE.md');
if (existsSync(claudeMd)) {
  const txt = readFileSync(claudeMd, 'utf8');
  const lines = txt.split('\n').length;
  notes.push(`CLAUDE.md: ${lines} lines (budget ${CLAUDE_MD_LINE_BUDGET})`);
  if (lines > CLAUDE_MD_LINE_BUDGET)
    problems.push(`CLAUDE.md is ${lines} lines (> ${CLAUDE_MD_LINE_BUDGET}). Trim narrative to rule + docs/claude pointer.`);
  // ban per-user memory pointers (teammates don't have ~/.claude/.../memory).
  // Lookbehind excludes repo paths like `scripts/memory/README.md` — only bare `memory/x.md`.
  const memRefs = [...txt.matchAll(/(?<![\w/])memory\/[A-Za-z0-9_]+\.md/g)].map(m => m[0]);
  if (memRefs.length)
    problems.push(`CLAUDE.md points to per-user memory files (teammates can't resolve these): ${[...new Set(memRefs)].join(', ')}. Inline the rule or point to docs/claude/.`);
} else {
  problems.push('CLAUDE.md not found.');
}

// 3: oversized curated docs in docs/claude root
const docsDir = join(repo, 'docs', 'claude');
if (existsSync(docsDir)) {
  for (const f of readdirSync(docsDir)) {
    if (!f.endsWith('.md')) continue;
    const p = join(docsDir, f);
    if (!statSync(p).isFile()) continue;
    if (DOCS_EXEMPT.has(f)) continue;
    const n = readFileSync(p, 'utf8').split('\n').length;
    if (n > DOCS_LINE_FLAG)
      problems.push(`docs/claude/${f} is ${n} lines (> ${DOCS_LINE_FLAG}). If it's a dated one-off audit, move it to docs/claude/archive/.`);
  }
}

for (const n of notes) console.log(`[context-lint] ${n}`);
if (!problems.length) { console.log('[context-lint] OK — committed context is within budget.'); process.exit(0); }
console.log('[context-lint] VIOLATIONS:');
for (const p of problems) console.log('  - ' + p);
process.exit(WARN_ONLY ? 0 : 1);
