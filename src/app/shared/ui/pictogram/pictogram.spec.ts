import { TestBed } from '@angular/core/testing';
import {
  TranslateLoader,
  provideTranslateLoader,
  provideTranslateService,
  type TranslationObject,
} from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { BN_CATALOGUE } from '../../../core/i18n/bn-catalogue';
import type { Disease } from '../../../generated/models/disease';
import type { Remedy } from '../../../generated/models/remedy';
import { CropIcon } from './crop-icon';
import { RemedyTypeIcon } from './remedy-type-icon';
import { SeverityGlyph } from './severity-glyph';

class BanglaCatalogueLoader extends TranslateLoader {
  override getTranslation(): Observable<TranslationObject> {
    return of(BN_CATALOGUE as TranslationObject);
  }
}

const SEVERITIES: readonly Disease['severity'][] = ['NONE', 'LOW', 'MODERATE', 'HIGH', 'CRITICAL'];
const REMEDY_TYPES: readonly Remedy['type'][] = ['CULTURAL', 'ORGANIC', 'BIOLOGICAL', 'CHEMICAL'];

describe('Pictograms (WEB-UX-042, WEB-UX-044)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        provideTranslateService({
          lang: 'bn',
          fallbackLang: 'bn',
          loader: provideTranslateLoader(BanglaCatalogueLoader),
        }),
      ],
    }).compileComponents();
  });

  describe('CropIcon', () => {
    async function render(iconKey: string | null, label = '') {
      const fixture = TestBed.createComponent(CropIcon);
      fixture.componentRef.setInput('iconKey', iconKey);
      fixture.componentRef.setInput('label', label);
      await fixture.whenStable();
      const svg = (fixture.nativeElement as HTMLElement).querySelector('svg');
      if (svg === null) throw new Error('no svg rendered');
      return svg;
    }

    for (const key of ['crop-rice', 'crop-tomato', 'crop-potato']) {
      it(`draws ${key} with meaningful alternative text`, async () => {
        const svg = await render(key);
        expect(svg.getAttribute('role')).toBe('img');
        expect(svg.getAttribute('aria-label')).toBe(BN_CATALOGUE[`shared.pictogram.crop.${key}`]);
        // Drawn, not lettered: no text node anywhere in the artwork.
        expect(svg.querySelector('text')).toBeNull();
        expect(svg.querySelectorAll('path, circle, ellipse').length).toBeGreaterThan(1);
      });
    }

    it('falls back to a generic drawing for a key this build has never seen', async () => {
      const svg = await render('crop-mustard');
      expect(svg.getAttribute('aria-label')).toBe(BN_CATALOGUE['shared.pictogram.crop.generic']);
      expect(svg.querySelectorAll('path').length).toBeGreaterThan(0);
    });

    it("prefers the server's own crop name for the alt text when given one", async () => {
      const svg = await render('crop-rice', 'ধান');
      expect(svg.getAttribute('aria-label')).toBe('ধান');
    });

    it('is hidden from assistive technology when an adjacent label already names it', async () => {
      const fixture = TestBed.createComponent(CropIcon);
      fixture.componentRef.setInput('iconKey', 'crop-rice');
      fixture.componentRef.setInput('decorative', true);
      await fixture.whenStable();
      const svg = (fixture.nativeElement as HTMLElement).querySelector('svg');
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
      expect(svg?.getAttribute('aria-label')).toBeNull();
    });
  });

  describe('SeverityGlyph', () => {
    it('gives every level a distinct shape as well as a distinct hue', async () => {
      const shapes = new Set<string>();
      for (const severity of SEVERITIES) {
        const fixture = TestBed.createComponent(SeverityGlyph);
        fixture.componentRef.setInput('severity', severity);
        await fixture.whenStable();
        const svg = (fixture.nativeElement as HTMLElement).querySelector('svg');
        expect(svg?.getAttribute('aria-label')).toContain(severity);
        // A signature of the geometry itself, so two levels sharing a hue would still fail.
        shapes.add(
          [...(svg?.children ?? [])]
            .map((el) => `${el.tagName}:${el.getAttribute('d') ?? el.getAttribute('rx') ?? ''}`)
            .join('|'),
        );
      }
      expect(shapes.size).toBe(SEVERITIES.length);
    });
  });

  describe('RemedyTypeIcon', () => {
    it('names the type in its alternative text, exactly as the server sent it', async () => {
      for (const type of REMEDY_TYPES) {
        const fixture = TestBed.createComponent(RemedyTypeIcon);
        fixture.componentRef.setInput('type', type);
        await fixture.whenStable();
        const svg = (fixture.nativeElement as HTMLElement).querySelector('svg');
        expect(svg?.getAttribute('aria-label')).toContain(type);
      }
    });
  });
});
