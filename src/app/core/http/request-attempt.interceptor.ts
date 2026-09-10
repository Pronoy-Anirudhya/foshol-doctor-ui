import { HttpContextToken, type HttpInterceptorFn } from '@angular/common/http';
import { CORRELATION_ID_HEADER } from '../errors/problem';
import { isApiOriginUrl } from './auth.interceptor';

/**
 * Two per-request attributes that the generated client has no other way to express.
 *
 * `ng-openapi-gen` builds every request from `RequestBuilder` and forwards exactly one thing a
 * caller can influence: an `HttpContext`. So a per-call timeout and a per-attempt correlation id
 * are carried as context tokens and applied here, rather than by hand-building a request — which
 * would mean hand-writing a URL (`WEB-API-001`).
 *
 * **Timeout.** `WEB-FR-404` wants a real answer on a bad connection rather than a spinner that
 * never resolves. Angular's fetch backend implements `HttpRequest.timeout` by aborting the
 * request, so the socket is released rather than the response merely ignored. Zero — the default
 * for every request in the application — means no client timeout at all; only a caller that has
 * a considered value sets one.
 *
 * **Correlation id.** `correlationIdInterceptor` deliberately never mints an id: it quotes back
 * the last one the server gave us so a submit → analyse → review chain shares one id
 * (`WEB-FR-006`). That is right for a chain and wrong for the start of one. A farmer's FAQ
 * lookup is a NEW interaction each time it is attempted, and the id printed on its failure panel
 * has to be the id of that attempt, not of whatever the farmer did previously. A caller that
 * sets this token supplies the id for its own attempt; `correlationIdInterceptor` sees the
 * header already present and leaves it alone, so this must run BEFORE it.
 */
const NO_TIMEOUT = 0;
const EMPTY = 0;

/** Milliseconds before the request is aborted. 0 (the default) means "no client timeout". */
export const REQUEST_TIMEOUT_MS = new HttpContextToken<number>(() => NO_TIMEOUT);

/** A correlation id minted by the caller for this one attempt, or null to use the remembered one. */
export const ATTEMPT_CORRELATION_ID = new HttpContextToken<string | null>(() => null);

export const requestAttemptInterceptor: HttpInterceptorFn = (req, next) => {
  // Never decorate a presigned object-store URL (`WEB-SEC-003`).
  if (!isApiOriginUrl(req.url)) return next(req);

  const timeoutMs = req.context.get(REQUEST_TIMEOUT_MS);
  const attemptId = req.context.get(ATTEMPT_CORRELATION_ID);

  let outgoing = req;
  if (timeoutMs > NO_TIMEOUT) outgoing = outgoing.clone({ timeout: timeoutMs });
  if (attemptId !== null && attemptId.length > EMPTY) {
    outgoing = outgoing.clone({ setHeaders: { [CORRELATION_ID_HEADER]: attemptId } });
  }
  return next(outgoing);
};
