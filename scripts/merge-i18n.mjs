#!/usr/bin/env node
/**
 * WEB-UX-010 / WEB-UX-017 — bn.json and en.json ship from the first commit and always have
 * IDENTICAL key sets.
 *
 * Many agents contribute strings. Rather than serialising them all behind one catalogue
 * owner, each owns a fragment in src/i18n/<namespace>.i18n.json holding BOTH languages per
 * key:
 *
 *   { "farmer.capture.blurRejected": { "bn": "…", "en": "…" } }
 *
 * That shape makes an unpaired key structurally impossible, so WEB-UX-017 cannot be violated
 * by construction rather than merely being tested afterwards. This script asserts the
 * invariants and emits sorted flat catalogues into public/i18n/, which are committed build
 * artefacts.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'src', 'i18n');
const OUT = join(root, 'public', 'i18n');
const LOCALES = ['bn', 'en'];

/** `farmer-capture.i18n.json` owns keys prefixed `farmer.capture.` */
const namespaceOf = (file) => `${basename(file, '.i18n.json').replaceAll('-', '.')}.`;

const errors = [];
const owner = new Map();
const merged = Object.fromEntries(LOCALES.map((l) => [l, {}]));

const files = readdirSync(SRC).filter((f) => f.endsWith('.i18n.json')).sort();
if (files.length === 0) errors.push('no fragments found in src/i18n/');

for (const file of files) {
  const ns = namespaceOf(file);
  let fragment;
  try {
    fragment = JSON.parse(readFileSync(join(SRC, file), 'utf8'));
  } catch (e) {
    errors.push(`${file}: not valid JSON — ${e.message}`);
    continue;
  }

  for (const [key, value] of Object.entries(fragment)) {
    if (owner.has(key)) {
      errors.push(`${file}: key "${key}" is already defined in ${owner.get(key)}`);
      continue;
    }
    owner.set(key, file);

    if (!key.startsWith(ns)) {
      errors.push(`${file}: key "${key}" must start with the fragment namespace "${ns}"`);
      continue;
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`${file}: key "${key}" must map to an object of locale → string`);
      continue;
    }
    const missing = LOCALES.filter((l) => typeof value[l] !== 'string' || value[l].length === 0);
    if (missing.length) {
      errors.push(`${file}: key "${key}" is missing a non-empty value for [${missing.join(', ')}]`);
      continue;
    }
    const extra = Object.keys(value).filter((l) => !LOCALES.includes(l));
    if (extra.length) {
      errors.push(`${file}: key "${key}" has unsupported locale(s) [${extra.join(', ')}]`);
      continue;
    }
    for (const l of LOCALES) merged[l][key] = value[l];
  }
}

if (errors.length) {
  console.error('merge-i18n FAILED:');
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
for (const l of LOCALES) {
  const sorted = Object.fromEntries(Object.entries(merged[l]).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(join(OUT, `${l}.json`), `${JSON.stringify(sorted, null, 2)}\n`);
}

console.log(
  `merge-i18n: ${files.length} fragment(s) → ${Object.keys(merged.bn).length} keys × ${LOCALES.length} locales.`,
);
