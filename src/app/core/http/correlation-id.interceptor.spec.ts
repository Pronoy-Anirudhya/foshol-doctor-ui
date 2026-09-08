import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { APP_CONFIG } from '../config/app-config';
import { CORRELATION_ID_HEADER } from '../errors/problem';
import { CorrelationIdStore, correlationIdInterceptor } from './correlation-id.interceptor';

/** WEB-FR-006 — send the id when continuing a flow, adopt the server's value otherwise. */

const API = APP_CONFIG.api.origin;
const PRESIGNED = 'http://localhost:9000/foshol-media/derivative/abc.jpg?X-Amz-Signature=deadbeef';
const ID = '01a07caa-d705-7ad0-a51b-f334668c9f99';

describe('correlationIdInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let store: CorrelationIdStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([correlationIdInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
    store = TestBed.inject(CorrelationIdStore);
  });

  afterEach(() => backend.verify());

  it('sends no id on the first request of a session', () => {
    http.get(`${API}/api/v1/cases`).subscribe();
    const req = backend.expectOne(`${API}/api/v1/cases`);
    expect(req.request.headers.has(CORRELATION_ID_HEADER)).toBe(false);
    req.flush([]);
  });

  it('adopts the id from a response and quotes it back on the next request', () => {
    http.get(`${API}/api/v1/cases`).subscribe();
    backend.expectOne(`${API}/api/v1/cases`).flush([], { headers: { [CORRELATION_ID_HEADER]: ID } });
    expect(store.current()).toBe(ID);

    http.get(`${API}/api/v1/cases/1`).subscribe();
    const next = backend.expectOne(`${API}/api/v1/cases/1`);
    expect(next.request.headers.get(CORRELATION_ID_HEADER)).toBe(ID);
    next.flush({});
  });

  it('adopts the id from a failure, which is when it matters most', () => {
    http.get(`${API}/api/v1/cases`).subscribe({ error: () => undefined });
    backend
      .expectOne(`${API}/api/v1/cases`)
      .flush({}, { status: 503, statusText: 'Service Unavailable', headers: { [CORRELATION_ID_HEADER]: ID } });
    expect(store.current()).toBe(ID);
  });

  it('sends nothing to a presigned object-store URL (WEB-SEC-003)', () => {
    store.adopt(ID);
    http.get(PRESIGNED, { responseType: 'blob' }).subscribe();
    const req = backend.expectOne(PRESIGNED);
    expect(req.request.headers.has(CORRELATION_ID_HEADER)).toBe(false);
    req.flush(new Blob());
  });

  it('reset clears the remembered id so it never bleeds between sessions', () => {
    store.adopt(ID);
    store.reset();
    expect(store.current()).toBeNull();
  });
});
