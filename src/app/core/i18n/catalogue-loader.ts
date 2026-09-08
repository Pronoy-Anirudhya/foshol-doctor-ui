import { HttpClient } from '@angular/common/http';
import { inject } from '@angular/core';
import { TranslateLoader, type TranslationObject } from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { APP_CONFIG } from '../config/app-config';
import { BN_CATALOGUE } from './bn-catalogue';

/**
 * A ~15-line loader instead of the @ngx-translate/http-loader package, because WEB-NFR-007
 * makes every added dependency a blocker rather than a choice.
 *
 * The Bangla catalogue is inlined at build time (see bn-catalogue.ts), so the language of
 * record is always present with no network round trip — which is what makes the WEB-UX-014
 * fallback and the offline path (WEB-FR-402) genuinely reliable rather than best-effort.
 */
export class CatalogueLoader extends TranslateLoader {
  private readonly http = inject(HttpClient);

  override getTranslation(lang: string): Observable<TranslationObject> {
    if (lang === APP_CONFIG.i18n.defaultLocale) return of(BN_CATALOGUE as TranslationObject);

    return this.http
      .get<TranslationObject>(`${APP_CONFIG.i18n.cataloguePath}${lang}.json`)
      .pipe(catchError(() => of(BN_CATALOGUE as TranslationObject)));
  }
}
