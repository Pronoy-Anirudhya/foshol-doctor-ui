import { TestBed } from '@angular/core/testing';
import {
  TranslateLoader,
  provideTranslateLoader,
  provideTranslateService,
  type TranslationObject,
} from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { BN_CATALOGUE } from '../../../core/i18n/bn-catalogue';
import type { DecisionPath } from '../../../generated/models/decision-path';
import { DecisionPathBadge } from './decision-path-badge';

class BanglaCatalogueLoader extends TranslateLoader {
  override getTranslation(): Observable<TranslationObject> {
    return of(BN_CATALOGUE as TranslationObject);
  }
}

const PATHS: readonly DecisionPath[] = ['PRIMARY', 'SECONDARY', 'UNDETERMINED'];

describe('DecisionPathBadge (WEB-FR-215)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DecisionPathBadge],
      providers: [
        provideTranslateService({
          lang: 'bn',
          fallbackLang: 'bn',
          loader: provideTranslateLoader(BanglaCatalogueLoader),
        }),
      ],
    }).compileComponents();
  });

  async function render(path: DecisionPath) {
    const fixture = TestBed.createComponent(DecisionPathBadge);
    fixture.componentRef.setInput('path', path);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  for (const path of PATHS) {
    it(`renders ${path} exactly as received, as text and as a glyph (WEB-UX-044)`, async () => {
      const host = await render(path);

      expect(host.getAttribute('data-path')).toBe(path);
      expect(host.querySelector('.dp-text')?.textContent?.trim()).toBe(
        BN_CATALOGUE[`badge.decisionPath.${path}`],
      );
      // The glyph reinforces; it never carries the value alone.
      expect(host.querySelector('svg.dp-glyph')?.children.length).toBeGreaterThan(0);
      expect(host.querySelector('svg.dp-glyph')?.getAttribute('aria-hidden')).toBe('true');
    });
  }

  it('gives every value a distinct glyph', async () => {
    const shapes = new Set<string>();
    for (const path of PATHS) {
      shapes.add((await render(path)).querySelector('svg.dp-glyph')?.outerHTML ?? '');
    }
    expect(shapes.size).toBe(PATHS.length);
  });
});
