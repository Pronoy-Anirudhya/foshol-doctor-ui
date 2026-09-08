import { TestBed } from '@angular/core/testing';
import {
  TranslateLoader,
  provideTranslateLoader,
  provideTranslateService,
  type TranslationObject,
} from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { BN_CATALOGUE } from '../../../core/i18n/bn-catalogue';
import { APP_CONFIG } from '../../../core/config/app-config';
import { Spinner } from './spinner';

class BanglaCatalogueLoader extends TranslateLoader {
  override getTranslation(): Observable<TranslationObject> {
    return of(BN_CATALOGUE as TranslationObject);
  }
}

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Spinner (WEB-FR-400)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Spinner],
      providers: [
        provideTranslateService({
          lang: 'bn',
          fallbackLang: 'bn',
          loader: provideTranslateLoader(BanglaCatalogueLoader),
        }),
      ],
    }).compileComponents();
  });

  it('shows nothing before ui.spinnerDelayMs, so a fast response produces no flash', async () => {
    const fixture = TestBed.createComponent(Spinner);
    fixture.componentRef.setInput('active', true);
    await fixture.whenStable();

    expect(fixture.componentInstance.visible()).toBe(false);
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="status"]')).toBeNull();
  });

  it('shows the indicator once the request has run past the delay', async () => {
    const fixture = TestBed.createComponent(Spinner);
    fixture.componentRef.setInput('active', true);
    await fixture.whenStable();

    await tick(APP_CONFIG.ui.spinnerDelayMs + 30);
    await fixture.whenStable();

    expect(fixture.componentInstance.visible()).toBe(true);
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="status"]')).not.toBeNull();
  });

  it('cancels the pending indicator when the request finishes first', async () => {
    const fixture = TestBed.createComponent(Spinner);
    fixture.componentRef.setInput('active', true);
    await fixture.whenStable();

    fixture.componentRef.setInput('active', false);
    await fixture.whenStable();
    await tick(APP_CONFIG.ui.spinnerDelayMs + 30);

    expect(fixture.componentInstance.visible()).toBe(false);
  });
});
