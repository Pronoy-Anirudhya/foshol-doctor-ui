import type { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { SessionStore } from '../auth/session-store';
import { ErrorBus } from '../errors/error-bus';
import { HTTP_STATUS, toProblemView } from '../errors/problem';
import { isPublicAuthUrl } from './auth.interceptor';

/**
 * The outermost interceptor: it sees every response, so every failure in the application is
 * reduced to one `ProblemView` in one place.
 *
 * WEB-FR-005 — the RFC 9457 document (COMMON-API-002) becomes a displayable view carrying its
 * `title`, `detail` and copyable `correlationId`.
 * WEB-FR-013 — a 401 clears the session, returns to the current surface's login and retains the
 * attempted route.
 * WEB-API-002 — a 404 means "not found or not yours"; nothing here infers existence from it,
 * which is why 404 has no special branch at all.
 *
 * The error is always rethrown. The bus is for ambient display (a banner, an error page); a
 * caller that must handle its own failure inline still gets the rejection.
 */

/** WEB-FR-001 route groups. The officer console and the admin page share one login. */
const OFFICER_SURFACES: readonly string[] = ['/officer', '/admin'];
const OFFICER_LOGIN = '/auth/officer';
const FARMER_LOGIN = '/auth/farmer';

function loginFor(currentUrl: string): string {
  return OFFICER_SURFACES.some((prefix) => currentUrl.startsWith(prefix))
    ? OFFICER_LOGIN
    : FARMER_LOGIN;
}

export const problemInterceptor: HttpInterceptorFn = (req, next) => {
  const bus = inject(ErrorBus);
  const session = inject(SessionStore);
  const router = inject(Router);

  return next(req).pipe(
    catchError((err: unknown) => {
      const problem = toProblemView(err);

      // A 401 from a login endpoint is the login failing — a wrong OTP or password — and the
      // form shows it inline. Bouncing the user to the login they are already on would erase
      // what they typed and hide the reason.
      if (problem.status === HTTP_STATUS.unauthorised && !isPublicAuthUrl(req.url)) {
        const attempted = router.url;
        session.rememberIntendedUrl(attempted);
        session.clear();
        void router.navigateByUrl(loginFor(attempted));
      }

      bus.report(problem);
      return throwError(() => err);
    }),
  );
};
