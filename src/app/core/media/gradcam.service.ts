import { inject, Injectable } from '@angular/core';
import { apiOrigin } from '../config/runtime-config';
import { HTTP_STATUS, type ProblemView } from '../errors/problem';
import { AnalysisService } from '../../generated/services/analysis.service';
import { MediaFetchError, RedirectedBlobFetcher } from './redirected-blob';

/**
 * WEB-FR-211 — the Grad-CAM overlay for a case's primary image.
 *
 * `GET /api/v1/cases/{caseId}/gradcam` answers `302` towards a presigned PNG, never a JSON body,
 * so there is no URL to bind to `<img [src]>`. The overlay is fetched with the bearer by
 * `RedirectedBlobFetcher` — which carries the whole WEB-SEC-003 argument — and turned into a
 * blob object URL here.
 *
 * WEB-API-001, honoured in spirit: the path is not hand-written. It is the generated
 * `AnalysisService.GetCaseGradcamPath` constant, expanded by template substitution, so when the
 * operation moves in the OpenAPI snapshot this file moves with it. (The generated
 * `getCaseGradcam()` method itself is unusable: it is typed `Promise<void>` because the operation
 * declares a 302 with no body.)
 *
 * WEB-DATA-021 — nothing here is persisted. The object URL lives in the component that asked for
 * it and is revoked when that component is destroyed.
 */

/**
 * There is no overlay to offer: the case has none (`404`), the session ended (`401`, already
 * handled by `expireSession`), or the request never became an HTTP exchange (offline, blocked).
 * The caller hides the toggle for every one of them — WEB-FR-212 forbids a disabled or broken
 * control.
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

/**
 * The overlay exists but could not be served — `503 ERR_STORAGE_UNAVAILABLE`, or anything else
 * the server answered with. Carries the problem so the case detail can show its `title`,
 * `detail` and `correlationId` (WEB-FR-005) while the photograph stays where it is.
 */
export class GradcamFailedError extends Error {
  readonly problem: ProblemView;

  constructor(problem: ProblemView) {
    super(`gradcam failed: ${problem.status}`);
    this.name = 'GradcamFailedError';
    this.problem = problem;
  }
}

const CASE_ID_TOKEN = '{caseId}';

/** Answers that mean "nothing to offer" rather than "something went wrong". */
const UNAVAILABLE_STATUSES: ReadonlySet<number> = new Set<number>([
  HTTP_STATUS.networkFailure,
  HTTP_STATUS.unauthorised,
  HTTP_STATUS.notFound,
]);

@Injectable({ providedIn: 'root' })
export class GradcamService {
  private readonly fetcher = inject(RedirectedBlobFetcher);

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
   * @throws GradcamFailedError when there is one but the server could not serve it.
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
    try {
      return await this.fetcher.fetchBlob(this.gradcamUrl(caseId));
    } catch (error: unknown) {
      if (
        error instanceof MediaFetchError &&
        error.problem !== null &&
        !UNAVAILABLE_STATUSES.has(error.status)
      ) {
        throw new GradcamFailedError(error.problem);
      }
      throw new GradcamUnavailableError(
        error instanceof MediaFetchError ? error.status : HTTP_STATUS.networkFailure,
      );
    }
  }

  private gradcamUrl(caseId: string): string {
    const path = AnalysisService.GetCaseGradcamPath.replace(
      CASE_ID_TOKEN,
      encodeURIComponent(caseId),
    );
    return new URL(path, apiOrigin()).toString();
  }
}
