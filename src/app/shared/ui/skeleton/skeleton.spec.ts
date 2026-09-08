import { TestBed } from '@angular/core/testing';
import {
  TranslateLoader,
  provideTranslateLoader,
  provideTranslateService,
  type TranslationObject,
} from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { BN_CATALOGUE } from '../../../core/i18n/bn-catalogue';
import { Skeleton } from './skeleton';

class BanglaCatalogueLoader extends TranslateLoader {
  override getTranslation(): Observable<TranslationObject> {
    return of(BN_CATALOGUE as TranslationObject);
  }
}

describe('Skeleton (WEB-FR-400, WEB-UX-046)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Skeleton],
      providers: [
        provideTranslateService({
          lang: 'bn',
          fallbackLang: 'bn',
          loader: provideTranslateLoader(BanglaCatalogueLoader),
        }),
      ],
    }).compileComponents();
  });

  async function render(count: number) {
    const fixture = TestBed.createComponent(Skeleton);
    fixture.componentRef.setInput('count', count);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('never leaves the region blank — one block even when asked for none', async () => {
    expect((await render(0)).querySelectorAll('.animate-pulse').length).toBe(1);
  });

  it('holds the shape of the incoming content so nothing jumps when it lands', async () => {
    expect((await render(4)).querySelectorAll('.animate-pulse').length).toBe(4);
  });

  it('hides the blocks from assistive technology and says "loading" once instead', async () => {
    const host = await render(3);
    expect(host.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent?.trim()).toBe(
      BN_CATALOGUE['shared.skeleton.label'],
    );
  });
});
