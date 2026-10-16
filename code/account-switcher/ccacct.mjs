#!/usr/bin/env node
/**
 * ccacct — Claude Code account switcher + cross-account usage view.
 *
 * How it works (verified against the 2.1.268 native binary):
 *   - Setting CLAUDE_CONFIG_DIR gives Claude Code a fully isolated config home:
 *     <dir>/.claude.json holds the identity, usage cache and project trust.
 *   - Credentials do NOT collide. The macOS Keychain service name is derived as
 *       default:  "Claude Code-credentials"
 *       profile:  "Claude Code-credentials-" + sha256(CLAUDE_CONFIG_DIR).hex[0:8]
 *     so every profile dir gets its own login slot automatically.
 *   - Usage is the reading Claude Code itself last saved in each profile's
 *     .claude.json, shown with its age. This script never reads a login token
 *     and never calls Anthropic; signing in is always Claude Code's own flow.
 *
 * The harness (agents, skills, hooks, scripts, plugins, projects, CLAUDE.md,
 * settings.json) is symlinked into each profile so a switch changes WHO you are,
 * not WHAT you have.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
const MASTER = path.join(HOME, '.claude');
const ROOT = path.join(HOME, '.claude-profiles');
const KC_USER = /^[a-zA-Z0-9._-]+$/.test(process.env.USER || '') ? process.env.USER : 'claude-code-user';

// Shared harness. Directories are safe to symlink (the CLI writes files inside
// them). The two files are symlinked too, but `doctor` checks for an atomic
// rewrite having replaced the link with a real file.
const SHARE_DIRS = ['agents', 'skills', 'hooks', 'scripts', 'plugins', 'commands', 'plans'];
const SHARE_FILES = ['CLAUDE.md', 'settings.json'];
// projects/ carries auto-memory + transcripts; shared so memory follows you.
const SHARE_STATE = ['projects'];

const C = process.stdout.isTTY && !process.env.NO_COLOR
  ? { d:'\x1b[2m', b:'\x1b[1m', r:'\x1b[0m', g:'\x1b[32m', y:'\x1b[33m', red:'\x1b[31m', c:'\x1b[36m' }
  : { d:'', b:'', r:'', g:'', y:'', red:'', c:'' };

// ---------- profile plumbing ----------

const keychainService = (dir) =>
  dir === null ? 'Claude Code-credentials'
               : `Claude Code-credentials-${createHash('sha256').update(dir.normalize('NFC')).digest('hex').slice(0, 8)}`;

const profileDir = (name) => (isDefault(name) ? null : path.join(ROOT, name));

// The default config home (~/.claude) has no profile dir of its own. It is shown
// and addressed as 'default'.
const DEFAULT_LABEL = 'default';
const isDefault = (n) => n === DEFAULT_LABEL;

// Who each profile must be signed in as, read from ~/.claude-profiles/accounts.json
// (see accounts.example.json). A profile once drifted to a different login with
// nothing saying so (its name stayed the same), and an approval clicked while the
// browser is signed into the wrong claude.ai account lands on that account silently.
// So list, doctor and relogin check against this file — never against the
// profile's own .claude.json, which follows whoever signed in last. A profile the
// file doesn't name is unpinned and never flagged.
const ACCOUNTS_FILE = path.join(ROOT, 'accounts.json');
let pinned = null;
function readAccounts() {
  let raw;
  try { raw = fs.readFileSync(ACCOUNTS_FILE, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
  // A file that doesn't parse must fail loudly: read as empty, it would switch the
  // check off for every profile without a word.
  let map;
  try { map = JSON.parse(raw); } catch (e) { die(`${ACCOUNTS_FILE} is not valid JSON (${e.message})`); }
  if (!map || typeof map !== 'object' || Array.isArray(map) || Object.values(map).some((v) => typeof v !== 'string')) {
    die(`${ACCOUNTS_FILE} must map profile names to email addresses — see accounts.example.json`);
  }
  return map;
}
const expectedEmail = (name) => {
  pinned ??= readAccounts();
  return Object.hasOwn(pinned, name) ? pinned[name] : null;
};
// The address the profile SHOULD hold when it holds another one; null when fine or unpinned.
const wrongAccount = (p) => {
  const want = expectedEmail(p.name);
  return want && p.email && p.email.toLowerCase() !== want.toLowerCase() ? want : null;
};

function listProfiles() {
  const names = [DEFAULT_LABEL];
  if (fs.existsSync(ROOT)) {
    for (const e of fs.readdirSync(ROOT, { withFileTypes: true })) {
      if (e.isDirectory() && !e.name.startsWith('.')) names.push(e.name);
    }
  }
  return names;
}

// Whether the profile's Keychain slot exists. No -w: the secret is never read.
function hasLogin(dir) {
  try {
    execFileSync('security', ['find-generic-password', '-a', KC_USER, '-s', keychainService(dir)], { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

function readConfig(dir) {
  // Default profile keeps its config at ~/.claude.json (NOT ~/.claude/.claude.json);
  // a CLAUDE_CONFIG_DIR profile keeps it at <dir>/.claude.json. Try both, newest wins.
  const candidates = dir ? [path.join(dir, '.claude.json')]
                         : [path.join(HOME, '.claude.json'), path.join(MASTER, '.claude.json')];
  for (const f of candidates) {
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
  }
  return null;
}

// ---------- usage ----------

// Absolute path: PATH may lack ~/.local/bin (launchd jobs, some non-login shells).
const CLAUDE_BIN = [process.env.CCACCT_CLAUDE_BIN, path.join(HOME, '.local', 'bin', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']
  .find((c) => { try { return c && fs.statSync(c).isFile(); } catch { return false; } }) ?? 'claude';

function probe(name) {
  const dir = profileDir(name);
  const cfg = readConfig(dir);
  const acct = cfg?.oauthAccount ?? null;
  const out = {
    name, dir: dir ?? MASTER,
    email: acct?.emailAddress ?? null,
    tier: acct?.organizationRateLimitTier ?? acct?.organizationType ?? null,
    limits: [], state: 'unknown', note: '', age: null,
  };
  if (!hasLogin(dir)) { out.state = 'logged-out'; return out; }

  // The reading Claude Code itself last saved for this profile. It is as old as
  // Claude Code's last check, not as old as this run, so it is always shown with
  // its age and an old figure never passes for a current one.
  const cached = cfg?.cachedUsageUtilization;
  if (cached?.utilization?.limits) {
    out.limits = cached.utilization.limits;
    out.state = 'saved';
    out.age = Date.now() - (cached.fetchedAtMs ?? 0);
  } else {
    out.state = 'no reading yet';
    out.note = `run /usage once in a session under ${name}`;
  }
  return out;
}

// ---------- rendering ----------

const bar = (pct) => {
  const n = Math.max(0, Math.min(10, Math.round((pct ?? 0) / 10)));
  const col = pct >= 90 ? C.red : pct >= 70 ? C.y : C.g;
  return `${col}${'█'.repeat(n)}${C.d}${'░'.repeat(10 - n)}${C.r}`;
};

function until(iso) {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return '';
  if (ms <= 0) return 'now';
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  return d > 0 ? `${d}d ${h % 24}h` : h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

const ago = (ms) => {
  if (ms == null) return '';
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
};

const labelOf = (l) =>
  l.kind === 'session' ? '5-hour'
  : l.kind === 'weekly_all' ? 'week (all)'
  : l.kind === 'weekly_scoped' ? `week (${l.scope?.model?.display_name ?? l.scope?.surface ?? 'scoped'})`
  : l.kind;


function render(profiles, current) {
  const pad = (s, n) => s + ' '.repeat(Math.max(0, n - visLen(s)));
  const visLen = (s) => s.replace(/\x1b\[[0-9;]*m/g, '').length;
  const wName = Math.max(7, ...profiles.map((p) => p.name.length));
  const wMail = Math.max(7, ...profiles.map((p) => (p.email ?? '—').length));

  console.log('');
  for (const p of profiles) {
    const here = p.dir === current;
    const mark = here ? `${C.c}●${C.r}` : ' ';
    const head = `${mark} ${C.b}${pad(p.name, wName)}${C.r}  ${pad(p.email ?? `${C.d}—${C.r}`, wMail)}  ${C.d}${p.tier ? p.tier.replace(/^default_claude_/, '') : ''}${C.r}`;
    console.log(head);
    if (wrongAccount(p)) console.log(`    ${C.y}⚠ ${p.name} should be ${wrongAccount(p)} — sign in again: ccacct relogin ${p.name}${C.r}`);

    if (p.state === 'logged-out') {
      console.log(`    ${C.y}not logged in${C.r} ${C.d}— ccacct relogin ${p.name}${C.r}`);
    } else if (!p.limits.length) {
      console.log(`    ${C.y}${p.state}${C.r} ${C.d}— ${p.note}${C.r}`);
    } else {
      for (const l of p.limits) {
        const pct = Math.round(l.percent ?? 0);
        const sev = l.severity === 'critical' ? `${C.red} at limit${C.r}` : l.is_active ? `${C.y} active${C.r}` : '';
        console.log(`    ${pad(labelOf(l), 20)} ${bar(pct)} ${String(pct).padStart(3)}%  ${C.d}resets in ${until(l.resets_at)}${C.r}${sev}`);
      }
      console.log(`    ${C.d}as of ${ago(p.age)}${C.r}`);
    }
    console.log('');
  }
}

// ---------- harness linking ----------

function linkHarness(dir, { quiet = false } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const report = [];
  for (const rel of [...SHARE_DIRS, ...SHARE_STATE, ...SHARE_FILES]) {
    const src = path.join(MASTER, rel);
    const dst = path.join(dir, rel);
    if (!fs.existsSync(src)) continue;
    let st = null;
    try { st = fs.lstatSync(dst); } catch {}
    if (st?.isSymbolicLink()) {
      if (fs.readlinkSync(dst) === src) { report.push(['ok', rel]); continue; }
      fs.unlinkSync(dst);
    } else if (st) {
      report.push(['REAL', rel]); // real file/dir shadowing the master — never clobber
      continue;
    }
    fs.symlinkSync(src, dst);
    report.push(['linked', rel]);
  }
  if (!quiet) for (const [s, rel] of report) {
    if (s === 'REAL') console.log(`  ${C.y}!${C.r} ${rel} ${C.d}is a real file here, not a link to ~/.claude — left alone${C.r}`);
    else if (s === 'linked') console.log(`  ${C.g}+${C.r} ${rel}`);
  }
  return report;
}

// ---------- commands ----------

const args = process.argv.slice(2);
const cmd = args[0] ?? 'list';
const current = process.env.CLAUDE_CONFIG_DIR || MASTER;

function requireName(n) {
  if (!n) die('need a profile name');
  if (!/^[a-zA-Z0-9._-]+$/.test(n)) die(`bad profile name "${n}" — use letters, digits, . _ -`);
  return n;
}
function die(m) { console.error(`${C.red}ccacct:${C.r} ${m}`); process.exit(1); }

switch (cmd) {
  case 'list': case 'ls': {
    const names = listProfiles();
    render(names.map(probe), current);
    break;
  }

  case 'which': {
    const name = listProfiles().find((n) => (profileDir(n) ?? MASTER) === current) ?? '(unregistered)';
    const cfg = readConfig(profileDir(name));
    console.log(`${name}  ${C.d}${cfg?.oauthAccount?.emailAddress ?? 'not logged in'}  ${current}${C.r}`);
    break;
  }

  case 'path': {
    const name = requireName(args[1]);
    console.log(profileDir(name) ?? MASTER);
    break;
  }

  case 'add': {
    const name = requireName(args[1]);
    const emailIdx = args.indexOf('--email');
    const email = emailIdx > -1 ? args[emailIdx + 1] : null;
    if (isDefault(name)) {
      // The default slot is ~/.claude itself, so there is no dir to create — only a login.
      // env -u matters: from a shell that ran `ccacct use`, a bare login would land in that profile.
      const want = email ?? expectedEmail(name);
      console.log(`${C.b}${DEFAULT_LABEL} is ~/.claude — sign in as ${want ?? 'the account you want there'}${C.r}`);
      console.log(`Every Claude session already running on ~/.claude moves to that account within ~30s.`);
      console.log(`In the browser, be signed into claude.ai as ${want ?? 'that account'} first.\n`);
      console.log(`  env -u CLAUDE_CONFIG_DIR claude auth login${want ? ` --email ${want}` : ''}\n`);
      console.log(`${C.d}Run that line, then: ccacct list${C.r}`);
      break;
    }
    const dir = profileDir(name);
    const fresh = !fs.existsSync(dir);
    console.log(`${C.b}${fresh ? 'creating' : 'refreshing'} profile ${name}${C.r}  ${C.d}${dir}${C.r}`);
    linkHarness(dir);
    console.log(`  ${C.d}keychain slot: ${keychainService(dir)}${C.r}`);
    console.log(`\n${C.b}Now sign in as the account you want under "${name}".${C.r}`);
    console.log(`A browser window opens; make sure you are signed into claude.ai as that account first.\n`);
    console.log(`  CLAUDE_CONFIG_DIR=${dir} claude auth login${email ? ` --email ${email}` : ''}\n`);
    console.log(`${C.d}Run that line, then: ccacct list${C.r}`);
    break;
  }

  case 'link': case 'sync': {
    const names = args[1] ? [requireName(args[1])] : listProfiles().filter((n) => !isDefault(n));
    for (const n of names) { console.log(`${C.b}${n}${C.r}`); linkHarness(profileDir(n)); }
    break;
  }

  case 'doctor': {
    const defEmail = readConfig(null)?.oauthAccount?.emailAddress ?? null;
    const defWant = wrongAccount({ name: DEFAULT_LABEL, email: defEmail });
    console.log(`${C.b}${DEFAULT_LABEL}${C.r} ${C.d}${MASTER}${C.r}`);
    console.log(defWant
      ? `  ${C.y}signed in as ${defEmail}, should be ${defWant} — ccacct relogin ${DEFAULT_LABEL}${C.r}`
      : `  ${C.g}ok${C.r} ${C.d}${defEmail ?? 'not signed in'}${C.r}`);
    for (const n of listProfiles().filter((x) => !isDefault(x))) {
      const dir = profileDir(n);
      console.log(`${C.b}${n}${C.r} ${C.d}${dir}${C.r}`);
      const rep = linkHarness(dir, { quiet: true });
      const broken = rep.filter(([s]) => s === 'REAL');
      const relinked = rep.filter(([s]) => s === 'linked');
      if (relinked.length) console.log(`  ${C.g}repaired:${C.r} ${relinked.map((r) => r[1]).join(', ')}`);
      if (broken.length) console.log(`  ${C.y}shadowed (real files, not links):${C.r} ${broken.map((r) => r[1]).join(', ')}`);
      if (!relinked.length && !broken.length) console.log(`  ${C.g}ok${C.r}`);
      console.log(`  ${C.d}keychain: ${keychainService(dir)} ${hasLogin(dir) ? C.g + 'present' : C.y + 'missing'}${C.r}`);
      const email = readConfig(dir)?.oauthAccount?.emailAddress ?? null;
      const want = wrongAccount({ name: n, email });
      if (want) console.log(`  ${C.y}signed in as ${email}, should be ${want} — ccacct relogin ${n}${C.r}`);
    }
    break;
  }

  case 'use': {
    // Emitted for `eval` by the ccacct shell function.
    const name = requireName(args[1]);
    const dir = profileDir(name);
    if (dir && !fs.existsSync(dir)) die(`no profile "${name}" — ccacct add ${name}`);
    console.log(dir ? `export CLAUDE_CONFIG_DIR=${JSON.stringify(dir)}` : 'unset CLAUDE_CONFIG_DIR');
    break;
  }

  case 'run': {
    const name = requireName(args[1]);
    const dir = profileDir(name);
    if (dir && !fs.existsSync(dir)) die(`no profile "${name}" — ccacct add ${name}`);
    const env = { ...process.env };
    if (dir) env.CLAUDE_CONFIG_DIR = dir; else delete env.CLAUDE_CONFIG_DIR;
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync('claude', args.slice(2), { stdio: 'inherit', env });
    process.exit(r.status ?? 0);
  }

  case 'relogin': {
    // One command back from "sign-in expired": Claude's own sign-in for this profile,
    // its approval page opened in the default browser, then a check that it landed on
    // the right account. BROWSER is pinned because a background Claude session can
    // export BROWSER=true, which silently swallows the CLI's own browser launch.
    const name = requireName(args[1]);
    const dir = profileDir(name);
    if (dir && !fs.existsSync(dir)) die(`no profile "${name}" — ccacct add ${name}`);
    const emailIdx = args.indexOf('--email');
    const email = (emailIdx > -1 ? args[emailIdx + 1] : null)
      ?? expectedEmail(name)
      ?? readConfig(dir)?.oauthAccount?.emailAddress; // an unpinned profile: whoever it held last
    if (!email) die(`no email on file for ${name} — ccacct relogin ${name} --email <address>`);

    console.log(`${C.b}Signing ${name} in as ${email}${C.r}`);
    if (!dir) console.log(`${C.y}Every Claude session already running on ~/.claude moves to ${email} within ~30s.${C.r}`);
    console.log(`Your browser opens Claude's approval page. Check it shows ${email} (switch accounts there if not), then click Authorize.\n`);
    const env = { ...process.env, BROWSER: '/usr/bin/open' };
    if (dir) env.CLAUDE_CONFIG_DIR = dir; else delete env.CLAUDE_CONFIG_DIR;
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(CLAUDE_BIN, ['auth', 'login', '--email', email], { stdio: 'inherit', env, cwd: os.tmpdir() });
    if (r.status !== 0) die(`sign-in did not finish (claude ${r.signal ? `killed by ${r.signal}` : `exited ${r.status}`})`);

    // The address Claude Code saved for this profile once the sign-in finished.
    const now = readConfig(dir)?.oauthAccount?.emailAddress ?? null;
    if (!now) die(`${name} finished signing in but saved no address — run ccacct doctor`);
    if (now.toLowerCase() !== email.toLowerCase()) {
      die(`${name} is now signed in as ${now}, not ${email} — run ccacct relogin ${name} again and pick ${email} on the approval page`);
    }
    console.log(`${C.g}✓ ${name} is signed in as ${now}${C.r}`);
    break;
  }

  case 'rm': {
    const name = requireName(args[1]);
    if (isDefault(name)) die(`refusing to remove ${name} — it is your main ~/.claude login`);
    const dir = profileDir(name);
    if (!args.includes('--yes')) {
      console.log(`Would remove:\n  dir      ${dir}\n  keychain ${keychainService(dir)}`);
      console.log(`\nShared harness dirs are symlinks, so ~/.claude is untouched.`);
      console.log(`Re-run with --yes to do it.`);
      break;
    }
    try { execFileSync('security', ['delete-generic-password', '-a', KC_USER, '-s', keychainService(dir)], { stdio: 'ignore' }); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`removed ${name}`);
    break;
  }

  default:
    console.log(`ccacct — Claude Code account switcher

  ccacct list                 all profiles with the usage Claude Code last saved
                              for each, and its age (default)
  ccacct which                which profile this shell is using
  ccacct use <name>           switch this shell (needs the shell function)
  ccacct run <name> [args]    run claude once under <name>
  ccacct add <name> [--email] create a profile and print the login command
                              (add default: the ~/.claude login itself)
  ccacct relogin <name>       sign a profile in again: opens the approval page,
                              then checks the account [--email]
  ccacct sync [name]          re-link the shared harness
  ccacct doctor               check/repair profile links and keychain slots
  ccacct rm <name> --yes      delete a profile and its keychain slot
`);
}
