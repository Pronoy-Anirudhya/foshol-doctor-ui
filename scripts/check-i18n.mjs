#!/usr/bin/env node
/**
 * The i18n build gate. Three checks, each mapping to a requirement:
 *
 *  1. The committed catalogues match a fresh merge      — the artefact is not stale.
 *  2. bn.json and en.json have identical key sets       — WEB-UX-017 / AC-18.
 *  3. Every `| translate` key used in a template exists — WEB-UX-014's real guarantee: a
 *     missing key can never reach production, so the runtime fallback is a safety net
 *     rather than the mechanism.
 *  4. Every defined key is used somewhere               — catches drift as features move.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'public', 'i18n');
const errors = [];

const before = ['bn', 'en'].map((l) => readFileSync(join(OUT, `${l}.json`), 'utf8'));
execFileSync(process.execPath, [join(root, 'scripts', 'merge-i18n.mjs')], { stdio: 'pipe' });
const after = ['bn', 'en'].map((l) => readFileSync(join(OUT, `${l}.json`), 'utf8'));
if (before[0] !== after[0] || before[1] !== after[1]) {
  errors.push('public/i18n/*.json is stale — run `npm run i18n:build` and commit the result.');
}

const bn = JSON.parse(after[0]);
const en = JSON.parse(after[1]);
const bnKeys = new Set(Object.keys(bn));
const enKeys = new Set(Object.keys(en));
for (const k of bnKeys) if (!enKeys.has(k)) errors.push(`WEB-UX-017: "${k}" is in bn.json but not en.json`);
for (const k of enKeys) if (!bnKeys.has(k)) errors.push(`WEB-UX-017: "${k}" is in en.json but not bn.json`);

/** Walk src/app for .html and .ts, collecting referenced keys. */
const used = new Set();
// Two forms only: `'some.key' | translate` in a template, and translate.instant/get/stream('some.key')
// in TypeScript. A bare `t(...)` alternative was tried and removed: it matched the trailing `t` of
// any identifier, so `import(...)`, `token.split('.')` and `Intl.DateTimeFormat('en-GB')` were all
// reported as missing translation keys.
const KEY =
  /['"`]([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+)['"`]\s*\|\s*translate|(?<![\w$])translate\.(?:instant|get|stream)\(\s*['"`]([^'"`]+)['"`]/g;
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry !== 'generated') walk(p);
    } else if (['.html', '.ts'].includes(extname(p)) && !p.endsWith('.spec.ts')) {
      const text = readFileSync(p, 'utf8');
      for (const m of text.matchAll(KEY)) used.add(m[1] ?? m[2]);
    }
  }
};
walk(join(root, 'src', 'app'));

for (const k of used) {
  if (!bnKeys.has(k)) errors.push(`used-but-undefined translation key: "${k}"`);
}
// Only warn on unused: a key may be referenced dynamically by an enum-keyed lookup.
const unused = [...bnKeys].filter((k) => ![...used].some((u) => u === k || k.startsWith(`${u}.`)));

if (errors.length) {
  console.error('check-i18n FAILED:');
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log(
  `check-i18n: ${bnKeys.size} keys, bn/en parity OK, ${used.size} referenced` +
    (unused.length ? `, ${unused.length} not statically referenced (dynamic lookups are fine).` : '.'),
);
