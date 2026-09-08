import { TestBed } from '@angular/core/testing';
import {
  TranslateLoader,
  provideTranslateLoader,
  provideTranslateService,
  type TranslationObject,
} from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { BN_CATALOGUE } from '../../../core/i18n/bn-catalogue';
import { MatcherChip, type SymptomMatcher } from './matcher-chip';

class BanglaCatalogueLoader extends TranslateLoader {
  override getTranslation(): Observable<TranslationObject> {
    return of(BN_CATALOGUE as TranslationObject);
  }
}

const MATCHERS: readonly SymptomMatcher[] = ['VECTOR', 'FUZZY', 'MANUAL'];

describe('MatcherChip (WEB-FR-214)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MatcherChip],
      providers: [
        provideTranslateService({
          lang: 'bn',
          fallbackLang: 'bn',
          loader: provideTranslateLoader(BanglaCatalogueLoader),
        }),
      ],
    }).compileComponents();
  });

  async function render(matcher: SymptomMatcher, score = 0.82) {
    const fixture = TestBed.createComponent(MatcherChip);
    fixture.componentRef.setInput('matcher', matcher);
    fixture.componentRef.setInput('score', score);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  for (const matcher of MATCHERS) {
    it(`names ${matcher} in text — a fuzzy match is not the same claim as a vector match`, async () => {
      const host = await render(matcher);

      expect(host.getAttribute('data-matcher')).toBe(matcher);
      expect(host.querySelector('.mc-text')?.textContent?.trim()).toBe(
        BN_CATALOGUE[`badge.matcher.${matcher}`],
      );
    });
  }

  it('renders the score as text beside the matcher', async () => {
    const host = await render('VECTOR', 0.45);
    expect(host.querySelector('[data-testid="matcher-score"]')?.textContent).toContain('45%');
  });

  it('gives every matcher a distinct glyph', async () => {
    const shapes = new Set<string>();
    for (const matcher of MATCHERS) {
      shapes.add((await render(matcher)).querySelector('svg.mc-glyph')?.outerHTML ?? '');
    }
    expect(shapes.size).toBe(MATCHERS.length);
  });
});
