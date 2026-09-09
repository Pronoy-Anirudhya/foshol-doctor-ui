import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import farmersFragment from '../../../i18n/farmers.i18n.json';
import { APP_CONFIG } from '../../core/config/app-config';
import { provideI18n } from '../../core/i18n/i18n.providers';
import { ApiConfiguration } from '../../generated/api-configuration';
import { FarmerDirectorySection } from './farmer-directory-section';
import { FarmerDirectoryStore } from './farmer-directory-store';

function row(id: string, name: string, source = 'MANUAL') {
  return {
    id,
    name,
    divisionCode: '30',
    districtCode: '3026',
    divisionNameBn: 'ঢাকা',
    divisionNameEn: 'Dhaka',
    districtNameBn: 'গাজীপুর',
    districtNameEn: 'Gazipur',
    preferredLanguage: 'bn',
    createdAt: '2026-09-07T10:00:00Z',
    registeredByOfficerId: 'o-1',
    registeredByName: 'Amina Khatun',
    source,
  };
}

function pageOf(content: object[]) {
  return {
    content,
    page: 0,
    size: APP_CONFIG.page.defaultSize,
    totalElements: content.length,
    totalPages: content.length === 0 ? 0 : 1,
  };
}

describe('FarmerDirectorySection', () => {
  let fixture: ComponentFixture<FarmerDirectorySection>;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideI18n(),
        FarmerDirectoryStore,
        { provide: ApiConfiguration, useValue: { rootUrl: APP_CONFIG.api.origin } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(TranslateService).setTranslation(
      APP_CONFIG.i18n.defaultLocale,
      Object.fromEntries(Object.entries(farmersFragment).map(([key, value]) => [key, value.bn])),
      true,
    );
    fixture = TestBed.createComponent(FarmerDirectorySection);
  });

  afterEach(() => {
    http.verify();
  });

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  async function settle(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function click(testid: string): void {
    el().querySelector<HTMLElement>(`[data-testid="${testid}"]`)!.click();
  }

  function typeInto(testid: string, value: string): void {
    const input = el().querySelector<HTMLInputElement>(`[data-testid="${testid}"]`)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  /** Answers every open request with one body and returns the LAST request seen. */
  async function answer(body: object) {
    await settle();
    const open = http.match(() => true);
    for (const request of open) request.flush(body);
    await settle();
    return open.at(-1)!;
  }

  it('loads the first page on init and shows the server rows in the server order', async () => {
    await answer(pageOf([row('f-1', 'প্রথম'), row('f-2', 'দ্বিতীয়'), row('f-3', 'তৃতীয়')]));

    const names = [...el().querySelectorAll('[data-testid="directory-table"] tr td:first-child')].map(
      (cell) => cell.textContent?.trim(),
    );
    expect(names).toEqual(['প্রথম', 'দ্বিতীয়', 'তৃতীয়']);
  });

  it('sends neither q nor phone when nothing is being searched for', async () => {
    const request = await answer(pageOf([row('f-1', 'প্রথম')]));
    expect(request.request.params.has('q')).toBe(false);
    expect(request.request.params.has('phone')).toBe(false);
    expect(request.request.params.get('page')).toBe('0');
  });

  it('sends q alone when searching by name', async () => {
    await answer(pageOf([]));
    typeInto('directory-search-name', 'রহিম');
    fixture.detectChanges();
    click('directory-search-name-go');

    const request = await answer(pageOf([]));
    expect(request.request.params.get('q')).toBe('রহিম');
    expect(request.request.params.has('phone')).toBe(false);
  });

  it('sends phone alone when looking a number up, and clears the name box (WEB-FR-312)', async () => {
    await answer(pageOf([]));
    typeInto('directory-search-name', 'রহিম');
    fixture.detectChanges();
    click('directory-search-name-go');
    await answer(pageOf([]));

    typeInto('directory-search-phone', '01712345678');
    fixture.detectChanges();
    click('directory-search-phone-go');

    const request = await answer(pageOf([]));
    expect(request.request.params.get('phone')).toBe('01712345678');
    // Sending both earns a 400 ERR_BAD_REQUEST — the pair must never travel together.
    expect(request.request.params.has('q')).toBe(false);
    expect(
      el().querySelector<HTMLInputElement>('[data-testid="directory-search-name"]')!.value,
    ).toBe('');
  });

  it('never renders a phone number, because a response never carries one (WEB-SEC-002)', async () => {
    const phone = '01712345678';
    await answer(pageOf([]));

    typeInto('directory-search-phone', phone);
    fixture.detectChanges();
    click('directory-search-phone-go');
    await answer(pageOf([row('f-1', 'রহিম উদ্দিন')]));

    // The typed value lives on in the input's `value` property, which is the officer's own
    // typing; what must never happen is the number appearing in RENDERED TEXT.
    expect(el().textContent ?? '').not.toContain(phone);
  });

  it('keeps the rows on screen when a refresh fails, and says they are out of date', async () => {
    await answer(pageOf([row('f-1', 'প্রথম')]));

    click('directory-refresh');
    await settle();
    for (const request of http.match(() => true)) {
      request.flush({ title: 'boom' }, { status: 503, statusText: 'Unavailable' });
    }
    await settle();

    expect(el().querySelector('[data-testid="directory-stale"]')).not.toBeNull();
    expect(el().textContent).toContain('প্রথম');
  });

  it('tells "nothing registered yet" apart from "nothing matched your search"', async () => {
    await answer(pageOf([]));
    expect(el().textContent).toContain(farmersFragment['farmers.directory.empty.title'].bn);

    typeInto('directory-search-name', 'নেই');
    fixture.detectChanges();
    click('directory-search-name-go');
    await answer(pageOf([]));

    expect(el().textContent).toContain(farmersFragment['farmers.directory.noMatches.title'].bn);
  });

  it('falls back to the district CODE when the server sent no district name', async () => {
    const nameless = { ...row('f-1', 'প্রথম'), districtNameBn: null, districtNameEn: null };
    await answer(pageOf([nameless]));

    expect(el().textContent).toContain('3026');
  });

  it('offers no sort control — the contract has no sort parameter', async () => {
    await answer(pageOf([row('f-1', 'প্রথম')]));

    const headers = [...el().querySelectorAll('th')];
    expect(headers.length).toBeGreaterThan(0);
    for (const header of headers) {
      expect(header.querySelector('button')).toBeNull();
      expect(header.getAttribute('aria-sort')).toBeNull();
    }
  });
});
