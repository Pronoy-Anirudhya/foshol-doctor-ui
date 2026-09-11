import { inject, Injectable } from '@angular/core';
import { apiOrigin } from '../config/runtime-config';
import type { GetCaseImage$Params } from '../../generated/fn/cases/get-case-image';
import { CasesService } from '../../generated/services/cases.service';
import { RedirectedBlobFetcher } from './redirected-blob';

/** The contract's own spelling (`ORIGINAL | DERIVATIVE`), taken from the generated params. */
export type CaseImageVariant = NonNullable<GetCaseImage$Params['variant']>;

/** What the officer's primary view asks for: the photograph as the farmer took it. */
export const CASE_IMAGE_ORIGINAL: CaseImageVariant = 'ORIGINAL';
/** What a thumbnail asks for. */
export const CASE_IMAGE_DERIVATIVE: CaseImageVariant = 'DERIVATIVE';

const CASE_ID_TOKEN = '{caseId}';
const IMAGE_ID_TOKEN = '{imageId}';
const VARIANT_PARAM = 'variant';

/**
 * WEB-FR-210 — the officer case detail's photographs, through the contract operation
 * `GET /api/v1/cases/{caseId}/images/{imageId}/content` (`DEVIATIONS.md` D-38).
 *
 * The operation answers `302` into the object store, so the bytes are fetched by
 * `RedirectedBlobFetcher` (bearer on the API hop only, WEB-SEC-003) and handed back as a
 * `blob:` object URL. The path is the generated `CasesService.GetCaseImagePath` constant
 * (WEB-API-001), and `variant` is ALWAYS sent: the server's default is the derivative, and a
 * default nobody wrote down is how a zoom view ends up showing a thumbnail.
 */
@Injectable({ providedIn: 'root' })
export class CaseImageContentService {
  private readonly fetcher = inject(RedirectedBlobFetcher);

  /**
   * Resolves to an object URL the caller OWNS and MUST pass back to `revoke()`.
   *
   * @throws MediaFetchError when the photograph cannot be fetched.
   */
  async load(caseId: string, imageId: string, variant: CaseImageVariant): Promise<string> {
    const blob = await this.fetcher.fetchBlob(this.contentUrl(caseId, imageId, variant));
    return URL.createObjectURL(blob);
  }

  /** Idempotent, and safe to call with a URL that was never created. */
  revoke(objectUrl: string | null): void {
    if (objectUrl === null) return;
    URL.revokeObjectURL(objectUrl);
  }

  private contentUrl(caseId: string, imageId: string, variant: CaseImageVariant): string {
    const path = CasesService.GetCaseImagePath.replace(
      CASE_ID_TOKEN,
      encodeURIComponent(caseId),
    ).replace(IMAGE_ID_TOKEN, encodeURIComponent(imageId));
    const url = new URL(path, apiOrigin());
    url.searchParams.set(VARIANT_PARAM, variant);
    return url.toString();
  }
}
