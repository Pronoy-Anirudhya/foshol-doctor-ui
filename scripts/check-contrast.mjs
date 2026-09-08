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

/**
 * The palette, resolved.
 *
 * The token system has two layers: a colour on screen may be written as a literal
 * (`--color-paddy-600: #146c4a`) or as a semantic alias over one
 * (`--color-primary: var(--color-paddy-600)`). A gate that only understood literals would check
 * the ramp nobody writes and skip the alias every component writes — which is exactly the drift
 * this file exists to prevent. So aliases are followed to the hex they end at: a CHAIN, because
 * `--color-ring: var(--color-focus)` is two hops, and with a `seen` set so a typo that makes a
 * cycle is a build failure rather than a stack overflow.
 *
 * Anything that is neither a bare 6-digit hex nor a bare single `var(--color-*)` — a
 * `color-mix()`, an `rgb()`, an 8-digit hex carrying alpha — resolves to null ON PURPOSE. A
 * colour whose contrast this script cannot honestly compute must fail loudly, because a silently
 * skipped pair looks identical to a passing one.
 *
 * The scrape covers the whole file rather than just `@theme`. Every `--color-*` declaration lives
 * there today; if one ever appears in a `@layer`, the last one wins.
 */
const RAW = /--color-([a-z0-9-]+):\s*([^;}]+);/g;
const raw = {};
for (const m of css.matchAll(RAW)) raw[m[1]] = m[2].trim();

const HEX6 = /^#[0-9a-fA-F]{6}$/;
const ALIAS = /^var\(\s*--color-([a-z0-9-]+)\s*\)$/;

function resolveToken(token, seen = new Set()) {
  if (seen.has(token)) return null; // a cycle
  seen.add(token);
  const value = raw[token];
  if (value === undefined) return null;
  if (HEX6.test(value)) return value;
  const alias = ALIAS.exec(value);
  return alias ? resolveToken(alias[1], seen) : null;
}

const palette = {};
for (const token of Object.keys(raw)) {
  const hex = resolveToken(token);
  if (hex !== null) palette[token] = hex;
}

const srgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const lum = (hex) =>
  srgb(hex)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/**
 * [foreground, background, minimum, what it is used for]
 *
 * Rows name the SEMANTIC token wherever components write one, because the gate should verify
 * what is on screen rather than the ramp behind it. The resolver above follows the alias.
 */
