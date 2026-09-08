import { TestBed } from '@angular/core/testing';
import {
  TranslateLoader,
  provideTranslateLoader,
  provideTranslateService,
  type TranslationObject,
} from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { BN_CATALOGUE } from '../../../core/i18n/bn-catalogue';
import { ToastStore, TOAST_SUCCESS } from '../../../core/stores/toast-store';
import { ToastHost } from './toast-host';

class BanglaCatalogueLoader extends TranslateLoader {
  override getTranslation(): Observable<TranslationObject> {
    return of(BN_CATALOGUE as TranslationObject);
  }
}

/** Server-supplied advisory text: rendered verbatim, never looked up in a catalogue. */
const SERVER_TITLE = 'পরামর্শ প্রকাশিত হয়েছে';

describe('ToastHost (WEB-FR-354, WEB-UX-046)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ToastHost],
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
    const fixture = TestBed.createComponent(ToastHost);
    await fixture.whenStable();
    return {
      fixture,
      host: fixture.nativeElement as HTMLElement,
      store: TestBed.inject(ToastStore),
    };
  }

  afterEach(() => TestBed.inject(ToastStore).dismissAll());

  it('renders nothing when there is nothing to say', async () => {
    const { host } = await render();
    expect(host.querySelector('[role="region"]')).toBeNull();
  });

  it('stacks toasts and renders a server title verbatim (WEB-UX-016)', async () => {
    const { fixture, host, store } = await render();
    store.show({ kind: TOAST_SUCCESS, title: SERVER_TITLE, caseId: 'c1' });
    store.show({ kind: TOAST_SUCCESS, titleKey: 'shared.empty.title' });
    await fixture.whenStable();

    const toasts = host.querySelectorAll('.toast');
    expect(toasts.length).toBe(2);
    expect(toasts[0]?.textContent).toContain(SERVER_TITLE);
    expect(toasts[1]?.textContent).toContain(BN_CATALOGUE['shared.empty.title']);
  });

  it('is dismissible', async () => {
    const { fixture, host, store } = await render();
    store.show({ kind: TOAST_SUCCESS, title: SERVER_TITLE });
    await fixture.whenStable();

    host.querySelector<HTMLButtonElement>('.toast button')?.click();
    await fixture.whenStable();

    expect(host.querySelectorAll('.toast').length).toBe(0);
  });

  it('declares no live region of its own — the shell owns the only one (WEB-UX-046)', async () => {
    const { fixture, host, store } = await render();
    store.show({ kind: TOAST_SUCCESS, title: SERVER_TITLE });
    await fixture.whenStable();

    // Whoever raises a toast announces through LiveAnnouncer in the same breath; two live
    // regions racing is how a screen reader ends up reading neither.
    expect(host.querySelectorAll('[aria-live]').length).toBe(0);
    expect(host.querySelector('[role="region"]')).not.toBeNull();
  });
});
