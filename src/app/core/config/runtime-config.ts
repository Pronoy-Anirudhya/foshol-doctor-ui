import { APP_CONFIG } from './app-config';

/**
 * Where the API lives, as decided by the DEPLOYMENT rather than by the build.
 *
 * `WEB-NFR-009` keeps every constant in `app-config.ts`, and that file stays frozen. Nothing here
 * changes a value there — this module chooses between the frozen value and one the deployment
 * supplied, which is a different kind of fact. `APP_CONFIG.api.origin` remains the answer
 * everywhere the deployment has not spoken, so `ng serve` and the whole test suite behave exactly
 * as they did before this file existed.
 *
 * The deployment speaks through `/env.js`: a **classic** script in the document head. Classic
 * scripts run to completion before any `<script type="module">`, so the global is already set when
 * the bundle's module-scope initialisers run — including `appConfig`'s `ApiConfiguration` provider
 * and the origin test in `auth.interceptor.ts`. `public/env.js` ships an empty object so a dev
 * server gets a 200 rather than a 404 and falls straight through to the frozen constant.
 *
 * No `HttpClient` is injected here, so `check:arch`'s `WEB-API-001` rule is not engaged; the file
 * is not an `index.ts`, so `no-barrels` is not engaged; no dependency is added, so `WEB-NFR-007`
 * is not engaged.
 */

/** The shape `/env.js` writes. Everything is optional — an older image may write nothing. */
interface RuntimeGlobal {
  __FOSHOL_RUNTIME__?: { apiBaseUrl?: unknown };
}

const SAME_ORIGIN = '';
const TRAILING_SLASHES = /\/+$/;

/**
 * What a request URL is built FROM.
 *
 * An empty string means **same origin**: every request becomes a root-relative path and the
 * reverse proxy in front of this bundle decides which host actually serves `/api`. A non-empty
 * value is an absolute origin, which is what `ng serve` uses.
 *
 * Never pass this to `new URL(path, base)` — `new URL('/x', '')` throws `TypeError: Invalid URL`.
 * Use {@link apiOrigin} for that.
 */
export function apiBaseUrl(): string {
  const supplied = (globalThis as RuntimeGlobal).__FOSHOL_RUNTIME__?.apiBaseUrl;
  if (typeof supplied !== 'string') return APP_CONFIG.api.origin;
  // A trailing slash would produce `//api/v1/stream` in the one place that concatenates.
  return supplied.trim().replace(TRAILING_SLASHES, SAME_ORIGIN);
}

/**
 * The ABSOLUTE origin the `WEB-SEC-003` comparison is made against, and the only safe base for
 * `new URL(path, base)`. Where the deployment chose same-origin, that origin is this document's.
 *
 * Resolved per call rather than cached in a module-scope constant. That is the whole point: the
 * old `const API_ORIGIN` froze whatever was true at import time, and if it ever disagreed with the
 * real origin, four interceptors stopped decorating requests — no bearer, no `Accept-Language`, no
 * correlation id — with nothing on screen to say so.
 */
export function apiOrigin(): string {
  const base = apiBaseUrl();
  return base === SAME_ORIGIN ? globalThis.location.origin : new URL(base).origin;
}
