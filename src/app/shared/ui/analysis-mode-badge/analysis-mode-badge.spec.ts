import { TestBed } from '@angular/core/testing';
import {
  TranslateLoader,
  provideTranslateLoader,
  provideTranslateService,
  type TranslationObject,
} from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { BN_CATALOGUE } from '../../../core/i18n/bn-catalogue';
import type { AnalysisMode } from '../../../generated/models/analysis-mode';
import { AnalysisModeBadge } from './analysis-mode-badge';

class BanglaCatalogueLoader extends TranslateLoader {
  override getTranslation(): Observable<TranslationObject> {
    return of(BN_CATALOGUE as TranslationObject);
  }
}

describe('AnalysisModeBadge (WEB-FR-216, COMMON-UX-001)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AnalysisModeBadge],
      providers: [
        provideTranslateService({
          lang: 'bn',
          fallbackLang: 'bn',
          loader: provideTranslateLoader(BanglaCatalogueLoader),
        }),
      ],
    }).compileComponents();
  });

  async function render(mode: AnalysisMode) {
    const fixture = TestBed.createComponent(AnalysisModeBadge);
    fixture.componentRef.setInput('mode', mode);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  for (const mode of ['LIVE', 'REPLAY'] as const) {
    it(`renders ${mode} as text, so a fixture can never be mistaken for live inference`, async () => {
      const host = await render(mode);

      expect(host.getAttribute('data-mode')).toBe(mode);
      expect(host.querySelector('.am-text')?.textContent?.trim()).toBe(
        BN_CATALOGUE[`badge.analysisMode.${mode}`],
      );
    });
  }

  it('gives LIVE a pulsing indicator and REPLAY an archival glyph', async () => {
    expect((await render('LIVE')).querySelector('.am-live')).not.toBeNull();
    expect((await render('LIVE')).querySelector('svg.am-glyph')).toBeNull();
    expect((await render('REPLAY')).querySelector('svg.am-glyph')).not.toBeNull();
    expect((await render('REPLAY')).querySelector('.am-live')).toBeNull();
  });
});
