#!/usr/bin/env node
/**
 * Copies the FROZEN contract from the backend repo into openapi/foshol-api.yaml.
 *
 * The source is owned by agent A1 (00-common §12.1) and is NEVER edited. It declares
 * `openapi: 3.1.0` while using 43 OpenAPI-3.0-style `nullable: true` keywords, which 3.1
 * removed. A strict 3.1 parser drops them and the generated client would type 43 nullable
 * fields as non-nullable — silent false confidence under strictNullChecks.
 *
 * This script therefore rewrites EXACTLY ONE LINE — the version declaration — and asserts
 * that nothing else changed. Deterministic, re-runnable, and recorded in DEVIATIONS.md.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = '/Users/a.sarker/Work/Code/foshol-doctor/docs/openapi/foshol-api.yaml';
const TARGET = join(root, 'openapi', 'foshol-api.yaml');

const source = readFileSync(SOURCE, 'utf8');
const lines = source.split('\n');

const idx = lines.findIndex((l) => /^openapi:\s*3\.1\.\d+\s*$/.test(l));
if (idx === -1) {
  const already = lines.some((l) => /^openapi:\s*3\.0\.\d+\s*$/.test(l));
  if (!already) {
    console.error('sync-openapi FAILED: no `openapi: 3.1.x` line found in the frozen source.');
    process.exit(1);
  }
} else {
  lines[idx] = 'openapi: 3.0.3';
}

const out = lines.join('\n');

// Assert the ONLY difference is that one line.
const diffCount = source.split('\n').filter((l, i) => l !== out.split('\n')[i]).length;
if (diffCount > 1) {
  console.error(`sync-openapi FAILED: ${diffCount} lines differ; expected at most 1.`);
  process.exit(1);
}

mkdirSync(join(root, 'openapi'), { recursive: true });
writeFileSync(TARGET, out);
console.log(`sync-openapi: ${SOURCE}\n            → openapi/foshol-api.yaml (${diffCount} line rewritten: openapi 3.1.0 → 3.0.3)`);
