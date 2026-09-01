// Best-effort freeform → structured address parser for paste-to-fill. Pure, no
// network. Used by every address form and the shipping page. Ported from an
// old server-side regex parser and extended to handle comma-less single-line
// pastes (e.g. "123 oak st springfield IL 62704"), which the comma-only
// version mis-parsed into the City field.
import { US_STATE_NAMES, isValidStateCode } from './usStates';

export interface ParsedAddress {
  name: string;
  company: string;
  addr1: string;
  addr2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

// Street-type suffixes (abbrev + full) — the boundary between street and city in
// a comma-less line. Match is on a whole lowercased token (trailing '.' stripped).
const STREET_SUFFIXES = new Set([
  'st', 'street', 'rd', 'road', 'ave', 'avenue', 'blvd', 'boulevard', 'dr', 'drive',
  'ln', 'lane', 'ct', 'court', 'way', 'pl', 'place', 'pkwy', 'parkway', 'hwy',
  'highway', 'cir', 'circle', 'ter', 'terrace', 'trl', 'trail', 'loop', 'pike',
  'run', 'path', 'row', 'sq', 'square', 'pt', 'point', 'xing', 'crossing', 'plz',
  'plaza', 'ctr', 'center', 'expy', 'expressway', 'aly', 'alley',
]);

// Secondary-unit markers — the token after the street that introduces a suite/apt.
const UNIT_MARKERS = new Set([
  'ste', 'suite', 'apt', 'apartment', 'unit', 'fl', 'floor', 'bldg', 'building',
  'rm', 'room', 'dept', 'department', 'no',
]);

// Full state names longest-first so "West Virginia" wins over "Virginia" etc.
const STATE_NAME_ENTRIES = Object.entries(US_STATE_NAMES).sort(
  (a, b) => b[1].length - a[1].length,
);

function tokenKey(t: string): string {
  return t.toLowerCase().replace(/\.$/, '');
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function empty(): ParsedAddress {
  return { name: '', company: '', addr1: '', addr2: '', city: '', state: '', zip: '', country: 'US' };
}

// Guard: only treat a paste as an address (vs. a normal field paste) when it
// plausibly is one — long enough, a digit + a letter, and a comma, newline, or
// 5-digit ZIP. Shared by every paste-to-fill surface.
export function looksLikeAddress(text: string): boolean {
  if (!text || text.length < 8) return false;
  if (!/\d/.test(text) || !/[a-zA-Z]/.test(text)) return false;
  return /,/.test(text) || /\n/.test(text) || /\b\d{5}(-\d{4})?\b/.test(text);
}

// The fields the parser actually populated (skip blanks + country) so a paste
// augments a form instead of wiping fields the operator already typed.
const APPLIED_FIELDS = ['name', 'company', 'addr1', 'addr2', 'city', 'state', 'zip'] as const;
export function filledFields(parsed: ParsedAddress): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of APPLIED_FIELDS) if (parsed[k]) out[k] = parsed[k];
  return out;
}

export function parseAddress(raw: string): ParsedAddress {
  const result = empty();
  let text = String(raw || '')
    .replace(/[\r\n\t]+/g, ', ') // newlines become segment breaks → comma path
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/,\s*$/, '');

  // ── ZIP (5 or ZIP+4) ──
  const zipMatch = text.match(/\b(\d{5})(?:-(\d{4}))?\b/);
  if (zipMatch) {
    result.zip = zipMatch[0];
    text = (text.slice(0, zipMatch.index) + text.slice(zipMatch.index! + zipMatch[0].length)).trim();
  }

  // ── State: trailing 2-letter code, else a full state name anywhere ──
  const abbrMatch = text.match(/,?\s*\b([A-Za-z]{2})\b\s*,?\s*$/);
  if (abbrMatch && isValidStateCode(abbrMatch[1])) {
    result.state = abbrMatch[1].toUpperCase();
    text = text.slice(0, abbrMatch.index).trim();
  } else {
    const lower = text.toLowerCase();
    for (const [abbr, name] of STATE_NAME_ENTRIES) {
      const idx = lower.lastIndexOf(name.toLowerCase());
      if (idx >= 0) {
        result.state = abbr;
        text = (text.slice(0, idx) + text.slice(idx + name.length)).trim();
        break;
      }
    }
  }

  text = text.replace(/^[,\s]+|[,\s]+$/g, '').replace(/,\s*,/g, ',');
  if (!text) return result;

  return text.includes(',') ? parseCommaForm(text, result) : parseLineForm(text, result);
}

// Comma-delimited form (the original heuristic): last segment is the city; the
// rest split into address lines (has a digit / unit keyword) vs name/company.
function parseCommaForm(text: string, result: ParsedAddress): ParsedAddress {
  const segments = text.split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean);
  if (segments.length >= 1) result.city = segments.pop() as string;

  const addrKeywords = /\b(ste|suite|apt|unit|floor|bldg|po box|p\.o\.|#)\b/i;
  const addrLines: string[] = [];
  const nameLines: string[] = [];
  for (const seg of segments) {
    if (/\d/.test(seg) || addrKeywords.test(seg)) addrLines.push(seg);
    else nameLines.push(seg);
  }
  if (addrLines.length >= 2) {
    result.addr1 = addrLines[0];
    result.addr2 = addrLines.slice(1).join(', ');
  } else if (addrLines.length === 1) {
    result.addr1 = addrLines[0];
  }
  if (nameLines.length >= 2) {
    result.company = nameLines[0];
    result.name = nameLines[1];
  } else if (nameLines.length === 1) {
    result.name = nameLines[0];
  }
  return result;
}

// Comma-less single line: find the street boundary and split street / unit / city.
// Never guesses a city when no boundary is found — keeps the raw text in addr1.
function parseLineForm(text: string, result: ParsedAddress): ParsedAddress {
  const tokens = text.split(/\s+/).filter(Boolean);

  // PO Box
  if (tokens.length >= 3 && /^p\.?o\.?$/i.test(tokens[0]) && /^box$/i.test(tokens[1])) {
    result.addr1 = `PO Box ${tokens[2]}`;
    result.city = titleCase(tokens.slice(3).join(' '));
    return result;
  }

  let lastStreetIdx = -1;
  for (let i = 0; i < tokens.length; i++) {
    if (STREET_SUFFIXES.has(tokenKey(tokens[i]))) lastStreetIdx = i;
  }

  if (lastStreetIdx === -1) {
    // No recognizable street boundary — keep it intact, don't invent a city.
    result.addr1 = tokens.join(' ');
    return result;
  }

  result.addr1 = tokens.slice(0, lastStreetIdx + 1).join(' ');
  let rest = tokens.slice(lastStreetIdx + 1);

  // Absorb a leading secondary unit (Ste 1000, Apt 4B, #1000) into addr2.
  if (rest.length) {
    if (UNIT_MARKERS.has(tokenKey(rest[0]))) {
      result.addr2 = rest.slice(0, 2).join(' ');
      rest = rest.slice(2);
    } else if (rest[0].startsWith('#')) {
      result.addr2 = rest[0];
      rest = rest.slice(1);
    }
  }

  result.city = titleCase(rest.join(' '));
  return result;
}
