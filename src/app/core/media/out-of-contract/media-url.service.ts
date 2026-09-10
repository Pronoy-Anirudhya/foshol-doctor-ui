/* ═══════════════════════════════════════════════════════════════════════════════════════════
   ⚠  OUT OF CONTRACT — DEVIATION D-02  ⚠

   THIS IS THE ONLY FILE IN THE APPLICATION THAT HAND-WRITES A REQUEST PATH.

   Departs from:
     WEB-API-001  the frontend calls the backend exclusively through src/app/generated/ and
                  never constructs a request URL by string concatenation.
     WEB-NFR-006  an operation absent from the generated client is a blocker, not something to
                  hand-write around.

   Both departures are recorded in DEVIATIONS.md (D-02) and explained in the README beside this
   file. The blocker HAS been raised; this file exists because the demo beat has to work while
   it is open.

   Why it exists: GET …/images/{imageId}/content answers 302 towards a presigned MinIO URL on a
   DIFFERENT ORIGIN and requires a bearer token that <img src> cannot carry. The undocumented
   …/url sibling returns that presigned URL as JSON instead, which binds straight to <img [src]>
   as a plain no-CORS subresource: MinIO needs no CORS configuration, and the JWT provably never
   leaves the API origin (WEB-SEC-003). Confirmed against the live server: MinIO answers a
   presigned GET that ALSO carries an Authorization header with 400 InvalidRequest, "request has
   multiple authentication types" — so sending the bearer there is not merely forbidden, it
   breaks the load.

   UNBLOCK: add the two operations and a PresignedUrlView schema to docs/openapi/foshol-api.yaml
   (owner: agent A1 — the file is frozen, 00-common §12.1), run `npm run api:gen`, then DELETE
   this directory and point SecureMediaService at the generated CasesService.
   ═══════════════════════════════════════════════════════════════════════════════════════════ */

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { apiOrigin } from '../../config/runtime-config';

/**
 * The record the server returns, verified field-for-field against the running backend and
 * against `intake/application/query/PresignedUrlView.java`:
 *
 *     public record PresignedUrlView(String url, Instant expiresAt) {}
 *
 * `expiresAt` is an ISO-8601 instant in UTC, e.g. `2026-09-07T18:26:02.387445Z`. There is no
 * third field; do not speculate one.
 */
export interface PresignedUrlView {
  readonly url: string;
  readonly expiresAt: string;
}

/**
 * Which stored object to presign.
 *
 * These two strings are wire values, not user-visible text, so WEB-UX-013 does not apply. They
 * are lowercase because the server compares against the lowercase literal (see below).
 */
export type ImageVariant = 'derivative' | 'original';

/** The derivative is what a thumbnail, a queue row and a card want. */
export const IMAGE_VARIANT_DERIVATIVE: ImageVariant = 'derivative';
/** The original is what the zoom view wants, and only the zoom view. */
export const IMAGE_VARIANT_ORIGINAL: ImageVariant = 'original';

const CASE_ID_TOKEN = '{caseId}';
const IMAGE_ID_TOKEN = '{imageId}';

const IMAGE_URL_PATH = '/api/v1/cases/{caseId}/images/{imageId}/url';
const AUDIO_URL_PATH = '/api/v1/cases/{caseId}/audio/url';

const VARIANT_PARAM = 'variant';

@Injectable({ providedIn: 'root' })
export class MediaUrlService {
  private readonly http = inject(HttpClient);

  /**
   * ALWAYS pass `variant` explicitly. Never let the server default decide.
   *
   * The two sibling endpoints disagree in BOTH directions — from `CaseController.java`:
   *
   *   …/content   defaultValue = "DERIVATIVE",  derivative = !"ORIGINAL".equalsIgnoreCase(v)
   *   …/url       defaultValue = "original",    derivative =  "derivative".equalsIgnoreCase(v)
   *
   * So `/content` defaults to the derivative and treats anything that is not `ORIGINAL` as one,
   * while `/url` defaults to the ORIGINAL and switches to the derivative only for the word
   * `derivative`. A caller that omits the parameter here — or that ports a working `/content`
   * call across — silently downloads the full-size original for every thumbnail in the queue.
   *
   * (`CaseImageUrlQueryHandler` also falls back to the original object key when no derivative
   * was ever stored, so today both variants can presign the same object. That is the server's
   * business; the client still states which one it is asking for.)
   */
  imageUrl(caseId: string, imageId: string, variant: ImageVariant): Promise<PresignedUrlView> {
    const path = IMAGE_URL_PATH.replace(CASE_ID_TOKEN, encodeURIComponent(caseId)).replace(
      IMAGE_ID_TOKEN,
      encodeURIComponent(imageId),
    );
    const params = new HttpParams().set(VARIANT_PARAM, variant);
    return firstValueFrom(this.http.get<PresignedUrlView>(this.absolute(path), { params }));
  }

  /**
   * WEB-FR-213 — the officer's audio player. The frozen OpenAPI carries no audio-content
   * operation at all; `docs/handover/frontend-demo-api.md` §15 says to raise a blocker rather
   * than invent one, and D-02 is that blocker raised.
   *
   * Answers 404 `ERR_AUDIO_NOT_FOUND` when the case has no audio, which is the normal case for
   * a photograph-only submission and is why the player renders nothing rather than an error.
   */
  audioUrl(caseId: string): Promise<PresignedUrlView> {
    const path = AUDIO_URL_PATH.replace(CASE_ID_TOKEN, encodeURIComponent(caseId));
    return firstValueFrom(this.http.get<PresignedUrlView>(this.absolute(path)));
  }

  /**
   * Resolving against the configured API origin keeps every request this service makes on that
   * one origin — which is what makes the WEB-SEC-003 claim checkable by reading this file. The
   * bearer is added downstream by `authInterceptor`, which applies the same origin test.
   */
  private absolute(path: string): string {
    return new URL(path, apiOrigin()).toString();
  }
}
