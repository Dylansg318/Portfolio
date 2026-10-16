/**
 * Build a throwaway Zen profile that carries your Zen logins for ONE container.
 *
 * Why flatten: Zen can keep logins in separate containers — a Work container and a
 * Personal container, say, each signed in to a different account on the same site.
 * Automated tabs open outside any container, so the chosen container's
 * cookies are moved into the default cookie jar; default-jar cookies fill in only for
 * sites the container has nothing for, so two accounts never mix on one site.
 *
 * Only cookies travel (saved ones, plus the session-only ones from Zen's session-restore
 * file) and cert_override.txt for local dev certs: no saved passwords, history,
 * extensions, Sync account or open tabs. Firefox stores cookies unencrypted, so
 * a file copy is enough; Zen holds the database locked while it runs, so the files are
 * copied raw and checked with PRAGMA quick_check.
 *
 * CLI (prints what WOULD be copied — site names and counts, never values):
 *   node profile.mjs                 # the default container from config.json
 *   node profile.mjs Personal        # or an alias from config.json, or "none" for no container
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ZEN_BIN = '/Applications/Zen.app/Contents/MacOS/zen';
export const ZEN_ROOT = path.join(os.homedir(), 'Library/Application Support/zen');
export const CACHE_ROOT = path.join(os.homedir(), 'Library/Caches/claude-zen');
export const RUNS_DIR = path.join(CACHE_ROOT, 'runs');
export const NO_CONTAINER = 'none';

export function loadConfig() {
  return JSON.parse(fs.readFileSync(path.join(HERE, 'config.json'), 'utf8'));
}

/** The profile Zen is using: of the profiles in profiles.ini, the one whose cookies changed last. */
export function findZenProfile() {
  if (process.env.ZEN_PROFILE_DIR) return process.env.ZEN_PROFILE_DIR;
  const ini = fs.readFileSync(path.join(ZEN_ROOT, 'profiles.ini'), 'utf8');
  const dirs = [...ini.matchAll(/^Path=(.+)$/gm)].map((m) => {
    const p = m[1].trim();
    return path.isAbsolute(p) ? p : path.join(ZEN_ROOT, p);
  });
  const mtime = (dir) => Math.max(
    ...['cookies.sqlite', 'cookies.sqlite-wal'].map((f) => {
      try { return fs.statSync(path.join(dir, f)).mtimeMs; } catch { return 0; }
    }),
  );
  const best = dirs.map((d) => ({ d, t: mtime(d) })).sort((a, b) => b.t - a.t)[0];
  if (!best || best.t === 0) throw new Error(`No Zen profile with cookies under ${ZEN_ROOT}`);
  return best.d;
}

const L10N_NAMES = {
  'user-context-personal': 'Personal',
  'user-context-work': 'Work',
  'user-context-banking': 'Banking',
  'user-context-shopping': 'Shopping',
};

/** The profile's containers, as Zen names them. */
export function readContainers(profileDir) {
  let identities = [];
  try {
    identities = JSON.parse(fs.readFileSync(path.join(profileDir, 'containers.json'), 'utf8')).identities ?? [];
  } catch { /* no containers file: only "none" exists */ }
  return identities
    .filter((i) => i.public)
    .map((i) => ({ id: i.userContextId, name: i.name || L10N_NAMES[i.l10nId] || i.l10nId }));
}

/**
 * Resolve a container name or alias to { id, name }; id null = outside any container.
 * Throws with the choices when the name is unknown or never copied.
 */
export function resolveContainer(profileDir, wanted, config = loadConfig()) {
  const containers = readContainers(profileDir);
  const never = new Set((config.neverContainers ?? []).map((n) => n.toLowerCase()));
  const allowed = containers.filter((c) => !never.has(c.name.toLowerCase()));
  const choices = [...allowed.map((c) => c.name), NO_CONTAINER];
  const key = String(wanted ?? '').trim().toLowerCase();
  const name = (config.aliases ?? {})[key] ?? wanted;
  if (String(name).toLowerCase() === NO_CONTAINER) return { id: null, name: NO_CONTAINER, choices };
  if (never.has(String(name).toLowerCase())) {
    throw new Error(`"${name}" is never copied out of Zen (config.json neverContainers). Choices: ${choices.join(', ')}`);
  }
  const hit = allowed.find((c) => c.name.toLowerCase() === String(name).toLowerCase());
  if (!hit) throw new Error(`No Zen container "${wanted}". Choices: ${choices.join(', ')}`);
  return { ...hit, choices };
}

const TWO_LEVEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.nz',
  'co.jp', 'ne.jp', 'co.kr', 'or.kr', 'co.in', 'com.br', 'com.mx', 'com.cn', 'com.hk',
  'com.sg', 'com.tr', 'co.za',
]);

