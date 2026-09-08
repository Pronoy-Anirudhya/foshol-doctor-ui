import { TestBed } from '@angular/core/testing';
import {
  TranslateLoader,
  provideTranslateLoader,
  provideTranslateService,
  type TranslationObject,
} from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { BN_CATALOGUE } from '../../../core/i18n/bn-catalogue';
import type { PageOfOfficerQueueRow } from '../../../generated/models/page-of-officer-queue-row';
import { Paginator } from './paginator';

class BanglaCatalogueLoader extends TranslateLoader {
  override getTranslation(): Observable<TranslationObject> {
    return of(BN_CATALOGUE as TranslationObject);
  }
}

/** WEB-API-003 — the four envelope fields, bound exactly as `00-common` §8.2 defines them. */
const ENVELOPE: PageOfOfficerQueueRow = {
  content: [],
  page: 1,
  size: 20,
  totalElements: 57,
  totalPages: 3,
};

describe('Paginator (WEB-API-003)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Paginator],
      providers: [
        provideTranslateService({
          lang: 'bn',
          fallbackLang: 'bn',
          loader: provideTranslateLoader(BanglaCatalogueLoader),
        }),
      ],
    }).compileComponents();
  });

  async function render(page: number, totalPages = ENVELOPE.totalPages) {
    const fixture = TestBed.createComponent(Paginator);
    fixture.componentRef.setInput('page', page);
    fixture.componentRef.setInput('size', ENVELOPE.size);
    fixture.componentRef.setInput('totalElements', ENVELOPE.totalElements);
    fixture.componentRef.setInput('totalPages', totalPages);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const buttons = [...host.querySelectorAll('button')];
    return { fixture, host, previous: buttons[0], next: buttons[1] };
  }

  it('renders the zero-based wire page as a one-based human page', async () => {
    const { host } = await render(ENVELOPE.page);
    expect(host.querySelector('p')?.textContent).toContain('2');
    expect(host.querySelector('p')?.textContent).toContain('3');
    expect(host.querySelector('p')?.textContent).toContain('57');
  });

  it('disables previous on the first page and next on the last', async () => {
    const first = await render(0);
    expect(first.previous?.disabled).toBe(true);
    expect(first.next?.disabled).toBe(false);

    const last = await render(2);
    expect(last.previous?.disabled).toBe(false);
    expect(last.next?.disabled).toBe(true);
  });

  it('emits the zero-based index the caller should request', async () => {
    const { fixture, next, previous } = await render(1);
    const emitted: number[] = [];
    fixture.componentInstance.pageChange.subscribe((page: number) => emitted.push(page));

    next?.click();
    previous?.click();

    expect(emitted).toEqual([2, 0]);
  });

  it('never emits a page outside the range the server reported', async () => {
    const { fixture, next } = await render(2);
    const emitted: number[] = [];
    fixture.componentInstance.pageChange.subscribe((page: number) => emitted.push(page));

    next?.click();

    expect(emitted).toEqual([]);
  });
});
