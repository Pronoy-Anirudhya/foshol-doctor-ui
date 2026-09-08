import { TestBed } from '@angular/core/testing';
import {
  TranslateLoader,
  provideTranslateLoader,
  provideTranslateService,
  type TranslationObject,
} from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { BN_CATALOGUE } from '../../../core/i18n/bn-catalogue';
import { CandidateSourceChip, type CandidateSource } from './candidate-source-chip';

class BanglaCatalogueLoader extends TranslateLoader {
  override getTranslation(): Observable<TranslationObject> {
    return of(BN_CATALOGUE as TranslationObject);
  }
}

const SOURCES: readonly CandidateSource[] = ['MODEL', 'KB', 'MERGED'];

describe('CandidateSourceChip', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CandidateSourceChip],
      providers: [
        provideTranslateService({
          lang: 'bn',
          fallbackLang: 'bn',
          loader: provideTranslateLoader(BanglaCatalogueLoader),
        }),
      ],
    }).compileComponents();
  });

  async function render(source: CandidateSource) {
    const fixture = TestBed.createComponent(CandidateSourceChip);
    fixture.componentRef.setInput('source', source);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  for (const source of SOURCES) {
    it(`names ${source} in text and in a glyph`, async () => {
      const host = await render(source);

      expect(host.getAttribute('data-source')).toBe(source);
      expect(host.querySelector('.cs-text')?.textContent?.trim()).toBe(
        BN_CATALOGUE[`badge.source.${source}`],
      );
      expect(host.querySelector('svg.cs-glyph')?.children.length).toBeGreaterThan(0);
    });
  }
});
