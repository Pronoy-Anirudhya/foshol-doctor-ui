import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { SessionStore } from '../auth/session-store';
import {
  CORRELATION_ID_HEADER,
  HTTP_STATUS,
  toProblemView,
  type ProblemView,
} from '../errors/problem';
import { isApiOriginUrl } from '../http/auth.interceptor';
import { expireSession } from '../http/session-expiry';

/**
 * The one way this application fetches media that the API serves as a `302` into the object
 * store: the officer case detail's photographs (`GET …/images/{imageId}/content`) and the
 * Grad-CAM overlay (`GET …/gradcam`) — `DEVIATIONS.md` D-38.
 *
 * An `<img src>` cannot carry the bearer, and the JWT is not a cookie (WEB-SEC-001), so the API
 * path can never be an image source. The request is made here instead, with the bearer, the
 * redirect is followed, and the caller turns the bytes into a `blob:` object URL it owns.
 *
 * WEB-SEC-003 — `Authorization` is set on exactly one URL, asserted to be the API origin before
 * anything is sent. The browser drops it when it follows the cross-origin redirect, and MinIO
 * answers the redirected request under its default CORS policy. Sending the bearer to MinIO
 * ourselves would not merely be forbidden: MinIO rejects a presigned GET that also carries one
 * with 400 `InvalidRequest`.
 *
 * Deliberately `fetch`, not `HttpClient`. The interceptors add `X-Correlation-Id` and
 * `Accept-Language`, which — unlike `Authorization` — a browser DOES carry across a redirect,
 * turning the object-store GET into a preflighted request MinIO was never configured for. This
 * request sends one header. What the interceptors would have done on failure happens here: an
 * API `401` ends the session through the same `expireSession`, and a problem document is reduced
 * by the same `toProblemView`.
 *
 * WEB-DATA-021 — nothing here is persisted, and no presigned URL is ever seen by the caller.
 */

/** The request failed. `problem` is null when it never became an HTTP exchange. */
export class MediaFetchError extends Error {
  readonly status: number;
  readonly problem: ProblemView | null;

  constructor(status: number, problem: ProblemView | null) {
    super(`media fetch failed: ${status}`);
    this.name = 'MediaFetchError';
    this.status = status;
    this.problem = problem;
  }
}

const AUTHORIZATION_HEADER = 'Authorization';
const BEARER_PREFIX = 'Bearer ';
const CONTENT_TYPE_HEADER = 'Content-Type';
/** `application/json` and `application/problem+json` alike. */
const JSON_CONTENT = 'json';

@Injectable({ providedIn: 'root' })
export class RedirectedBlobFetcher {
  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);

  /** @throws MediaFetchError for every failure, network and HTTP alike. */
  async fetchBlob(url: string): Promise<Blob> {
    // Fails closed: a misconfigured origin must not hand the bearer to an unexpected host.
    if (!isApiOriginUrl(url)) throw new MediaFetchError(HTTP_STATUS.networkFailure, null);

    let response = await this.attempt(url);

    // COMMON-SEC-016 — a presigned URL is time-limited. One that lapsed between the 302 and the
    // object-store GET (a slow link, a skewed clock) earns exactly one fresh redirect.
    if (response.status === HTTP_STATUS.forbidden && response.redirected) {
      response = await this.attempt(url);
    }

    if (response.ok) return response.blob();

    // Only the API's own 401 means the session is over; the object store never sees the bearer.
    if (response.status === HTTP_STATUS.unauthorised && !response.redirected) {
      expireSession(this.router, this.session);
    }
    throw new MediaFetchError(response.status, await problemOf(response));
  }

  private async attempt(url: string): Promise<Response> {
    const headers = new Headers();
    const token = this.session.bearerToken();
    if (token !== null) headers.set(AUTHORIZATION_HEADER, BEARER_PREFIX + token);

    try {
      return await fetch(url, {
        headers,
        // No cookie is part of this exchange, and a credentialed cross-origin request would
        // fail CORS at the object store outright.
        credentials: 'omit',
        // The 302 into the object store is the entire mechanism.
        redirect: 'follow',
      });
    } catch {
      throw new MediaFetchError(HTTP_STATUS.networkFailure, null);
    }
  }
}

/** The same reduction every `HttpClient` failure gets, so a media failure reads like any other. */
async function problemOf(response: Response): Promise<ProblemView> {
  let body: unknown = null;
  if ((response.headers?.get(CONTENT_TYPE_HEADER) ?? '').includes(JSON_CONTENT)) {
    try {
      body = await response.json();
    } catch {
      body = null;
    }
  }
  const correlationId = response.headers?.get(CORRELATION_ID_HEADER) ?? null;
  return toProblemView(
    new HttpErrorResponse({
      status: response.status,
      error: body,
      headers: new HttpHeaders(
        correlationId === null ? {} : { [CORRELATION_ID_HEADER]: correlationId },
      ),
    }),
  );
}
