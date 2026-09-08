import { TestBed } from '@angular/core/testing';
import {
  TranslateLoader,
  provideTranslateLoader,
  provideTranslateService,
  type TranslationObject,
} from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { BN_CATALOGUE } from '../../../core/i18n/bn-catalogue';
import { CopyButton } from './copy-button';

class BanglaCatalogueLoader extends TranslateLoader {
  override getTranslation(): Observable<TranslationObject> {
    return of(BN_CATALOGUE as TranslationObject);
  }
}

const CORRELATION_ID = '3f9c1c2e-1f2a-4c1e-9e2b-5a7b8c9d0e1f';

function withClipboard(writeText: ((text: string) => Promise<void>) | null) {
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: writeText === null ? undefined : { writeText },
  });
  return () => {
    if (original) Object.defineProperty(navigator, 'clipboard', original);
    else Reflect.deleteProperty(navigator, 'clipboard');
  };
}

describe('CopyButton (WEB-FR-005)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CopyButton],
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
    const fixture = TestBed.createComponent(CopyButton);
    fixture.componentRef.setInput('value', CORRELATION_ID);
    await fixture.whenStable();
    return { fixture, host: fixture.nativeElement as HTMLElement };
  }

  it('copies the value and confirms it', async () => {
    const copied: string[] = [];
    const restore = withClipboard(async (text) => {
      copied.push(text);
    });
    try {
      const { fixture, host } = await render();
      host.querySelector('button')?.click();
      await fixture.whenStable();

      expect(copied).toEqual([CORRELATION_ID]);
      expect(host.textContent).toContain(BN_CATALOGUE['shared.copy.done']);
    } finally {
      restore();
    }
  });

  it('says so plainly when the browser refuses, rather than pretending it worked', async () => {
    const restore = withClipboard(async () => {
      throw new Error('denied');
    });
    try {
      const { fixture, host } = await render();
      host.querySelector('button')?.click();
      await fixture.whenStable();

      expect(host.textContent).toContain(BN_CATALOGUE['shared.copy.failed']);
    } finally {
      restore();
    }
  });

  it('renders no control at all where the Clipboard API is absent', async () => {
    // A dead button is worse than none: without the API the value beside it is still
    // selectable text, which is the honest fallback.
    const restore = withClipboard(null);
    try {
      const { host } = await render();
      expect(host.querySelector('button')).toBeNull();
    } finally {
      restore();
    }
  });
});
