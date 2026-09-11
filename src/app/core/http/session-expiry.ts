import type { Router } from '@angular/router';
import type { SessionStore } from '../auth/session-store';

/** WEB-FR-001 route groups. The officer console and the admin page share one login. */
const OFFICER_SURFACES: readonly string[] = ['/officer', '/admin'];
const OFFICER_LOGIN = '/auth/officer';
const FARMER_LOGIN = '/auth/farmer';

function loginFor(currentUrl: string): string {
  return OFFICER_SURFACES.some((prefix) => currentUrl.startsWith(prefix))
    ? OFFICER_LOGIN
    : FARMER_LOGIN;
}

/**
 * The URL the user is on — or, before the first navigation has ever completed, the one they are
 * on their way to. A session restored after a reload (`DEVIATIONS.md` D-37) makes requests at
 * bootstrap, so a `401` can land while `Router.url` is still `/`, which would send an officer to
 * the farmer login and retain `/` as the route to restore.
 */
function attemptedUrl(router: Router): string {
  const navigation = router.navigated ? null : router.getCurrentNavigation();
  return navigation ? router.serializeUrl(navigation.extractedUrl) : router.url;
}

/**
 * WEB-FR-013 — a `401` clears the session, returns to the current surface's login and retains the
 * attempted route.
 *
 * One function, two callers: `problemInterceptor`, which sees every `HttpClient` response, and
 * `RedirectedBlobFetcher`, whose media requests cannot go through `HttpClient`
 * (`DEVIATIONS.md` D-38). An expired session therefore ends the same way whichever request found
 * out first.
 */
export function expireSession(router: Router, session: SessionStore): void {
  const attempted = attemptedUrl(router);
  session.rememberIntendedUrl(attempted);
  session.clear();
  void router.navigateByUrl(loginFor(attempted));
}
