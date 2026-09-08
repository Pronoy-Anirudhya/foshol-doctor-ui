import { TestBed } from '@angular/core/testing';
import {
  TranslateLoader,
  provideTranslateLoader,
  provideTranslateService,
  type TranslationObject,
} from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { BN_CATALOGUE } from '../../../core/i18n/bn-catalogue';
import { SseStore } from '../../../core/sse/sse-store';
import { SseIndicator } from './sse-indicator';

class BanglaCatalogueLoader extends TranslateLoader {
  override getTranslation(): Observable<TranslationObject> {
    return of(BN_CATALOGUE as TranslationObject);
  }
}

describe('SseIndicator (WEB-FR-357)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SseIndicator],
      providers: [
        provideTranslateService({
          lang: 'bn',
          fallbackLang: 'bn',
          loader: provideTranslateLoader(BanglaCatalogueLoader),
        }),
      ],
    }).compileComponents();
  });

  async function render() {
    const fixture = TestBed.createComponent(SseIndicator);
    await fixture.whenStable();
    return { fixture, host: fixture.nativeElement as HTMLElement, sse: TestBed.inject(SseStore) };
  }

  it('names the state in words, so the dot colour is never the only cue (WEB-UX-044)', async () => {
    const { fixture, host, sse } = await render();
    sse.markRetrying(2, 4_000);
    await fixture.whenStable();

    const label = host.querySelector('span')?.getAttribute('aria-label') ?? '';
    expect(label).toBe(BN_CATALOGUE['shared.sse.aria.RETRYING']);
  });

  it('is discreet: an inline pill, never a blocking overlay', async () => {
    const { fixture, host, sse } = await render();
    sse.markRetrying(1, 1_000);
    await fixture.whenStable();

    const pill = host.querySelector('span');
    // Nothing that could sit over the page and stop the rest of the UI being used.
    expect(pill?.className).not.toContain('fixed');
    expect(pill?.className).not.toContain('inset-0');
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it('can be told to stay silent while the stream is healthy', async () => {
    const { fixture, host, sse } = await render();
    sse.markOpen();
    fixture.componentRef.setInput('showWhenOpen', false);
    await fixture.whenStable();

    expect(host.querySelector('span')).toBeNull();

    sse.markRetrying(1, 1_000);
    await fixture.whenStable();
    expect(host.querySelector('span')).not.toBeNull();
  });
});