const PAIRS = [
  // ── Ink on the light surfaces ────────────────────────────────────────────────────────────
  ['ink', 'surface-0', 4.5, 'body text on the base surface'],
  ['ink', 'surface-1', 4.5, 'body text on the page ground'],
  ['ink', 'surface-2', 4.5, 'body text on a raised panel'],
  ['ink-muted', 'surface-0', 4.5, 'secondary text'],
  ['ink-muted', 'surface-1', 4.5, 'secondary text on the page ground'],
  ['ink-muted', 'surface-2', 4.5, 'secondary text on a raised chip'],
  ['ink-faint', 'surface-0', 4.5, 'tertiary text'],
  ['ink-faint', 'surface-1', 4.5, 'tertiary text on the page ground'],
  ['ink-faint', 'surface-2', 4.5, 'tertiary text on a raised panel'],

  // ── Labels on a filled control ───────────────────────────────────────────────────────────
  ['on-primary', 'primary', 4.5, 'label on a primary control'],
  ['on-primary', 'primary-hover', 4.5, 'label on a pressed primary control'],
  ['on-accent', 'accent', 4.5, 'label on an accent control'],
  ['on-warning', 'warning', 4.5, 'label on a warning badge'],
  ['on-danger', 'danger', 4.5, 'label on a destructive badge'],

  // ── Text inside a tinted chip ────────────────────────────────────────────────────────────
  ['paddy-700', 'paddy-100', 4.5, 'text inside a success chip'],
  ['teal-700', 'accent-soft', 4.5, 'text inside an accent chip'],
  ['dawn-700', 'dawn-100', 4.5, 'text inside a warning chip'],
  ['clay-700', 'clay-100', 4.5, 'text inside a rejection chip'],
  ['paddy-800', 'paddy-50', 4.5, 'text inside a success toast'],
  ['ink', 'paddy-100', 4.5, 'selected text'],
  ['sage-600', 'sage-100', 4.5, 'text on the neutral series ground'],
  // The live-arrival status line sits on the base row, the zebra stripe AND the hover state,
  // so all three grounds carry the text floor. Note this is teal-700, not the `accent` alias:
  // accent on surface-2 is 4.34, which fails the moment the officer's pointer crosses the row.
  ['teal-700', 'surface-0', 4.5, 'live-arrival status text'],
  ['teal-700', 'surface-1', 4.5, 'live-arrival status text on the page ground'],
  ['teal-700', 'surface-2', 4.5, 'live-arrival status text on a hovered row'],
  ['ink', 'teal-100', 4.5, 'row content during the live-arrival wash'],
  ['dawn-700', 'surface-0', 4.5, 'claim-timer warning text and its glyph'],

  // ── The console ──────────────────────────────────────────────────────────────────────────
  ['on-console', 'console', 4.5, 'console chrome text'],
  ['on-console', 'console-deep', 4.5, 'text on the deepest console panel'],
  ['ink-invert', 'slate-700', 4.5, 'officer console panel text'],
  ['on-console-muted', 'console', 4.5, 'axis text on an inner console card'],
  ['on-console-muted', 'console-deep', 4.5, 'axis and caption text on the hero panel'],
  ['slate-200', 'console-deep', 4.5, 'emphatic caption on the hero panel'],
  ['dawn-300', 'console-deep', 4.5, 'stream-degraded text on the dark header chip'],
  ['surface-2', 'console-deep', 4.5, 'stream-idle text on the dark header chip'],

  // ── UI boundaries and marks ──────────────────────────────────────────────────────────────
  ['primary', 'surface-0', 3.0, 'primary UI boundary'],
  ['accent', 'surface-0', 3.0, 'accent UI boundary and sparkline stroke'],
  ['danger', 'surface-0', 3.0, 'destructive UI boundary'],
  ['warning', 'surface-0', 3.0, 'warning UI boundary'],
  ['sage-600', 'surface-0', 4.5, 'neutral queue-state fill'],
  ['on-primary', 'sage-600', 4.5, 'count on the neutral queue-state segment'],
  ['sage-400', 'surface-0', 3.0, 'neutral divider'],
  ['clay-300', 'console', 3.0, 'unread-count badge on the dark header'],
  ['ink', 'clay-300', 4.5, 'the unread count itself'],
  ['slate-600', 'surface-0', 4.5, 'volume-tile glyph and accent'],
  ['slate-800', 'surface-0', 4.5, 'agreement-tile glyph and accent'],
  ['paddy-400', 'console-deep', 3.0, 'histogram bar on the hero panel'],
  ['teal-300', 'console-deep', 3.0, 'peak-bin highlight on the hero panel'],
  ['dawn-300', 'console-deep', 3.0, 'secondary-band marker on the hero panel'],

  // ── Focus ────────────────────────────────────────────────────────────────────────────────
  ['ring', 'surface-0', 3.0, 'focus ring on the base surface'],
  ['ring', 'surface-1', 3.0, 'focus ring on the page ground'],
  ['ring', 'surface-2', 3.0, 'focus ring on a raised panel'],
  ['ring-invert', 'console', 3.0, 'focus ring on the console panel'],
  ['ring-invert', 'console-deep', 3.0, 'focus ring on the deepest console panel'],

  // ── Decorative floors ────────────────────────────────────────────────────────────────────
  // Borders that carry no meaning on their own: the shape, glyph and text all say it first.
  // Gated anyway, so a later edit cannot quietly drop one to invisible.
  ['surface-3', 'surface-0', 1.2, 'card border (decorative floor)'],
  ['paddy-300', 'paddy-50', 1.4, 'success toast border (decorative floor)'],
  ['dawn-300', 'dawn-100', 1.4, 'warning toast border (decorative floor)'],
  ['clay-300', 'clay-100', 1.4, 'rejection toast border (decorative floor)'],
  ['slate-500', 'console-deep', 1.4, 'console gridline (decorative floor)'],
];

const failures = [];
const report = [];

/**
 * An alias that resolves to nothing is a broken variable at runtime whether or not it is gated,
 * so it fails here even when no PAIRS row names it.
 */
for (const [token, value] of Object.entries(raw)) {
  if (ALIAS.test(value) && palette[token] === undefined) {
    failures.push(`--color-${token}: "${value}" does not resolve to a hex (dangling or circular)`);
  }
}

/** Says which of the two problems it is: a name that does not exist, or a value we cannot read. */
const describe = (t) =>
  raw[t] === undefined
    ? `--color-${t} is not declared in src/styles.css`
    : `--color-${t} is "${raw[t]}", not a 6-digit hex or a single var(--color-*) alias`;

for (const [fg, bg, min, use] of PAIRS) {
  const unresolved = [fg, bg].filter((t) => palette[t] === undefined);
  if (unresolved.length > 0) {
    for (const t of unresolved) failures.push(`pair ${fg}/${bg}: ${describe(t)}`);
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
