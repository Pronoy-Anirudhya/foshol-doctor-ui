import { HttpResponse, type HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { tap } from 'rxjs';
import { CORRELATION_ID_HEADER } from '../errors/problem';
import { isApiOriginUrl } from './auth.interceptor';

/**
 * WEB-FR-006 — `X-Correlation-Id` is sent when continuing a known interaction and the returned
 * value is adopted otherwise (COMMON-NFR-016).
 *
 * The client never mints an id. The server owns the value; we remember the last one it gave us
 * and quote it back, so a submit → analyse → review → advise chain shares one id and a failure
 * anywhere in it is traceable from the single id shown on screen (WEB-FR-005). The backend
 * exposes the header through CORS (handover §1).
 */

/**
 * "The correlation id of the flow currently in progress." A signal rather than a plain field so
 * an error page can render it reactively without a subscription (WEB-NFR-002).
 */
@Injectable({ providedIn: 'root' })
export class CorrelationIdStore {
  private readonly _current = signal<string | null>(null);

  readonly current = this._current.asReadonly();

  adopt(id: string | null): void {
    if (id !== null && id.length > 0) this._current.set(id);
  }

  /** Called when a flow ends or a session is cleared, so ids never bleed between users. */
  reset(): void {
    this._current.set(null);
  }
}

export const correlationIdInterceptor: HttpInterceptorFn = (req, next) => {
  if (!isApiOriginUrl(req.url)) return next(req);

  const store = inject(CorrelationIdStore);
  const known = store.current();
  const outgoing =
    known !== null && !req.headers.has(CORRELATION_ID_HEADER)
      ? req.clone({ setHeaders: { [CORRELATION_ID_HEADER]: known } })
      : req;

  return next(outgoing).pipe(
    tap({
      next: (event) => {
        if (event instanceof HttpResponse) store.adopt(event.headers.get(CORRELATION_ID_HEADER));
      },
      // A failure is exactly when the id matters most, so it is adopted from errors too.
      error: (err: unknown) => {
        const headers = (err as Partial<HttpErrorResponse>).headers;
        store.adopt(headers?.get(CORRELATION_ID_HEADER) ?? null);
      },
    }),
  );
};
