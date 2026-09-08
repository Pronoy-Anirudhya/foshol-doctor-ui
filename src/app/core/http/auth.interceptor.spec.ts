import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Principal } from '../../generated/models/principal';
import { SessionStore } from '../auth/session-store';
import { APP_CONFIG } from '../config/app-config';
import { authInterceptor, isApiOriginUrl, isPublicAuthUrl } from './auth.interceptor';

/** WEB-TEST-006 — the auth interceptor is unit tested, not assumed. */

const TOKEN = 'header.eyJyb2xlIjoiRkFSTUVSIn0.signature';
const FARMER: Principal = { id: 'p-1', name: 'Demo Farmer', role: 'FARMER' };
const API = APP_CONFIG.api.origin;
const PRESIGNED = 'http://localhost:9000/foshol-media/derivative/abc.jpg?X-Amz-Signature=deadbeef';

describe('authInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let session: SessionStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
    session = TestBed.inject(SessionStore);
    session.signIn(TOKEN, FARMER, new Date());
  });

  afterEach(() => backend.verify());

  it('attaches the bearer token to a request on the API origin (WEB-SEC-002)', () => {
    http.get(`${API}/api/v1/cases`).subscribe();
    const req = backend.expectOne(`${API}/api/v1/cases`);
    expect(req.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    req.flush([]);
  });

  it('attaches the bearer token to a relative API URL', () => {
    http.get('/api/v1/me').subscribe();
    const req = backend.expectOne('/api/v1/me');
    expect(req.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    req.flush(FARMER);
  });

  it('never attaches the bearer token to a presigned object-store URL (WEB-SEC-003)', () => {
    http.get(PRESIGNED, { responseType: 'blob' }).subscribe();
    const req = backend.expectOne(PRESIGNED);
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush(new Blob());
  });

  it('skips the header on the three public auth endpoints', () => {
    for (const path of [
      '/api/v1/auth/otp/request',
      '/api/v1/auth/otp/verify',
      '/api/v1/auth/officer/login',
    ]) {
      http.post(`${API}${path}`, {}).subscribe();
      const req = backend.expectOne(`${API}${path}`);
      expect(req.request.headers.has('Authorization')).toBe(false);
      req.flush({});
    }
  });

  it('sends no Authorization header when there is no session', () => {
    session.clear();
    http.get(`${API}/api/v1/cases`).subscribe();
    const req = backend.expectOne(`${API}/api/v1/cases`);
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush([]);
  });

  it('puts the token in no URL, query parameter or fragment (WEB-SEC-002)', () => {
    http.get(`${API}/api/v1/cases`, { params: { page: 0, size: 20 } }).subscribe();
    http.get(PRESIGNED, { responseType: 'blob' }).subscribe();

    for (const req of backend.match(() => true)) {
      expect(req.request.urlWithParams).not.toContain(TOKEN);
      expect(req.request.urlWithParams.toLowerCase()).not.toContain('bearer');
      req.flush(null);
    }
  });
});

describe('origin and public-path predicates', () => {
  it('treats relative URLs as the API origin and foreign hosts as not', () => {
    expect(isApiOriginUrl('/api/v1/cases')).toBe(true);
    expect(isApiOriginUrl(`${API}/api/v1/cases`)).toBe(true);
    expect(isApiOriginUrl(PRESIGNED)).toBe(false);
    // A protocol-relative URL resolves to a foreign host, so it must not be the API origin.
    expect(isApiOriginUrl('//localhost:9000/foshol-media/abc.jpg')).toBe(false);
  });

  it('recognises the public auth paths regardless of query string', () => {
    expect(isPublicAuthUrl(`${API}/api/v1/auth/otp/verify?x=1`)).toBe(true);
    expect(isPublicAuthUrl('/api/v1/auth/officer/login')).toBe(true);
    expect(isPublicAuthUrl('/api/v1/me')).toBe(false);
  });
});
