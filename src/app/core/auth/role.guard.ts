import { inject } from '@angular/core';
import { Router, type CanMatchFn } from '@angular/router';
import { AUTH_SURFACES } from './auth.guard';
import type { Role } from './jwt';
import { SessionStore } from './session-store';

/**
 * WEB-FR-001 / WEB-FR-003 — a route group only matches for a permitted role; anything else
 * lands on the "not permitted" page and no request is issued.
 *
 * The role comes from `SessionStore.role()`, which is seeded from the JWT `role` claim
 * (`jwt.ts`, handover §2) — NEVER from the URL. `COMMON-SEC-011` means the server enforces
 * this independently; the guard exists only so a farmer who follows an officer link gets a
 * calm explanation instead of a bare 403.
 *
 * As a `CanMatchFn` the lazy chunk for a forbidden group is never fetched (`WEB-FR-004`).
 */
export function roleGuard(allowed: readonly Role[]): CanMatchFn {
  return () => {
    const session = inject(SessionStore);
    const router = inject(Router);

    const role = session.role();
    if (role !== null && allowed.includes(role)) return true;

    return router.parseUrl(AUTH_SURFACES.notPermitted);
  };
}
