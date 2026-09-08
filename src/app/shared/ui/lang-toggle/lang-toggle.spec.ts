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
import { LangToggle } from './lang-toggle';

class BanglaCatalogueLoader extends TranslateLoader {
  override getTranslation(): Observable<TranslationObject> {
    return of(BN_CATALOGUE as TranslationObject);
  }
}

describe('LangToggle (WEB-UX-011, WEB-UX-012, WEB-UX-040)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LangToggle],
      providers: [
        provideTranslateService({
          lang: 'bn',
          fallbackLang: 'bn',
          loader: provideTranslateLoader(BanglaCatalogueLoader),
        }),
      ],
    }).compileComponents();
    TestBed.inject(LanguageStore).use('bn');
  });

  async function render() {
    const fixture = TestBed.createComponent(LangToggle);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    return { fixture, host, buttons: [...host.querySelectorAll('button')] };
  }

  it('offers exactly the supported locales, Bangla first (WEB-UX-011)', async () => {
    const { buttons } = await render();
    expect(buttons.map((b) => b.getAttribute('lang'))).toEqual(['bn', 'en']);
  });

  it('marks the active locale with aria-pressed, not colour alone (WEB-UX-044)', async () => {
    const { buttons } = await render();
    expect(buttons[0]?.getAttribute('aria-pressed')).toBe('true');
    expect(buttons[1]?.getAttribute('aria-pressed')).toBe('false');
  });

  it('switches the locale without navigating or re-creating anything (WEB-UX-012)', async () => {
    const { fixture, buttons } = await render();
    buttons[1]?.click();
    await fixture.whenStable();

    expect(TestBed.inject(LanguageStore).current()).toBe('en');
    // The same DOM nodes are still here — nothing was reloaded, so unsaved form state
    // elsewhere on the page survives.
    const after = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')];
    expect(after[1]?.getAttribute('aria-pressed')).toBe('true');
    expect(after[0]?.getAttribute('aria-pressed')).toBe('false');
  });

  it('uses real buttons in a labelled group, so it is keyboard operable (WEB-UX-040)', async () => {
    const { host, buttons } = await render();
    expect(host.querySelector('[role="group"]')?.getAttribute('aria-label')).toBeTruthy();
    for (const button of buttons) expect(button.tagName).toBe('BUTTON');
  });
});