/** Registrable site of a cookie host, close enough to keep two accounts from mixing on one site. */
export function siteOf(host) {
  const h = String(host).replace(/^\./, '').toLowerCase();
  if (!h.includes('.') || /^[\d.]+$/.test(h) || h.includes(':')) return h;
  const labels = h.split('.');
  const last2 = labels.slice(-2).join('.');
  return TWO_LEVEL_SUFFIXES.has(last2) ? labels.slice(-3).join('.') : last2;
}

/** "^userContextId=2&partitionKey=…" → { ucid: 2, rest: "^partitionKey=…" } */
function splitOriginAttributes(oa) {
  const params = oa ? oa.replace(/^\^/, '').split('&').filter(Boolean) : [];
  let ucid = 0;
  const rest = [];
  for (const p of params) {
    if (p.startsWith('userContextId=')) ucid = Number(p.slice('userContextId='.length));
    else rest.push(p);
  }
  return { ucid, rest: rest.length ? `^${rest.join('&')}` : '' };
}

function copyCookieDb(profileDir, destDir) {
  const dest = path.join(destDir, 'cookies.sqlite');
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    for (const f of ['cookies.sqlite', 'cookies.sqlite-wal']) {
      fs.rmSync(path.join(destDir, f), { force: true });
      if (fs.existsSync(path.join(profileDir, f))) fs.copyFileSync(path.join(profileDir, f), path.join(destDir, f));
    }
    fs.rmSync(path.join(destDir, 'cookies.sqlite-shm'), { force: true });
    try {
      const db = new DatabaseSync(dest);
      const check = db.prepare('PRAGMA quick_check').get();
      if (Object.values(check)[0] === 'ok') return db;
      db.close();
      lastError = new Error(`quick_check: ${JSON.stringify(check)}`);
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`Could not copy Zen's cookie database cleanly: ${lastError?.message}`);
}

/** Firefox's session-restore format: "mozLz40\0", uint32 decompressed size, one LZ4 block. */
function decodeMozLz4(buf) {
  if (buf.toString('latin1', 0, 8) !== 'mozLz40\0') throw new Error('not a mozLz4 file');
  const src = buf.subarray(12);
  const out = Buffer.alloc(buf.readUInt32LE(8));
  let i = 0;
  let o = 0;
  const length = (n) => {
    if (n !== 15) return n;
    let b;
    do { b = src[i++]; n += b; } while (b === 255);
    return n;
  };
  while (i < src.length) {
    const token = src[i++];
    const literals = length(token >> 4);
    src.copy(out, o, i, i + literals);
    i += literals;
    o += literals;
    if (i >= src.length) break;
    const offset = src[i] | (src[i + 1] << 8);
    i += 2;
    const match = length(token & 15) + 4;
    for (let k = 0; k < match; k++, o++) out[o] = out[o - offset];
  }
  return out.subarray(0, o);
}

/**
 * Session-only cookies. Firefox never writes them to cookies.sqlite — only to the
 * session-restore file, rewritten every ~15s while Zen runs. Many sites keep their login
 * in a session-only cookie (one profile held over a thousand of them on one day), so
 * without this the copy looks signed out on exactly the sites that matter.
 */
function readSessionCookies(profileDir) {
  for (const f of ['recovery.jsonlz4', 'recovery.baklz4']) {
    try {
      const json = JSON.parse(decodeMozLz4(fs.readFileSync(path.join(profileDir, 'sessionstore-backups', f))).toString('utf8'));
      return json.cookies ?? [];
    } catch { /* missing or mid-write: try the backup */ }
  }
  return [];
}

/** Firefox's origin-attribute encoding (form-urlencoded: "(https,example.com)" → "%28https%2Cexample.com%29"). */
const formEncode = (v) => [...Buffer.from(String(v))]
  .map((b) => (/[A-Za-z0-9*\-._]/.test(String.fromCharCode(b)) ? String.fromCharCode(b) : b === 32 ? '+' : `%${b.toString(16).toUpperCase().padStart(2, '0')}`))
  .join('');

/**
 * Write cookies.sqlite for `container` into `runDir` (created if missing): the saved
 * cookies plus the session-only ones, flattened to the default jar.
 * Returns a summary of what was copied: counts and site names, never cookie values.
 */
