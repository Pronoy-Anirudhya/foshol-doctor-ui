import type { Provider } from '@angular/core';
import {
  provideMissingTranslationHandler,
  provideTranslateLoader,
  provideTranslateService,
} from '@ngx-translate/core';
import { APP_CONFIG } from '../config/app-config';
import { CatalogueLoader } from './catalogue-loader';
import { BanglaFallbackMissingTranslationHandler } from './missing-translation.handler';

/** WEB-NFR-004 / WEB-UX-011 — runtime BN/EN catalogues, Bangla as both default and fallback. */
export function provideI18n(): Provider[] {
  return provideTranslateService({
    lang: APP_CONFIG.i18n.defaultLocale,
    fallbackLang: APP_CONFIG.i18n.defaultLocale,
    loader: provideTranslateLoader(CatalogueLoader),
    missingTranslationHandler: provideMissingTranslationHandler(
      BanglaFallbackMissingTranslationHandler,
    ),
  });
}
