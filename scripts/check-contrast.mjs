/**
 * Contrast gate for the design tokens.
 *
 * Colour choices are the easiest thing in a design system to get quietly wrong:
 * a token gets nudged and nobody notices until someone can't read the site.
 * This parses the `:root` block of src/styles/global.css — the prose column,
 * the method badges and the dark response column all live there — and the
 * `:root[data-theme='dark']` block that overrides it, and fails the build if
 * any text/background pair drops below its WCAG threshold in either theme.
 * The dark block lists only what changes, so it is checked merged over light.
 *
 * Run: node scripts/check-contrast.mjs
 */
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');

/** Pull `--name: #hex;` declarations out of one selector block. */
function tokensFor(selector) {
  const i = css.indexOf(selector);
  if (i === -1) throw new Error(`selector not found: ${selector}`);
  const body = css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
  const out = {};
  for (const m of body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) out[m[1]] = m[2];
  return out;
}

const srgb = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function luminance(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
}
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

// [foreground, background, minimum, what it is]
const PAIRS = [
  // the prose column
  ['ink', 'bg', 4.5, 'body text on page'],
  ['ink', 'surface-raised', 4.5, 'body text on a quiet fill'],
  ['ink-muted', 'bg', 4.5, 'secondary text on page'],
  ['ink-muted', 'surface-raised', 4.5, 'secondary text on a quiet fill'],
  ['ink-faint', 'bg', 4.5, 'meta text on page'],
  ['ink-faint', 'surface-raised', 4.5, 'meta text on a quiet fill'],
  ['accent', 'bg', 4.5, 'link on page'],
  ['accent', 'surface-raised', 4.5, 'link on a quiet fill'],
  ['accent-ink', 'accent-fill', 4.5, 'button label on the accent fill'],
  ['nav-ink', 'nav', 4.5, 'nav label on the header'],
  ['nav-muted', 'nav', 4.5, 'inactive nav label on the header'],
  ['tab-active-ink', 'tab-active', 4.5, 'active nav label on its wash'],
  ['ok', 'bg', 4.5, 'success text'],
  ['warn', 'bg', 4.5, 'warning text'],
  ['danger', 'bg', 4.5, 'error text'],
  ['border-strong', 'bg', 3, 'UI boundary (non-text)'],
  // method badges
  ['get', 'get-bg', 4.5, 'GET badge'],
  ['post', 'post-bg', 4.5, 'POST badge'],
  // the response column
  ['code-ink', 'code-bg', 4.5, 'code on the column'],
  ['code-ink', 'code-surface', 4.5, 'code on a panel'],
  ['code-dim', 'code-bg', 4.5, 'caption on the column'],
  ['code-dim', 'code-surface', 4.5, 'caption on a panel'],
  ['syn-key', 'code-surface', 4.5, 'JSON key on a panel'],
  ['syn-str', 'code-surface', 4.5, 'JSON string on a panel'],
  ['syn-num', 'code-surface', 4.5, 'JSON number on a panel'],
  ['code-bg', 'syn-key', 4.5, 'selected language tab'],
  ['accent-ink', 'accent-fill', 4.5, 'Send label'],
  ['code-line', 'code-surface', 1.2, 'hairline on a panel (visible, not text)'],
];

let failed = 0;
const light = tokensFor(':root {');
const THEMES = [
  ['light', light],
  ['dark', { ...light, ...tokensFor(":root[data-theme='dark'] {") }],
];
for (const [theme, t] of THEMES) {
  console.log(`\n${theme}`);
  for (const [fg, bg, min, label] of PAIRS) {
    if (!t[fg] || !t[bg]) {
      console.log(`  SKIP  ${label} (missing --${fg} or --${bg})`);
      continue;
    }
    const r = contrast(t[fg], t[bg]);
    const ok = r >= min;
    if (!ok) failed++;
    console.log(
      `  ${ok ? 'pass' : 'FAIL'}  ${r.toFixed(2).padStart(6)} (min ${min})  ${label}` +
        `  [${fg} on ${bg}]`,
    );
  }
}

if (failed > 0) {
  console.error(`\n${failed} contrast pair(s) below threshold.`);
  process.exit(1);
}
console.log('\nAll contrast pairs pass.');
