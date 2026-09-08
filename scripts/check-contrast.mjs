#!/usr/bin/env node
/**
 * WEB-UX-043 as a build gate: 4.5:1 for body text, 3:1 for large text, icons and UI
 * component boundaries (WCAG 2.1 AA). Stated in the spec as a floor precisely because the
 * severity palette and the confidence bars are the two places a designer's instinct
 * produces a low-contrast result — so it is checked, not trusted.
 *
 * Reads the hex values straight out of src/styles.css so the palette cannot drift from the
 * thing being verified.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'src', 'styles.css'), 'utf8');

const palette = {};
for (const m of css.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) palette[m[1]] = m[2];

const srgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const lum = (hex) =>
  srgb(hex)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/** [foreground, background, minimum, what it is used for] */
const PAIRS = [
  ['ink', 'surface-0', 4.5, 'body text on the base surface'],
  ['ink', 'surface-1', 4.5, 'body text on the page ground'],
  ['ink', 'surface-2', 4.5, 'body text on a raised panel'],
  ['ink-muted', 'surface-0', 4.5, 'secondary text'],
  ['ink-muted', 'surface-1', 4.5, 'secondary text on the page ground'],
  ['ink-faint', 'surface-0', 4.5, 'tertiary text'],
  ['ink-faint', 'surface-1', 4.5, 'tertiary text on the page ground'],
  ['ink-faint', 'surface-2', 4.5, 'tertiary text on a raised panel'],
  ['ink-invert', 'paddy-600', 4.5, 'label on a primary button'],
  ['ink-invert', 'paddy-700', 4.5, 'label on a pressed primary button'],
  ['ink-invert', 'dawn-600', 4.5, 'label on a warning badge'],
  ['ink-invert', 'clay-600', 4.5, 'label on a destructive badge'],
  ['ink-invert', 'slate-800', 4.5, 'officer console chrome text'],
  ['ink-invert', 'slate-700', 4.5, 'officer console panel text'],
  ['paddy-700', 'paddy-100', 4.5, 'text inside a success chip'],
  ['dawn-700', 'dawn-100', 4.5, 'text inside a warning chip'],
  ['clay-700', 'clay-100', 4.5, 'text inside a rejection chip'],
  ['paddy-600', 'surface-0', 3.0, 'primary UI boundary'],
  ['clay-600', 'surface-0', 3.0, 'destructive UI boundary'],
  ['dawn-600', 'surface-0', 3.0, 'warning UI boundary'],
  ['focus', 'surface-0', 3.0, 'focus ring on the base surface'],
  ['focus', 'surface-1', 3.0, 'focus ring on the page ground'],
  ['focus', 'surface-2', 3.0, 'focus ring on a raised panel'],
  ['surface-3', 'surface-0', 1.2, 'card border (decorative floor)'],
];

const failures = [];
const report = [];
for (const [fg, bg, min, use] of PAIRS) {
  if (!palette[fg] || !palette[bg]) {
    failures.push(`unknown token in pair ${fg}/${bg}`);
    continue;
  }
  const r = ratio(palette[fg], palette[bg]);
  report.push(`  ${r.toFixed(2).padStart(6)}:1  (min ${min})  ${fg} on ${bg} — ${use}`);
  if (r < min) failures.push(`${fg} on ${bg} = ${r.toFixed(2)}:1, below ${min}:1 — ${use}`);
}

if (failures.length) {
  console.error('check-contrast FAILED (WEB-UX-043):');
  for (const f of failures) console.error(`  ${f}`);
  console.error(report.join('\n'));
  process.exit(1);
}
console.log(`check-contrast: ${PAIRS.length} colour pairs meet WCAG 2.1 AA.`);
console.log(report.join('\n'));
