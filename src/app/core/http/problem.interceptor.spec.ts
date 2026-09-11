import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, type Navigation } from '@angular/router';
import type { Principal } from '../../generated/models/principal';
import { SessionStore } from '../auth/session-store';
import { APP_CONFIG } from '../config/app-config';
import { ErrorBus } from '../errors/error-bus';
import { CORRELATION_ID_HEADER } from '../errors/problem';
import { problemInterceptor } from './problem.interceptor';

/** WEB-FR-005 / WEB-FR-013 / WEB-API-002 — the one place every failure is handled. */

const API = APP_CONFIG.api.origin;
const TOKEN = 'header.eyJyb2xlIjoiRkFSTUVSIn0.signature';
const FARMER: Principal = { id: 'p-1', name: 'Demo Farmer', role: 'FARMER' };
const ID = '01a07caa-d705-7ad0-a51b-f334668c9f99';

const problemDocument = {
  type: 'https://foshol.local/problems/err-example',
  title: 'Bad Request',
  status: 400,
  detail: 'Human-readable explanation.',
  code: 'ERR_EXAMPLE',
  correlationId: ID,
  errors: [{ field: 'phone', message: 'must be E.164' }],
};

describe('problemInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let bus: ErrorBus;
  let session: SessionStore;
  let router: Router;
  let navigate: ReturnType<typeof vi.spyOn>;

  const atUrl = (url: string): void => {
    vi.spyOn(router, 'url', 'get').mockReturnValue(url);
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([problemInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
    bus = TestBed.inject(ErrorBus);
    session = TestBed.inject(SessionStore);
    router = TestBed.inject(Router);
    navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    session.signIn(TOKEN, FARMER, new Date());
  });

  afterEach(() => {
    backend.verify();
    vi.restoreAllMocks();
  });

  it('maps a problem document onto the bus with its correlationId (WEB-FR-005)', async () => {
    const failure = new Promise((resolve) =>
      http.post(`${API}/api/v1/cases`, {}).subscribe({ error: resolve }),
    );
    backend
      .expectOne(`${API}/api/v1/cases`)
      .flush(problemDocument, { status: 400, statusText: 'Bad Request' });
    await failure;

    const problem = bus.lastProblem();
    expect(problem?.correlationId).toBe(ID);
    expect(problem?.title).toBe('Bad Request');
    expect(problem?.detail).toBe('Human-readable explanation.');
    expect(problem?.code).toBe('ERR_EXAMPLE');
    expect(problem?.fieldErrors).toEqual([{ field: 'phone', message: 'must be E.164' }]);
  });

  it('rethrows so a caller can still handle its own failure', async () => {
    let caught: unknown = null;
    const failure = new Promise((resolve) =>
      http.get(`${API}/api/v1/cases`).subscribe({
        error: (e: unknown) => {
          caught = e;
          resolve(e);
        },
      }),
    );
    backend.expectOne(`${API}/api/v1/cases`).flush({}, { status: 500, statusText: 'Server Error' });
    await failure;
    expect(caught).not.toBeNull();
  });

  it('on 401 clears the session and retains the attempted route (WEB-FR-013)', async () => {
    atUrl('/farmer/cases/42');
    const failure = new Promise((resolve) =>
      http.get(`${API}/api/v1/cases`).subscribe({ error: resolve }),
    );
    backend.expectOne(`${API}/api/v1/cases`).flush({}, { status: 401, statusText: 'Unauthorized' });
    await failure;

    expect(session.isAuthenticated()).toBe(false);
    expect(session.intendedUrl()).toBe('/farmer/cases/42');
    expect(navigate).toHaveBeenCalledWith('/auth/farmer');
  });

  it('on 401 inside the console returns to the officer login', async () => {
    atUrl('/officer/queue');
    const failure = new Promise((resolve) =>
      http.get(`${API}/api/v1/review/queue`).subscribe({ error: resolve }),
    );
    backend
      .expectOne(`${API}/api/v1/review/queue`)
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    await failure;
    expect(navigate).toHaveBeenCalledWith('/auth/officer');
  });

  it('on 401 from the admin surface returns to the officer login', async () => {
    atUrl('/admin/stats');
    const failure = new Promise((resolve) =>
      http.get(`${API}/api/v1/admin/stats`).subscribe({ error: resolve }),
    );
    backend
      .expectOne(`${API}/api/v1/admin/stats`)
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    await failure;
    expect(navigate).toHaveBeenCalledWith('/auth/officer');
  });

  it('on 401 before the first navigation lands, uses the URL being navigated to (D-37)', async () => {
    // A session restored after a reload makes requests at bootstrap, while Router.url is still `/`.
    atUrl('/');
    vi.spyOn(router, 'getCurrentNavigation').mockReturnValue({
      extractedUrl: router.parseUrl('/officer/queue?page=2'),
    } as Navigation);
    const failure = new Promise((resolve) =>
      http.get(`${API}/api/v1/review/kpi-warnings`).subscribe({ error: resolve }),
    );
    backend
      .expectOne(`${API}/api/v1/review/kpi-warnings`)
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    await failure;

    expect(session.intendedUrl()).toBe('/officer/queue?page=2');
    expect(navigate).toHaveBeenCalledWith('/auth/officer');
  });

  it('leaves a wrong OTP to the login form: no redirect, no session clear', async () => {
    atUrl('/auth/farmer');
    const failure = new Promise((resolve) =>
      http.post(`${API}/api/v1/auth/otp/verify`, {}).subscribe({ error: resolve }),
    );
    backend
      .expectOne(`${API}/api/v1/auth/otp/verify`)
      .flush({ code: 'ERR_OTP_INVALID', title: 'Unauthorized', correlationId: ID, status: 401 }, {
        status: 401,
        statusText: 'Unauthorized',
      });
    await failure;

    expect(navigate).not.toHaveBeenCalled();
    expect(bus.lastProblem()?.code).toBe('ERR_OTP_INVALID');
  });

  it('reads the correlation id from the response header when the body carries none', async () => {
    const failure = new Promise((resolve) =>
      http.get(`${API}/api/v1/cases`).subscribe({ error: resolve }),
    );
    backend.expectOne(`${API}/api/v1/cases`).flush('<html>gateway</html>', {
      status: 502,
      statusText: 'Bad Gateway',
      headers: { [CORRELATION_ID_HEADER]: ID },
    });
    await failure;

    const problem = bus.lastProblem();
    expect(problem?.correlationId).toBe(ID);
    // WEB-FR-404 — an opaque gateway page is never shown to a farmer.
    expect(problem?.title).toBeNull();
    expect(problem?.titleKey).toBe('errors.generic.title');
  });
});
