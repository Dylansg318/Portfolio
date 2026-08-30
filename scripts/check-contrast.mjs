/**
 * Contrast gate for the design tokens.
 *
 * Colour choices are the easiest thing in a design system to get quietly wrong:
 * a token gets nudged, a theme drifts, and nobody notices until someone can't
 * read the site. This parses src/styles/global.css and fails the build if any
 * text/background pair drops below its WCAG threshold.
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
  ['ink', 'bg', 4.5, 'body text on page'],
  ['ink', 'surface', 4.5, 'body text on card'],
  ['ink', 'surface-raised', 4.5, 'body text on raised surface'],
  ['ink-muted', 'bg', 4.5, 'secondary text on page'],
  ['ink-muted', 'surface', 4.5, 'secondary text on card'],
  ['ink-faint', 'bg', 4.5, 'meta text on page'],
  ['ink-faint', 'surface', 4.5, 'meta text on card'],
  ['accent', 'bg', 4.5, 'link on page'],
  ['accent', 'surface', 4.5, 'link on card'],
  ['accent-ink', 'accent', 4.5, 'button label on accent'],
  ['nav-ink', 'nav', 4.5, 'nav label on nav bar'],
  ['nav-muted', 'nav', 4.5, 'inactive nav label on nav bar'],
  ['tab-active-ink', 'tab-active', 4.5, 'active tab label'],
  ['ok', 'surface', 4.5, 'success text'],
  ['danger', 'surface', 4.5, 'error text'],
  ['border-strong', 'bg', 3, 'UI boundary (non-text)'],
];

let failed = 0;
for (const [theme, selector] of [
  ['light', ':root {'],
  ['dark', "[data-theme='dark'] {"],
  ['slip light', ":root[data-skin='slip'] {"],
  ['slip dark', ":root[data-skin='slip'][data-theme='dark'] {"],
]) {
  const t = tokensFor(selector);
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
