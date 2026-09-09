import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import farmersFragment from '../../../i18n/farmers.i18n.json';
import { APP_CONFIG } from '../../core/config/app-config';
import { provideI18n } from '../../core/i18n/i18n.providers';
import { ApiConfiguration } from '../../generated/api-configuration';
import { FarmerDirectoryStore } from './farmer-directory-store';
import { FarmerImportDialog } from './farmer-import-dialog';

const IMPORT_URL = `${APP_CONFIG.api.origin}/api/v1/farmers/import`;
const HEADER = APP_CONFIG.farmers.templateHeader;
const PHONE = '01712345678';

describe('FarmerImportDialog', () => {
  let fixture: ComponentFixture<FarmerImportDialog>;
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
    fixture = TestBed.createComponent(FarmerImportDialog);
    fixture.componentRef.setInput('open', true);
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

  /**
   * Puts a file on the picker the way a browser would, then lets the async read finish.
   *
   * The stub is a `FileList`, not an array: a real one is indexable AND has `item()`, and the
   * component uses `item()`. A bare array would pass a test the browser would fail.
   */
  function fileListOf(file: File): FileList {
    return {
      0: file,
      length: 1,
      item: (index: number) => (index === 0 ? file : null),
      [Symbol.iterator]: function* () {
        yield file;
      },
    } as unknown as FileList;
  }

  async function choose(contents: string, name = 'farmers.csv'): Promise<void> {
    const input = el().querySelector<HTMLInputElement>('[data-testid="import-file"]')!;
    const file = new File([contents], name, { type: 'text/csv' });
    Object.defineProperty(input, 'files', { value: fileListOf(file), configurable: true });
    input.dispatchEvent(new Event('change'));
    await settle();
  }

  it('offers the template with exactly the five contract columns and no others', async () => {
    await settle();
    const shown = el().querySelector('code')?.textContent?.trim();
    expect(shown).toBe(HEADER);
    expect(shown?.split(',').length).toBe(5);
  });

  it('uploads the chosen file as multipart under the field name the contract declares', async () => {
    await settle();
    await choose(`${HEADER}\nরহিম,${PHONE},30,3026,bn`);
    click('import-submit');
    await settle();

    const request = http.expectOne(IMPORT_URL);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toBeInstanceOf(FormData);
    expect((request.request.body as FormData).get('file')).toBeInstanceOf(Blob);
    request.flush({ succeeded: 1, failed: 0, results: [{ row: 2, status: 'OK', name: 'রহিম' }] });
    await settle();
  });

  it('renders every row, and one failure does not suppress the successes (WEB-FR-313)', async () => {
    await settle();
    await choose(`${HEADER}\nরহিম,${PHONE},30,3026,bn\nকরিম,01812345678,30,3026,bn`);
    click('import-submit');
    await settle();

    http.expectOne(IMPORT_URL).flush({
      succeeded: 1,
      failed: 1,
      results: [
        { row: 2, status: 'OK', farmerId: 'f-1', name: 'রহিম' },
        { row: 3, status: 'FAILED', errorCode: 'ERR_FARMER_PHONE_EXISTS', message: 'Already registered' },
      ],
    });
    await settle();

    const rows = [...el().querySelectorAll('[data-testid="import-results"] tbody tr')];
    expect(rows.length).toBe(2);
    // Row numbers are the server's, 1-based including the header.
    expect(rows[0]!.textContent).toContain('2');
    expect(rows[1]!.textContent).toContain('3');
  });

  it('carries the row status as TEXT, not colour alone (WEB-UX-044)', async () => {
    await settle();
    await choose(`${HEADER}\nরহিম,${PHONE},30,3026,bn`);
    click('import-submit');
    await settle();

    http.expectOne(IMPORT_URL).flush({
      succeeded: 0,
      failed: 1,
      results: [{ row: 2, status: 'FAILED', errorCode: 'ERR_PHONE_INVALID' }],
    });
    await settle();

    expect(el().textContent).toContain(farmersFragment['farmers.import.results.status.FAILED'].bn);
  });

  it('never renders the contents of the chosen file, which hold phone numbers', async () => {
    await settle();
    await choose(`${HEADER}\nরহিম,${PHONE},30,3026,bn`);

    expect(el().textContent ?? '').not.toContain(PHONE);
    // What IS shown about the file is its name and its row count.
    expect(el().querySelector('[data-testid="import-file-summary"]')?.textContent).toContain(
      'farmers.csv',
    );
  });

  it('refuses a file whose header is not the template, without spending a request', async () => {
    await settle();
    await choose(`${HEADER},village\nরহিম,${PHONE},30,3026,bn,Shibpur`);

    expect(el().querySelector('[data-testid="import-rejection"]')?.textContent).toContain(
      farmersFragment['farmers.import.reject.badHeader'].bn,
    );
    click('import-submit');
    await settle();
    http.expectNone(IMPORT_URL);
  });

  it('refuses more rows than the server would accept, without spending a request', async () => {
    await settle();
    const rows = Array.from(
      { length: APP_CONFIG.farmers.importMaxRows + 1 },
      (_, i) => `কৃষক,0171234${String(i).padStart(4, '0')},30,3026,bn`,
    );
    await choose(`${HEADER}\n${rows.join('\n')}`);

    expect(el().querySelector('[data-testid="import-rejection"]')).not.toBeNull();
    click('import-submit');
    await settle();
    http.expectNone(IMPORT_URL);
  });

  it('explains a whole-request rejection in the feature’s own words', async () => {
    await settle();
    await choose(`${HEADER}\nরহিম,${PHONE},30,3026,bn`);
    click('import-submit');
    await settle();

    http.expectOne(IMPORT_URL).flush(
      { title: 'Unsupported', code: 'ERR_UNSUPPORTED_MEDIA_TYPE', status: 415, correlationId: 'c-1' },
      { status: 415, statusText: 'Unsupported Media Type' },
    );
    await settle();

    expect(el().querySelector('[data-testid="import-error"]')?.textContent).toContain(
      farmersFragment['farmers.error.unsupportedMediaType'].bn,
    );
  });

  it('does not send an Idempotency-Key — the contract declares none on this operation', async () => {
    await settle();
    await choose(`${HEADER}\nরহিম,${PHONE},30,3026,bn`);
    click('import-submit');
    await settle();

    const request = http.expectOne(IMPORT_URL);
    expect(request.request.headers.has('Idempotency-Key')).toBe(false);
    request.flush({ succeeded: 1, failed: 0, results: [{ row: 2, status: 'OK' }] });
    await settle();
  });
});
