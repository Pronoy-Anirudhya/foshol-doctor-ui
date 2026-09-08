#!/usr/bin/env node
/**
 * WEB-NFR-005 / COMMON-NFR-003 — every dependency is pinned to an exact version.
 * `ng new` writes caret ranges; this gate makes that impossible to ship.
 *
 * Usage:  node scripts/check-pins.mjs [--fix]
 * --fix rewrites every range to the version actually installed in node_modules.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const fix = process.argv.includes('--fix');
const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const offenders = [];
let changed = false;

for (const field of ['dependencies', 'devDependencies']) {
  for (const [name, range] of Object.entries(pkg[field] ?? {})) {
    if (EXACT.test(range)) continue;
    const installed = join(root, 'node_modules', name, 'package.json');
    if (fix && existsSync(installed)) {
      pkg[field][name] = JSON.parse(readFileSync(installed, 'utf8')).version;
      changed = true;
    } else {
      offenders.push(`${field}.${name} = "${range}"`);
    }
  }
}

if (changed) {
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log('check-pins: rewrote ranges to installed exact versions.');
}

if (offenders.length) {
  console.error('check-pins FAILED — non-exact version ranges (WEB-NFR-005):');
  for (const o of offenders) console.error(`  ${o}`);
  process.exit(1);
}
console.log('check-pins: all dependencies pinned exactly.');
