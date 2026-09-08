import { TestBed } from '@angular/core/testing';
import {
  TranslateLoader,
  provideTranslateLoader,
  provideTranslateService,
  type TranslationObject,
} from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { BN_CATALOGUE } from '../../../core/i18n/bn-catalogue';
import { HTTP_STATUS, type ProblemView } from '../../../core/errors/problem';
import { ErrorPanel } from './error-panel';

class BanglaCatalogueLoader extends TranslateLoader {
  override getTranslation(): Observable<TranslationObject> {
    return of(BN_CATALOGUE as TranslationObject);
  }
}

const CORRELATION_ID = '3f9c1c2e-1f2a-4c1e-9e2b-5a7b8c9d0e1f';

function problem(overrides: Partial<ProblemView> = {}): ProblemView {
  return {
    status: HTTP_STATUS.serviceUnavailable,
    code: 'SERVICE_UNAVAILABLE',
    title: null,
    detail: null,
    correlationId: CORRELATION_ID,
    fieldErrors: [],
    rejectedImages: [],
    retryAfterSeconds: null,
    retryable: true,
    titleKey: 'errors.unavailable.title',
    detailKey: 'errors.unavailable.detail',
    ...overrides,
  };
}

describe('ErrorPanel (WEB-FR-005, WEB-FR-401, WEB-FR-404)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ErrorPanel],
      providers: [
        provideTranslateService({
          lang: 'bn',
          fallbackLang: 'bn',
          loader: provideTranslateLoader(BanglaCatalogueLoader),
        }),
      ],
    }).compileComponents();
  });

  async function render(view: ProblemView | null) {
    const fixture = TestBed.createComponent(ErrorPanel);
    fixture.componentRef.setInput('problem', view);
    await fixture.whenStable();
    return { fixture, host: fixture.nativeElement as HTMLElement };
  }

  it('renders nothing at all when there is no problem', async () => {
    const { host } = await render(null);
    expect(host.querySelector('section')).toBeNull();
  });

  it("shows the server's own title and detail (WEB-FR-005)", async () => {
    const { host } = await render(
      problem({ title: 'সেবা সাময়িকভাবে বন্ধ', detail: 'একটু পরে আবার চেষ্টা করুন।' }),
    );
    expect(host.querySelector('h2')?.textContent).toContain('সেবা সাময়িকভাবে বন্ধ');
    expect(host.textContent).toContain('একটু পরে আবার চেষ্টা করুন।');
  });

  it('never puts a raw status code or error code in the headline (WEB-FR-404)', async () => {
    const { host } = await render(problem());
    const heading = host.querySelector('h2')?.textContent ?? '';
    expect(heading).not.toContain('503');
    expect(heading).not.toContain('SERVICE_UNAVAILABLE');
  });

  it('shows the correlation id in copyable form (WEB-FR-005)', async () => {
    const { host } = await render(problem());
    // The demo machine has no log aggregator: this string on screen is the only route from
    // "it did not work" to a stack trace in the server log.
    expect(host.querySelector('code')?.textContent?.trim()).toBe(CORRELATION_ID);
  });

  it('offers a retry only when the failure is retryable (WEB-FR-401)', async () => {
    const retryable = await render(problem());
    expect(retryable.host.querySelector('.error-retry')).not.toBeNull();

    const notRetryable = await render(problem({ retryable: false }));
    expect(notRetryable.host.querySelector('.error-retry')).toBeNull();
  });

  it('lets the caller suppress the retry once it has spent its one attempt', async () => {
    const fixture = TestBed.createComponent(ErrorPanel);
    fixture.componentRef.setInput('problem', problem());
    fixture.componentRef.setInput('retryable', false);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('.error-retry')).toBeNull();
  });

  it('lists field errors returned by the server', async () => {
    const { host } = await render(
      problem({ fieldErrors: [{ field: 'noteBn', message: 'must not be blank' }] }),
    );
    expect(host.textContent).toContain('noteBn');
    expect(host.textContent).toContain('must not be blank');
  });
});
