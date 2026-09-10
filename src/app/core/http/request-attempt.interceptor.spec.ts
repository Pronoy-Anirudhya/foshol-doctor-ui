import { HttpClient, HttpContext, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { APP_CONFIG } from '../config/app-config';
import { CORRELATION_ID_HEADER } from '../errors/problem';
import { correlationIdInterceptor, CorrelationIdStore } from './correlation-id.interceptor';
import {
  ATTEMPT_CORRELATION_ID,
  REQUEST_TIMEOUT_MS,
  requestAttemptInterceptor,
} from './request-attempt.interceptor';

/**
 * Two opt-in request decorations, and the rule that both are opt-in.
 *
 * The default matters more than the feature: every request in the application that says nothing
 * must come out untouched, or this interceptor has quietly changed the timeout behaviour of the
 * whole client.
 */
const API = APP_CONFIG.api.origin;
const OTHER_ORIGIN = 'https://minio.example.com/bucket/object';
const ATTEMPT = '01a0aaaa-bbbb-7ccc-8ddd-eeeeeeeeeeee';
const REMEMBERED = '01a0ffff-bbbb-7ccc-8ddd-eeeeeeeeeeee';

describe('requestAttemptInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        // Registered in the same order as app.config.ts, because the ORDER is the contract.
        provideHttpClient(withInterceptors([requestAttemptInterceptor, correlationIdInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    backend.verify();
    TestBed.resetTestingModule();
  });

  it('leaves an ordinary request completely alone', () => {
    http.get(`${API}/api/v1/crops`).subscribe();

    const request = backend.expectOne(`${API}/api/v1/crops`);
    expect(request.request.timeout).toBeUndefined();
    expect(request.request.headers.has(CORRELATION_ID_HEADER)).toBe(false);
    request.flush([]);
  });

  it('applies a timeout only when one was asked for', () => {
    const context = new HttpContext().set(REQUEST_TIMEOUT_MS, APP_CONFIG.faq.requestTimeoutMs);
    http.get(`${API}/api/v1/crops`, { context }).subscribe();

    const request = backend.expectOne(`${API}/api/v1/crops`);
    expect(request.request.timeout).toBe(APP_CONFIG.faq.requestTimeoutMs);
    request.flush([]);
  });

  it('sends the attempt id the caller minted', () => {
    const context = new HttpContext().set(ATTEMPT_CORRELATION_ID, ATTEMPT);
    http.get(`${API}/api/v1/crops`, { context }).subscribe();

    const request = backend.expectOne(`${API}/api/v1/crops`);
    expect(request.request.headers.get(CORRELATION_ID_HEADER)).toBe(ATTEMPT);
    request.flush([]);
  });

  it('lets the attempt id win over the remembered one, because it runs first', () => {
    // A previous exchange left an id behind; a NEW interaction must not inherit it.
    TestBed.inject(CorrelationIdStore).adopt(REMEMBERED);
    const context = new HttpContext().set(ATTEMPT_CORRELATION_ID, ATTEMPT);
    http.get(`${API}/api/v1/crops`, { context }).subscribe();

    const request = backend.expectOne(`${API}/api/v1/crops`);
    expect(request.request.headers.get(CORRELATION_ID_HEADER)).toBe(ATTEMPT);
    request.flush([]);
  });

  it('still quotes the remembered id back when the caller minted none', () => {
    TestBed.inject(CorrelationIdStore).adopt(REMEMBERED);
    http.get(`${API}/api/v1/crops`).subscribe();

    const request = backend.expectOne(`${API}/api/v1/crops`);
    expect(request.request.headers.get(CORRELATION_ID_HEADER)).toBe(REMEMBERED);
    request.flush([]);
  });

  it('never decorates a presigned object-store URL (WEB-SEC-003)', () => {
    const context = new HttpContext()
      .set(ATTEMPT_CORRELATION_ID, ATTEMPT)
      .set(REQUEST_TIMEOUT_MS, APP_CONFIG.faq.requestTimeoutMs);
    http.get(OTHER_ORIGIN, { context }).subscribe();

    const request = backend.expectOne(OTHER_ORIGIN);
    expect(request.request.headers.has(CORRELATION_ID_HEADER)).toBe(false);
    expect(request.request.timeout).toBeUndefined();
    request.flush({});
  });
});
