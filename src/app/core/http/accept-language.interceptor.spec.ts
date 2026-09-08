import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { APP_CONFIG, type Locale } from '../config/app-config';
import { LanguageStore } from '../i18n/language-store';
import { acceptLanguageInterceptor } from './accept-language.interceptor';

/** WEB-FR-006 — Accept-Language matches LanguageStore.current on every API request. */

const API = APP_CONFIG.api.origin;
const PRESIGNED = 'http://localhost:9000/foshol-media/derivative/abc.jpg?X-Amz-Signature=deadbeef';

describe('acceptLanguageInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  const locale = signal<Locale>('bn');

  beforeEach(() => {
    locale.set('bn');
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([acceptLanguageInterceptor])),
        provideHttpClientTesting(),
        // A stub keeps the transport test off ngx-translate and localStorage entirely.
        { provide: LanguageStore, useValue: { current: locale } as unknown as LanguageStore },
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it('sends the active locale on an API request', () => {
    http.get(`${API}/api/v1/crops`).subscribe();
    const req = backend.expectOne(`${API}/api/v1/crops`);
    expect(req.request.headers.get('Accept-Language')).toBe('bn');
    req.flush([]);
  });

  it('follows the toggle without a reload (WEB-UX-012)', () => {
    locale.set('en');
    http.get(`${API}/api/v1/crops`).subscribe();
    const req = backend.expectOne(`${API}/api/v1/crops`);
    expect(req.request.headers.get('Accept-Language')).toBe('en');
    req.flush([]);
  });

  it('sends nothing to a presigned object-store URL', () => {
    http.get(PRESIGNED, { responseType: 'blob' }).subscribe();
    const req = backend.expectOne(PRESIGNED);
    expect(req.request.headers.has('Accept-Language')).toBe(false);
    req.flush(new Blob());
  });
});
