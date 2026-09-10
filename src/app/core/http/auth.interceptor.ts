import type { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { SessionStore } from '../auth/session-store';
import { apiOrigin } from '../config/runtime-config';

/**
 * WEB-SEC-002 — the JWT is attached as an `Authorization: Bearer` header by an interceptor and
 * never placed in a URL, query parameter or route fragment. Nothing in this file writes the
 * token anywhere but the header of a request already bound for the API origin.
 *
 * WEB-SEC-003 — the header goes to the configured API origin and NOWHERE else. A presigned
 * object-store URL carries its own authorisation (COMMON-SEC-016); forwarding our bearer to
 * MinIO would hand a third-party host a credential it has no business seeing.
 */

/**
 * The three endpoints that exist precisely to obtain a token, so sending one is meaningless
 * (handover §1). Skipping them also keeps a stale token from turning a fresh login into a 401.
 */
export const PUBLIC_AUTH_PATHS: readonly string[] = [
  '/api/v1/auth/otp/request',
  '/api/v1/auth/otp/verify',
  '/api/v1/auth/officer/login',
];

/**
 * WEB-SEC-003 — the one origin test, shared by every interceptor that decorates a request.
 *
 * Resolving against the API origin means a relative URL counts as the API (the generated
 * client always builds absolute URLs from `ApiConfiguration.rootUrl`, so a relative one is our
 * own), while an absolute or protocol-relative presigned URL resolves to its own host and fails
 * the comparison.
 */
export function isApiOriginUrl(url: string): boolean {
  try {
    // Resolved per call, never cached: a module-scope constant would freeze whatever the origin
    // was at import time, and a disagreement between the two silently strips the bearer from
    // every request rather than failing anywhere visible.
    const origin = apiOrigin();
    return new URL(url, origin).origin === origin;
  } catch {
    return false;
  }
}

export function isPublicAuthUrl(url: string): boolean {
  try {
    return PUBLIC_AUTH_PATHS.includes(new URL(url, apiOrigin()).pathname);
  } catch {
    return false;
  }
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!isApiOriginUrl(req.url) || isPublicAuthUrl(req.url)) return next(req);

  const token = inject(SessionStore).bearerToken();
  if (token === null) return next(req);

  return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
};
