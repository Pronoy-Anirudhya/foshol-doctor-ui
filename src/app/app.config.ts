import {
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
  type ApplicationConfig,
} from '@angular/core';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding, withViewTransitions } from '@angular/router';
import { ApiConfiguration } from './generated/api-configuration';
import { apiBaseUrl } from './core/config/runtime-config';
import { acceptLanguageInterceptor } from './core/http/accept-language.interceptor';
import { authInterceptor } from './core/http/auth.interceptor';
import { correlationIdInterceptor } from './core/http/correlation-id.interceptor';
import { problemInterceptor } from './core/http/problem.interceptor';
import { requestAttemptInterceptor } from './core/http/request-attempt.interceptor';
import { provideI18n } from './core/i18n/i18n.providers';
import { provideSse } from './core/sse/sse.providers';
import { SESSION_TEARDOWN } from './core/auth/auth-facade';
import { SessionStore } from './core/auth/session-store';
import { StoreTeardown } from './core/stores/store-teardown';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // zone.js is not installed at all; that absence is the proof zoneless is real.
    provideZonelessChangeDetection(),

    // withComponentInputBinding() delivers route params as signal inputs, which removes the
    // last place a component would otherwise need an RxJS subscription (WEB-NFR-003).
    provideRouter(routes, withComponentInputBinding(), withViewTransitions()),

    // Interceptor order matters: the per-attempt decorations go on first (a caller-minted
    // correlation id must already be on the request when correlationIdInterceptor decides
    // whether to quote the remembered one back), then language, then auth adds the bearer for
    // the API origin only, and problem sits outermost to see every response.
    provideHttpClient(
      withFetch(),
      withInterceptors([
        requestAttemptInterceptor,
        correlationIdInterceptor,
        acceptLanguageInterceptor,
        authInterceptor,
        problemInterceptor,
      ]),
    ),

    provideI18n(),

    // D-37 — a reload keeps this tab's session until the JWT expires. Synchronous, and app
    // initializers finish before the router's initial navigation, so the guards on the reloaded
    // URL already see the restored session instead of bouncing to the login.
    provideAppInitializer(() => inject(SessionStore).restore()),

    // SseClient is providedIn:'root' and therefore lazy, so without an eager initialiser the
    // effect that opens the stream on sign-in would never run and WEB-FR-351 would silently
    // not hold. One connection, opened at bootstrap, shared by every surface.
    provideSse(),

    // WEB-SEC-004 — sign-out empties every session-scoped store. Registered as a teardown
    // rather than called from AuthFacade directly so the dependency arrow keeps pointing away
    // from features: auth knows only the token, not what a case draft is.
    {
      provide: SESSION_TEARDOWN,
      multi: true,
      useFactory: () => {
        const stores = inject(StoreTeardown);
        return () => stores.clearAll();
      },
    },

    // The generated client's single base URL. Paths already carry /api/v1, so this must NOT.
    // Read at module scope, which is safe: /env.js is a classic script and has already run.
    // An empty string here is deliberate and means "same origin" — `RequestBuilder` builds
    // `this.rootUrl + path`, so '' yields '/api/v1/…' and the reverse proxy decides the host.
    { provide: ApiConfiguration, useValue: { rootUrl: apiBaseUrl() } satisfies ApiConfiguration },
  ],
};
