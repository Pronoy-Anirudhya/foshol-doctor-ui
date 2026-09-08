import { TestBed } from '@angular/core/testing';
import {
  TranslateLoader,
  provideTranslateLoader,
  provideTranslateService,
  type TranslationObject,
} from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { BN_CATALOGUE } from '../../../core/i18n/bn-catalogue';
import { ConfidenceBar } from './confidence-bar';

/** The real Bangla catalogue, so the accessible name is asserted against the shipped string. */
class BanglaCatalogueLoader extends TranslateLoader {
  override getTranslation(): Observable<TranslationObject> {
    return of(BN_CATALOGUE as TranslationObject);
  }
}

/**
 * WEB-TEST-001 — the mandatory suite. This is the protected wow factor and the one place
 * where a rendering bug silently misrepresents the routing, so every case asserts all four
 * properties: two threshold lines exist, each sits at exactly its value's proportional
 * position, the fill equals the confidence, and all three numbers are present AS TEXT.
 *
 * The threshold values are the specimen routing thresholds an `AnalysisDetail.thresholds`
 * object carries. They are fed as inputs, never read from APP_CONFIG (WEB-NFR-011) — and the
 * last test in this file is what proves that.
 */
const LOW = 0.45;
const HIGH = 0.75;
const LOW_TEXT = '45%';
const HIGH_TEXT = '75%';

interface BarCase {
  readonly name: string;
  readonly confidence: number;
  readonly text: string;
}

const CASES: readonly BarCase[] = [
  { name: 'zero', confidence: 0.0, text: '0%' },
  { name: 'exactly the low threshold', confidence: LOW, text: LOW_TEXT },
  { name: 'strictly between the thresholds', confidence: 0.6, text: '60%' },
  { name: 'exactly the high threshold', confidence: HIGH, text: HIGH_TEXT },
  { name: 'one', confidence: 1.0, text: '100%' },
];

async function renderBar(confidence: number, low = LOW, high = HIGH) {
  const fixture = TestBed.createComponent(ConfidenceBar);
  fixture.componentRef.setInput('confidence', confidence);
  fixture.componentRef.setInput('low', low);
  fixture.componentRef.setInput('high', high);
  await fixture.whenStable();
  return fixture;
}

const testId = (host: HTMLElement, id: string): HTMLElement[] =>
  Array.from(host.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`));

const text = (element: HTMLElement | undefined): string => (element?.textContent ?? '').trim();

describe('ConfidenceBar (WEB-TEST-001)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConfidenceBar],
      providers: [
        provideTranslateService({
          lang: 'bn',
          fallbackLang: 'bn',
          loader: provideTranslateLoader(BanglaCatalogueLoader),
        }),
      ],
    }).compileComponents();
  });

  for (const testCase of CASES) {
    describe(`confidence ${testCase.name}`, () => {
      it('draws exactly two threshold lines (WEB-FR-221)', async () => {
        const fixture = await renderBar(testCase.confidence);
        const lines = testId(fixture.nativeElement as HTMLElement, 'cb-line');

        expect(lines.length).toBe(2);
        expect(lines.map((line) => line.getAttribute('data-threshold'))).toEqual(['low', 'high']);
      });

      it('positions each line at exactly its threshold value (WEB-FR-223)', async () => {
        const fixture = await renderBar(testCase.confidence);
        const host = fixture.nativeElement as HTMLElement;
        const [lowLine, highLine] = testId(host, 'cb-line');

        expect(lowLine?.getAttribute('data-position')).toBe(LOW_TEXT);
        expect(highLine?.getAttribute('data-position')).toBe(HIGH_TEXT);
        expect(host.style.getPropertyValue('--cb-low')).toBe(LOW_TEXT);
        expect(host.style.getPropertyValue('--cb-high')).toBe(HIGH_TEXT);
      });

      it('fills in proportion to the confidence (WEB-FR-220)', async () => {
        const fixture = await renderBar(testCase.confidence);
        const host = fixture.nativeElement as HTMLElement;
        const [fill] = testId(host, 'cb-fill');

        expect(fill?.getAttribute('data-width')).toBe(testCase.text);
        expect(host.style.getPropertyValue('--cb-fill')).toBe(testCase.text);
      });

      it('renders the confidence and both thresholds as text (WEB-FR-222, WEB-UX-044)', async () => {
        const fixture = await renderBar(testCase.confidence);
        const host = fixture.nativeElement as HTMLElement;

        expect(text(testId(host, 'cb-value')[0])).toBe(testCase.text);
        expect(testId(host, 'cb-line-label').map(text)).toEqual([LOW_TEXT, HIGH_TEXT]);
      });

      it('states all three numbers in its accessible name (WEB-UX-044)', async () => {
        const fixture = await renderBar(testCase.confidence);
        const host = fixture.nativeElement as HTMLElement;
        const label = host.getAttribute('aria-label') ?? '';

        expect(host.getAttribute('role')).toBe('img');
        for (const value of [testCase.text, LOW_TEXT, HIGH_TEXT]) {
          expect(label).toContain(value);
        }
      });
    });
  }

  it('never derives, displays or implies a decision path (WEB-FR-224)', async () => {
    const fixture = await renderBar(HIGH);
    const markup = (fixture.nativeElement as HTMLElement).outerHTML;

    for (const path of ['PRIMARY', 'SECONDARY', 'UNDETERMINED']) {
      expect(markup).not.toContain(path);
    }
    // One fill treatment at every value: the fill element is class-identical across the range.
    const highBand = testId(fixture.nativeElement as HTMLElement, 'cb-fill')[0]?.className;
    const lowBand = testId((await renderBar(0.1)).nativeElement as HTMLElement, 'cb-fill')[0]
      ?.className;
    expect(highBand).toBe(lowBand);
  });

  it('takes both thresholds from its inputs, never from configuration (WEB-NFR-011)', async () => {
    // Deliberately NOT the APP_CONFIG fallbacks: if the bar ever reads config, this fails.
    const fixture = await renderBar(0.5, 0.3, 0.9);
    const host = fixture.nativeElement as HTMLElement;

    expect(testId(host, 'cb-line-label').map(text)).toEqual(['30%', '90%']);
    expect(host.style.getPropertyValue('--cb-low')).toBe('30%');
    expect(host.style.getPropertyValue('--cb-high')).toBe('90%');
  });

  it('keeps both threshold lines in the compact variant', async () => {
    const fixture = TestBed.createComponent(ConfidenceBar);
    fixture.componentRef.setInput('confidence', LOW);
    fixture.componentRef.setInput('low', LOW);
    fixture.componentRef.setInput('high', HIGH);
    fixture.componentRef.setInput('compact', true);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.getAttribute('data-compact')).toBe('true');
    expect(testId(host, 'cb-line').length).toBe(2);
    expect(testId(host, 'cb-line-label').map(text)).toEqual([LOW_TEXT, HIGH_TEXT]);
  });
});
