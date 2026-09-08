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
const CONTENT = 'ধানের ব্লাস্ট';

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

  async function render(fallback: boolean, locale: 'bn' | 'en') {
    TestBed.inject(LanguageStore).use(locale);
    const fixture = TestBed.createComponent(BnValue);
    fixture.componentRef.setInput('value', CONTENT);
    fixture.componentRef.setInput('fallback', fallback);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders the value exactly as the server returned it', async () => {
    const host = await render(false, 'bn');
    expect(host.textContent).toContain(CONTENT);
  });

  it('adds a visible (bn) TEXT marker in English when no translation exists', async () => {
    const host = await render(true, 'en');
    // WEB-UX-044 — the marker is text in its own element, never colour alone.
    expect(host.textContent).toContain('(bn)');
    expect(host.querySelector('[aria-describedby]')).not.toBeNull();
  });

  it('carries an accessible description saying no English translation exists', async () => {
    const host = await render(true, 'en');
    const marker = host.querySelector('[aria-describedby]');
    const describedBy = marker?.getAttribute('aria-describedby') ?? '';
    expect(host.querySelector(`#${describedBy}`)?.textContent?.trim().length).toBeGreaterThan(0);
  });

  it('shows no marker in Bangla, where the value is already the language of record', async () => {
    const host = await render(true, 'bn');
    expect(host.textContent).not.toContain('(bn)');
  });

  it('shows no marker when the server did not set the fallback flag', async () => {
    const host = await render(false, 'en');
    expect(host.textContent).not.toContain('(bn)');
  });
});
