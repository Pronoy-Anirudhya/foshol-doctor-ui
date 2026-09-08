import { TestBed } from '@angular/core/testing';
import {
  TranslateLoader,
  provideTranslateLoader,
  provideTranslateService,
  type TranslationObject,
} from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { BN_CATALOGUE } from '../../core/i18n/bn-catalogue';
import { BnFallbackPipe } from './bn-fallback.pipe';

class BanglaCatalogueLoader extends TranslateLoader {
  override getTranslation(): Observable<TranslationObject> {
    return of(BN_CATALOGUE as TranslationObject);
  }
}

/** A disease name exactly as the knowledge base holds it (COMMON-CON-003). */
const CONTENT = 'ধানের ব্লাস্ট';

describe('BnFallbackPipe (WEB-UX-015, WEB-UX-016)', () => {
  let pipe: BnFallbackPipe;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideTranslateService({
          lang: 'bn',
          fallbackLang: 'bn',
          loader: provideTranslateLoader(BanglaCatalogueLoader),
        }),
      ],
    });
    pipe = TestBed.runInInjectionContext(() => new BnFallbackPipe());
  });

  it('appends the (bn) marker in English when the server flagged a fallback', () => {
    expect(pipe.transform(CONTENT, true, 'en')).toBe(`${CONTENT} (bn)`);
  });

  it('never translates or alters the value itself (WEB-UX-016)', () => {
    expect(pipe.transform(CONTENT, false, 'en')).toBe(CONTENT);
    expect(pipe.transform(CONTENT, true, 'bn')).toBe(CONTENT);
  });

  it('adds nothing to an empty or absent value', () => {
    expect(pipe.transform('', true, 'en')).toBe('');
    expect(pipe.transform(null, true, 'en')).toBe('');
    expect(pipe.transform(undefined, true, 'en')).toBe('');
  });
});
