import { TestBed } from '@angular/core/testing';
import {
  TranslateLoader,
  provideTranslateLoader,
  provideTranslateService,
  type TranslationObject,
} from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { BN_CATALOGUE } from '../../../core/i18n/bn-catalogue';
import { ConnectivityStore } from '../../../core/stores/connectivity-store';
import { OfflineBanner } from './offline-banner';

class BanglaCatalogueLoader extends TranslateLoader {
  override getTranslation(): Observable<TranslationObject> {
    return of(BN_CATALOGUE as TranslationObject);
  }
}

describe('OfflineBanner (WEB-FR-402)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OfflineBanner],
      providers: [
        provideTranslateService({
          lang: 'bn',
          fallbackLang: 'bn',
          loader: provideTranslateLoader(BanglaCatalogueLoader),
        }),
      ],
    }).compileComponents();
  });

  it('says nothing while the connection is up', async () => {
    const fixture = TestBed.createComponent(OfflineBanner);
    TestBed.inject(ConnectivityStore).setOnline(true);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="status"]')).toBeNull();
  });

  it('states plainly that the draft is preserved, and blocks nothing', async () => {
    const fixture = TestBed.createComponent(OfflineBanner);
    TestBed.inject(ConnectivityStore).setOnline(false);
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    const banner = host.querySelector('[role="status"]');
    expect(banner).not.toBeNull();
    expect(host.textContent).toContain(BN_CATALOGUE['shared.offline.detail']);
    // A banner, never a modal: a farmer offline can still finish composing a case.
    expect(banner?.className).not.toContain('fixed');
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
});
