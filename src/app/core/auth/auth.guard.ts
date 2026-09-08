import { inject } from '@angular/core';
import { Router, type CanMatchFn, type Route, type UrlSegment } from '@angular/router';
import type { Role } from './jwt';
import { SessionStore } from './session-store';

/**
 * The route surfaces of WEB-FR-001, in one place.
 *
 * These are ROUTE PATHS, not user-visible strings, so WEB-UX-013 does not apply to them.
 * They live here rather than in a file of their own because `app.routes.ts` already imports
 * this module eagerly: putting them anywhere else would either add a fourth eager module or
 * drag `AuthFacade` (and with it the generated `AuthService`) into the initial bundle, which
 * WEB-FR-004 exists to avoid.
 */
export const AUTH_SURFACES = {
  farmerLogin: '/auth/farmer',
  officerLogin: '/auth/officer',
  notPermitted: '/not-permitted',
} as const;

const HOME_BY_ROLE: Readonly<Record<Role, string>> = {
  FARMER: '/farmer',
  OFFICER: '/officer',
  ADMIN: '/admin',
};

/** The two route groups served by the console login (`WEB-FR-001`, handover §2). */
const CONSOLE_ROOTS: readonly string[] = ['officer', 'admin'];

/** Where a signed-in principal belongs when no intended URL was retained. */
export function homePathForRole(role: Role | null): string {
  return role === null ? AUTH_SURFACES.farmerLogin : HOME_BY_ROLE[role];
}

/**
 * WEB-FR-002 — "that surface's login". A `/officer` or `/admin` attempt returns to the console
 * login; everything else returns to the farmer login. This reads the ATTEMPTED PATH only to
 * choose a login screen — never to decide a role, which comes from the JWT claim alone
 * (`role.guard.ts`, handover §2).
 */
export function loginPathForUrl(url: string): string {
  const firstSegment = /^\/?([^/?#]*)/.exec(url)?.[1] ?? '';
  return CONSOLE_ROOTS.includes(firstSegment)
    ? AUTH_SURFACES.officerLogin
    : AUTH_SURFACES.farmerLogin;
}

/**
 * WEB-FR-002 — an unauthenticated request to a guarded route is redirected to that surface's
 * login, and the attempted URL is retained so login can restore it.
 *
 * `CanMatchFn` rather than `CanActivateFn` on purpose: a failed `canMatch` leaves the lazy
 * chunk unloaded, so the officer console is never fetched for an anonymous visitor
 * (`WEB-FR-004`).
 */
export const authGuard: CanMatchFn = (_route: Route, segments: UrlSegment[]) => {
  const session = inject(SessionStore);
  const router = inject(Router);

  if (session.isAuthenticated()) return true;

  const attempted = attemptedUrl(router, segments);
  session.rememberIntendedUrl(attempted);
  return router.parseUrl(loginPathForUrl(attempted));
};

/**
 * During `canMatch` the router has not committed the navigation, so `Router.url` still holds
 * the PREVIOUS route. The in-flight navigation's extracted URL is the attempted one, and it
 * keeps the query string and fragment that `segments` alone would drop.
 */
function attemptedUrl(router: Router, segments: UrlSegment[]): string {
  const navigation = router.getCurrentNavigation();
  if (navigation) return router.serializeUrl(navigation.extractedUrl);
  return `/${segments.map((segment) => segment.path).join('/')}`;
}
