import { TestBed } from '@angular/core/testing';
import {
  TranslateLoader,
  provideTranslateLoader,
  provideTranslateService,
  type TranslationObject,
} from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { BN_CATALOGUE } from '../../../core/i18n/bn-catalogue';
import { LanguageStore } from '../../../core/i18n/language-store';
import { BnValue } from './bn-value';

class BanglaCatalogueLoader extends TranslateLoader {
  override getTranslation(): Observable<TranslationObject> {
    return of(BN_CATALOGUE as TranslationObject);
  }
}

/** Rice blast, exactly as the knowledge base holds it. Never translated (WEB-UX-016). */
const BANGLA = 'ধানের ব্লাস্ট';
const ENGLISH = 'Rice blast';

interface Pair {
  readonly bn?: string;
  readonly en?: string | null;
  readonly fallback?: boolean;
  readonly locale: 'bn' | 'en';
}

describe('BnValue (WEB-UX-015, WEB-UX-016, WEB-UX-044)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BnValue],
      providers: [
        provideTranslateService({
          lang: 'bn',
          fallbackLang: 'bn',
          loader: provideTranslateLoader(BanglaCatalogueLoader),
        }),
      ],
    }).compileComponents();
  });

  async function render({ bn = BANGLA, en = ENGLISH, fallback = false, locale }: Pair) {
    TestBed.inject(LanguageStore).use(locale);
    const fixture = TestBed.createComponent(BnValue);
    fixture.componentRef.setInput('bn', bn);
    fixture.componentRef.setInput('en', en);
    fixture.componentRef.setInput('fallback', fallback);
    await fixture.whenStable();
    return { host: fixture.nativeElement as HTMLElement, fixture };
  }

  it('renders Bangla, the language of record, when Bangla is asked for', async () => {
    const { host } = await render({ locale: 'bn' });

    expect(host.textContent).toContain(BANGLA);
    expect(host.textContent).not.toContain(ENGLISH);
  });

  it('renders English when English is asked for and the catalogue has it', async () => {
    const { host } = await render({ locale: 'en' });

    expect(host.textContent).toContain(ENGLISH);
    expect(host.textContent).not.toContain('(bn)');
  });

  it('swaps on the toggle without anything being refetched (WEB-UX-012)', async () => {
    const { host } = await render({ locale: 'bn' });
    expect(host.textContent).toContain(BANGLA);

    // Both locales were already on the object; this is a signal re-read, not a request.
    TestBed.inject(LanguageStore).use('en');
    await Promise.resolve();
    TestBed.flushEffects?.();
    const fixture = TestBed.createComponent(BnValue);
    fixture.componentRef.setInput('bn', BANGLA);
    fixture.componentRef.setInput('en', ENGLISH);
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(ENGLISH);
  });

  it('adds a visible (bn) TEXT marker in English when the server flagged a fallback', async () => {
    // COMMON-NFR-038 — the server copied the Bangla into the English field and said so.
    const { host } = await render({ en: BANGLA, fallback: true, locale: 'en' });

    expect(host.textContent).toContain(BANGLA);
    // WEB-UX-044 — the marker is text in its own element, never colour alone.
    expect(host.textContent).toContain('(bn)');
    expect(host.querySelector('[aria-describedby]')).not.toBeNull();
  });

  it('carries an accessible description saying no English translation exists', async () => {
    const { host } = await render({ en: BANGLA, fallback: true, locale: 'en' });

    const marker = host.querySelector('[aria-describedby]');
    const describedBy = marker?.getAttribute('aria-describedby') ?? '';
    expect(host.querySelector(`#${describedBy}`)?.textContent?.trim().length).toBeGreaterThan(0);
  });

  it('falls back to Bangla and marks it when the payload has no English at all', async () => {
    // An older payload, or a field the server chose not to send. Never invent English.
    const { host } = await render({ en: null, locale: 'en' });

    expect(host.textContent).toContain(BANGLA);
    expect(host.textContent).toContain('(bn)');
  });

  it('shows no marker in Bangla, where the value is already the language of record', async () => {
    const { host } = await render({ en: BANGLA, fallback: true, locale: 'bn' });

    expect(host.textContent).not.toContain('(bn)');
  });

  it('shows no marker when the server did not set the fallback flag', async () => {
    const { host } = await render({ locale: 'en' });

    expect(host.textContent).not.toContain('(bn)');
  });
});
