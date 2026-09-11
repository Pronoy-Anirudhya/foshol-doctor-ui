#!/usr/bin/env node
/**
 * The architectural rules of 70-frontend.ears.md, as a build gate rather than a hope.
 * Deliberately a ~150-line scanner instead of ESLint: an ESLint + typescript-eslint stack
 * is a dozen more packages, and WEB-NFR-007 is the point.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'src');
const violations = [];

/** HttpClient may only be injected where the transport genuinely lives (WEB-API-001). */
const HTTP_ALLOWED = ['app/core/http/', 'app/core/media/', 'app/core/sse/', 'app/core/i18n/'];

const RULES = [
  {
    id: 'WEB-SEC-005',
    why: 'no server-supplied string may be rendered as HTML',
    test: /\binnerHTML\b|bypassSecurityTrust(Html|Script|Url|ResourceUrl)/,
  },
  {
    id: 'WEB-SEC-001',
    why: 'the JWT never goes into localStorage',
    test: /localStorage\s*[.[]\s*['"`]?\w*[Tt]oken/,
  },
  {
    // D-37 — the session is mirrored to sessionStorage, and only SessionStore may touch it.
    id: 'WEB-SEC-001',
    why: 'sessionStorage holds the session and is reached only through core/auth/session-store.ts',
    test: /\bsessionStorage\b/,
    exempt: (f) => /^app\/core\/auth\/session-store(\.spec)?\.ts$/.test(f),
  },
  {
    id: 'WEB-NFR-002',
    why: 'no third-party state library',
    test: /from\s+['"](@ngrx\/|@datorama\/akita|@ngneat\/elf|mobx|redux)/,
  },
  {
    id: 'WEB-NFR-004',
    why: "ngx-translate only — $localize is build-time and cannot toggle at runtime",
    test: /\$localize\s*`/,
  },
  {
    id: 'WEB-FR-350',
    why: 'the SSE stream is read with fetch; EventSource cannot carry an Authorization header',
    test: /new\s+EventSource\b/,
  },
  {
    id: 'WEB-FR-356',
    why: 'no endpoint may be polled on a timer — live updates come from SSE',
    test: /setInterval\s*\(/,
    exempt: (f) => /claim-timer|waveform|countdown|recorder/.test(f),
  },
  {
    id: 'WEB-FR-404',
    why: 'no user data logged to the console in a production build',
    test: /console\.(log|debug|info)\s*\(/,
  },
  {
    id: 'zoneless',
    why: 'every external callback writes a signal; manual change detection is banned',
    test: /\.detectChanges\s*\(|ApplicationRef[\s\S]{0,40}\.tick\s*\(/,
    // TestBed fixtures legitimately drive change detection by hand; the rule is about
    // production code reaching for it instead of writing a signal.
    exempt: (f) => f.endsWith('.spec.ts') || f.startsWith('testing/'),
  },
  {
    id: 'no-barrels',
    why: 'barrel files are the #1 source of multi-agent merge conflicts',
    test: null,
    file: (f) => /(^|\/)index\.ts$/.test(f) && !f.includes('generated/'),
  },
];

/**
 * Blanks out comments while preserving offsets, so reported line numbers stay accurate.
 * Deliberately not a parser: it only needs to be right about comments, and it errs towards
 * leaving code intact rather than blanking too much.
 */
function stripComments(src, ext) {
  if (ext === '.html') return src.replaceAll(/<!--[\s\S]*?-->/g, (m) => m.replaceAll(/[^\n]/g, ' '));

  let out = '';
  let state = 'code'; // code | line | block | single | double | tick
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1];
    const keep = () => (out += c);
    const blank = () => (out += c === '\n' ? '\n' : ' ');

    switch (state) {
      case 'code':
        if (c === '/' && next === '/') { state = 'line'; blank(); }
        else if (c === '/' && next === '*') { state = 'block'; blank(); }
        else { if (c === "'") state = 'single'; else if (c === '"') state = 'double'; else if (c === '`') state = 'tick'; keep(); }
        break;
      case 'line':
        if (c === '\n') { state = 'code'; keep(); } else blank();
        break;
      case 'block':
        blank();
        if (c === '*' && next === '/') { out += ' '; i++; state = 'code'; }
        break;
      case 'single': case 'double': case 'tick': {
        keep();
        const quote = state === 'single' ? "'" : state === 'double' ? '"' : '`';
        if (c === '\\') { if (next !== undefined) { out += next; i++; } }
        else if (c === quote) state = 'code';
        break;
      }
    }
  }
  return out;
}

const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      walk(p);
      continue;
    }
    const rel = relative(SRC, p).replaceAll('\\', '/');
    if (!['.ts', '.html', '.css'].includes(extname(p))) continue;
    // Generated code is never hand-edited and is exempt from style rules (COMMON-NFR-043).
    if (rel.startsWith('app/generated/')) continue;

    const raw = readFileSync(p, 'utf8');
    // Strip comments before matching. A comment that says "never use innerHTML (WEB-SEC-005)"
    // is exactly the documentation we want, and must not fail the build that it documents.
    const text = stripComments(raw, extname(p));
    for (const rule of RULES) {
      if (rule.file?.(rel)) {
        violations.push(`${rel}: ${rule.id} — ${rule.why}`);
        continue;
      }
      if (!rule.test) continue;
      if (rule.exempt?.(rel)) continue;
      const m = text.match(rule.test);
      if (m) {
        const line = text.slice(0, m.index).split('\n').length;
        violations.push(`${rel}:${line}: ${rule.id} — ${rule.why} (found \`${m[0].trim()}\`)`);
      }
    }

    if (/\binject\(\s*HttpClient\s*\)|:\s*HttpClient\b/.test(text) && !HTTP_ALLOWED.some((a) => rel.startsWith(a))) {
      violations.push(`${rel}: WEB-API-001 — HttpClient may only be injected under ${HTTP_ALLOWED.join(', ')}`);
    }
  }
};

walk(SRC);

if (violations.length) {
  console.error('check-architecture FAILED:');
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}
console.log('check-architecture: all rules pass.');
