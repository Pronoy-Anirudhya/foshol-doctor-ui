import { isDevMode } from '@angular/core';
import {
  MissingTranslationHandler,
  type MissingTranslationHandlerParams,
  type StrictTranslation,
} from '@ngx-translate/core';
import { BN_CATALOGUE } from './bn-catalogue';

/**
 * WEB-UX-014 — a key missing from the active catalogue falls back to Bangla, and renders as a
 * visibly marked raw key outside production builds. A silently blank label is the failure mode
 * that survives to the demo.
 *
 * The real guarantee is scripts/check-i18n.mjs, which fails the build on any key used in a
 * template and absent from the catalogues — so a missing key cannot reach production at all.
 * This handler is the safety net, not the mechanism.
 */
export class BanglaFallbackMissingTranslationHandler extends MissingTranslationHandler {
  override handle(params: MissingTranslationHandlerParams): StrictTranslation {
    const bangla = BN_CATALOGUE[params.key];
    if (bangla !== undefined) return bangla;
    return isDevMode() ? `⟦${params.key}⟧` : '';
  }
}