export function buildRunProfile({ profileDir, container, runDir, config = loadConfig() }) {
  fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
  const neverSites = (config.neverSites ?? []).map((s) => s.toLowerCase());
  const blocked = (site) => neverSites.some((s) => site === s || site.endsWith(`.${s}`));
  const target = container.id ?? 0;

  const db = copyCookieDb(profileDir, runDir);
  try {
    const saved = db.prepare('SELECT id, host, originAttributes FROM moz_cookies').all()
      .map((r) => ({ ...r, ...splitOriginAttributes(r.originAttributes), site: siteOf(r.host) }));
    const session = readSessionCookies(profileDir)
      .filter((c) => !c.originAttributes?.privateBrowsingId && !c.originAttributes?.firstPartyDomain)
      .map((c) => ({
        c,
        ucid: c.originAttributes?.userContextId ?? 0,
        rest: c.originAttributes?.partitionKey ? `^partitionKey=${formEncode(c.originAttributes.partitionKey)}` : '',
        site: siteOf(c.host),
      }));
    const containerSites = new Set([...saved, ...session].filter((r) => r.ucid === target).map((r) => r.site));
    const kept = { container: new Set(), filled: new Set() };
    const keep = (r) => {
      if (blocked(r.site)) return false;
      if (r.ucid === target) kept.container.add(r.site);
      else if (r.ucid === 0 && !containerSites.has(r.site)) kept.filled.add(r.site);
      else return false;
      return true;
    };

    db.exec('BEGIN');
    const del = db.prepare('DELETE FROM moz_cookies WHERE id = ?');
    const upd = db.prepare('UPDATE moz_cookies SET originAttributes = ? WHERE id = ?');
    let skipped = 0;
    for (const r of saved) {
      if (!keep(r)) { del.run(r.id); skipped++; } else if (r.originAttributes !== r.rest) upd.run(r.rest, r.id);
    }
    // A session cookie lives as long as the browser; the copy is thrown away on close,
    // so a week is just "outlives this run".
    const nowUs = Date.now() * 1000;
    const expiry = Date.now() + 7 * 86400_000;
    const ins = db.prepare(`INSERT OR IGNORE INTO moz_cookies
      (originAttributes, name, value, host, path, expiry, lastAccessed, creationTime, isSecure, isHttpOnly,
       inBrowserElement, sameSite, schemeMap, isPartitionedAttributeSet, updateTime)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`);
    let sessionAdded = 0;
    for (const r of session) {
      if (!keep(r)) { skipped++; continue; }
      const { c } = r;
      sessionAdded += Number(ins.run(r.rest, c.name, c.value, c.host, c.path ?? '/', expiry, nowUs, nowUs,
        c.secure ? 1 : 0, c.httponly ? 1 : 0, c.sameSite ?? 0, c.schemeMap ?? 0, c.isPartitioned ? 1 : 0, nowUs).changes);
    }
    db.exec('COMMIT');
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const cookies = db.prepare('SELECT count(*) AS n FROM moz_cookies').get().n;

    for (const f of ['cert_override.txt']) {
      if (fs.existsSync(path.join(profileDir, f))) fs.copyFileSync(path.join(profileDir, f), path.join(runDir, f));
    }
    return {
      container: container.name,
      cookies,
      sessionCookies: sessionAdded,
      skipped,
      containerSites: [...kept.container].sort(),
      filledSites: [...kept.filled].sort(),
    };
  } finally {
    db.close();
  }
}

/**
 * The sites each container holds cookies for, keyed by Zen's container number (0 = no
 * container). Live mode uses it to prove which remote-control id is which container
 * before acting as one: the ids it gets are random, and a wrong guess would act as the
 * wrong container's accounts.
 */
export function cookieSitesByContainer(profileDir) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zen-sites-'));
  try {
    const db = copyCookieDb(profileDir, dir);
    const rows = db.prepare('SELECT host, originAttributes FROM moz_cookies').all();
    db.close();
    const sites = new Map();
    const add = (ucid, host) => {
      if (!sites.has(ucid)) sites.set(ucid, new Set());
      sites.get(ucid).add(siteOf(host));
    };
    for (const r of rows) add(splitOriginAttributes(r.originAttributes).ucid, r.host);
    for (const c of readSessionCookies(profileDir)) add(c.originAttributes?.userContextId ?? 0, c.host);
    return sites;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  const profileDir = findZenProfile();
  let container;
  try {
    container = resolveContainer(profileDir, process.argv[2] ?? config.defaultContainer, config);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zen-profile-check-'));
  try {
    const s = buildRunProfile({ profileDir, container, runDir, config });
    console.log(`Zen profile: ${profileDir}`);
    console.log(`Container:   ${s.container}   (choices: ${container.choices.join(', ')})`);
    console.log(`Cookies copied: ${s.cookies} (${s.sessionCookies} of them session-only); left in Zen: ${s.skipped}`);
    console.log(`From the container (${s.containerSites.length} sites): ${s.containerSites.join(', ')}`);
    console.log(`From outside any container (${s.filledSites.length} sites): ${s.filledSites.join(', ')}`);
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
}
