import { TestBed } from '@angular/core/testing';
import {
  TranslateLoader,
  provideTranslateLoader,
  provideTranslateService,
  type TranslationObject,
} from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { BN_CATALOGUE } from '../../../core/i18n/bn-catalogue';
import { SeverityBadge, type Severity } from './severity-badge';

class BanglaCatalogueLoader extends TranslateLoader {
  override getTranslation(): Observable<TranslationObject> {
    return of(BN_CATALOGUE as TranslationObject);
  }
}

const SEVERITIES: readonly Severity[] = ['NONE', 'LOW', 'MODERATE', 'HIGH', 'CRITICAL'];

describe('SeverityBadge (WEB-FR-156, WEB-UX-044)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SeverityBadge],
      providers: [
        provideTranslateService({
          lang: 'bn',
          fallbackLang: 'bn',
          loader: provideTranslateLoader(BanglaCatalogueLoader),
        }),
      ],
    }).compileComponents();
  });

  async function render(severity: Severity) {
    const fixture = TestBed.createComponent(SeverityBadge);
    fixture.componentRef.setInput('severity', severity);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  for (const severity of SEVERITIES) {
    it(`carries a text label and a shape for ${severity}`, async () => {
      const host = await render(severity);

      expect(host.getAttribute('data-severity')).toBe(severity);
      expect(host.querySelector('.sv-text')?.textContent?.trim()).toBe(
        BN_CATALOGUE[`badge.severity.${severity}`],
      );
      expect(host.querySelector('svg.sv-glyph')?.children.length).toBeGreaterThan(0);
    });
  }

  it('gives every severity a distinct shape, so the ordering survives greyscale', async () => {
    const shapes = new Set<string>();
    for (const severity of SEVERITIES) {
      shapes.add((await render(severity)).querySelector('svg.sv-glyph')?.outerHTML ?? '');
    }
    expect(shapes.size).toBe(SEVERITIES.length);
  });
});
