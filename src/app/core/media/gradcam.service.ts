import { inject, Injectable } from '@angular/core';
import { SessionStore } from '../auth/session-store';
import { apiOrigin } from '../config/runtime-config';
import { isApiOriginUrl } from '../http/auth.interceptor';
import { AnalysisService } from '../../generated/services/analysis.service';

/**
 * Grad-CAM is the one piece of case media that CANNOT go through `SecureMediaService`.
 *
 * `GET /api/v1/cases/{caseId}/gradcam` has no `/url` sibling in the running backend — it only
 * answers 302 towards a presigned PNG — so there is no JSON URL to bind to `<img [src]>`. The
 * overlay therefore has to be fetched with the bearer and turned into a blob object URL.
 *
 * WEB-API-001, honoured in spirit: the path is not hand-written. It is taken from the generated
 * `AnalysisService.GetCaseGradcamPath` constant and expanded by template substitution, so when
 * the operation moves in the OpenAPI snapshot this file moves with it. (The generated
 * `getCaseGradcam()` method itself is unusable here: it is typed `Promise<void>` because the
 * operation declares a 302 with no body, and it would give up control of `credentials` and
 * `redirect`.)
 *
 * WEB-SEC-003 — the `Authorization` header is set on exactly one URL, and that URL is asserted
 * to be the configured API origin before the request is made. Verified against the live stack:
 * the fetch completes as `type: "cors"` with a `200 image/png` body after the cross-origin
 * redirect to MinIO, because the browser drops `Authorization` on a cross-origin redirect and
 * MinIO's default CORS policy answers the redirected (origin-tainted) request with
 * `Access-Control-Allow-Origin: *`. Sending the bearer to MinIO ourselves would not merely be
 * forbidden — MinIO rejects a presigned GET carrying one with 400 `InvalidRequest`.
 *
 * WEB-DATA-021 — nothing here is persisted. The object URL lives in the component that asked
 * for it and is revoked when that component is destroyed.
 */

/**
 * Thrown when no overlay can be shown, for ANY reason: the case has none (404), the object is
 * gone, the cross-origin fetch was blocked, the network dropped.
 *
 * The caller must react the same way to all of them — WEB-FR-212 says HIDE the toggle rather
 * than show a disabled or broken control — so distinguishing the causes in the type would only
 * invite a caller to treat one of them as "show the toggle anyway".
 */
export class GradcamUnavailableError extends Error {
  /** 0 when the request never became an HTTP exchange (offline, blocked, aborted). */
  readonly status: number;

  constructor(status: number) {
    super(`gradcam unavailable: ${status}`);
    this.name = 'GradcamUnavailableError';
    this.status = status;
  }
}

const CASE_ID_TOKEN = '{caseId}';
/** Angular reports, and `fetch` rejects with, no status at all when nothing was exchanged. */
const NO_HTTP_EXCHANGE = 0;

@Injectable({ providedIn: 'root' })
export class GradcamService {
  private readonly session = inject(SessionStore);

  /**
   * De-duplicated per case, and holding the BLOB rather than the object URL: two components
   * asking for the same overlay must not share one object URL, because the first of them to be
   * destroyed would revoke the image out from under the second.
   */
  private readonly inflight = new Map<string, Promise<Blob>>();

  /**
   * Resolves to a `blob:` object URL for the overlay PNG.
   *
   * The caller OWNS the returned URL and MUST pass it back to `revoke()` when it is finished —
   * a blob object URL is a document-lifetime root, so a leaked one pins the whole PNG in memory
   * until the tab closes. `gradcam-view` does this from `DestroyRef.onDestroy`.
   *
   * @throws GradcamUnavailableError when there is no overlay to show.
   */
  async load(caseId: string): Promise<string> {
    const blob = await this.blobFor(caseId);
    return URL.createObjectURL(blob);
  }

  /** Idempotent, and safe to call with a URL that was never created. */
  revoke(objectUrl: string | null): void {
    if (objectUrl === null) return;
    URL.revokeObjectURL(objectUrl);
  }

  private blobFor(caseId: string): Promise<Blob> {
    const pending = this.inflight.get(caseId);
    if (pending !== undefined) return pending;

    const request = this.request(caseId).finally(() => {
      this.inflight.delete(caseId);
    });
    this.inflight.set(caseId, request);
    return request;
  }

  private async request(caseId: string): Promise<Blob> {
    const url = this.gradcamUrl(caseId);

    // WEB-SEC-003, asserted rather than assumed. The only way this fails is a misconfigured
    // APP_CONFIG.api.origin, and failing closed beats leaking a bearer to an unexpected host.
    if (!isApiOriginUrl(url)) throw new GradcamUnavailableError(NO_HTTP_EXCHANGE);

    const headers = new Headers();
    const token = this.session.bearerToken();
    if (token !== null) headers.set('Authorization', `Bearer ${token}`);

    let response: Response;
    try {
      response = await fetch(url, {
        headers,
        // No cookie is ever part of this exchange; the presigned URL carries its own
        // authorisation and a credentialed cross-origin request would fail CORS outright.
        credentials: 'omit',
        // The 302 into the object store is the entire mechanism, so it must be followed.
        redirect: 'follow',
      });
    } catch {
      throw new GradcamUnavailableError(NO_HTTP_EXCHANGE);
    }

    if (!response.ok) throw new GradcamUnavailableError(response.status);
    return response.blob();
  }

  private gradcamUrl(caseId: string): string {
    const path = AnalysisService.GetCaseGradcamPath.replace(
      CASE_ID_TOKEN,
      encodeURIComponent(caseId),
    );
    return new URL(path, apiOrigin()).toString();
  }
}
