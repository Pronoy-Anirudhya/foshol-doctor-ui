import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { Principal } from '../../generated/models/principal';
import { SessionStore } from '../auth/session-store';
import { APP_CONFIG } from '../config/app-config';
import { MediaFetchError, RedirectedBlobFetcher } from './redirected-blob';

const TOKEN = 'header.eyJyb2xlIjoiT0ZGSUNFUiJ9.signature';
const OFFICER: Principal = { id: 'p-2', name: 'Demo Officer', role: 'OFFICER' };
const API_URL = `${APP_CONFIG.api.origin}/api/v1/cases/c-1/gradcam`;
const CORRELATION_ID = '01a07caa-d705-7ad0-a51b-f334668c9f99';

interface Reply {
  readonly status: number;
  readonly redirected?: boolean;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

function reply({ status, redirected = false, body, headers = {} }: Reply): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    redirected,
    headers: new Headers(headers),
    blob: () => Promise.resolve(new Blob(['png'])),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('RedirectedBlobFetcher (WEB-SEC-003, D-38)', () => {
  let fetcher: RedirectedBlobFetcher;
  let session: SessionStore;
  let fetchMock: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    fetcher = TestBed.inject(RedirectedBlobFetcher);
    session = TestBed.inject(SessionStore);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    session.signIn(TOKEN, OFFICER, new Date());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /**
   * The bearer and nothing else. `X-Correlation-Id` or `Accept-Language` would survive the
   * redirect and force a CORS preflight on the object store; `Authorization` is dropped by it.
   */
  it('sends only the bearer, omits credentials and follows the redirect', async () => {
    fetchMock.mockResolvedValue(reply({ status: 200, redirected: true }));

    await fetcher.fetchBlob(API_URL);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(url).toBe(API_URL);
    expect(headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    expect([...headers.keys()]).toEqual(['authorization']);
    expect(init.credentials).toBe('omit');
    expect(init.redirect).toBe('follow');
  });

  it('refuses to send the bearer anywhere but the API origin', async () => {
    await expect(fetcher.fetchBlob('https://store.example/cases/x.png')).rejects.toMatchObject({
      status: 0,
      problem: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /** COMMON-SEC-016 — a presign that lapsed before the object-store GET gets one fresh 302. */
  it('asks for a fresh redirect once when the presigned URL has expired', async () => {
    fetchMock
      .mockResolvedValueOnce(reply({ status: 403, redirected: true }))
      .mockResolvedValueOnce(reply({ status: 200, redirected: true }));

    await expect(fetcher.fetchBlob(API_URL)).resolves.toBeInstanceOf(Blob);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a second time', async () => {
    fetchMock.mockResolvedValue(reply({ status: 403, redirected: true }));

    await expect(fetcher.fetchBlob(API_URL)).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  /** WEB-FR-013 — the same ending an `HttpClient` 401 gets from the problem interceptor. */
  it("ends the session on the API's own 401", async () => {
    fetchMock.mockResolvedValue(reply({ status: 401 }));

    await expect(fetcher.fetchBlob(API_URL)).rejects.toBeInstanceOf(MediaFetchError);
    expect(session.isAuthenticated()).toBe(false);
    expect(navigate).toHaveBeenCalled();
  });

  /** WEB-FR-005 — a storage outage reads like any other problem: title, detail, correlation id. */
  it('reduces a problem document to a ProblemView', async () => {
    fetchMock.mockResolvedValue(
      reply({
        status: 503,
        headers: { 'Content-Type': 'application/problem+json' },
        body: {
          status: 503,
          code: 'ERR_STORAGE_UNAVAILABLE',
          title: 'Service Unavailable',
          detail: 'Object store is unavailable.',
          correlationId: CORRELATION_ID,
        },
      }),
    );

    const failure = await fetcher.fetchBlob(API_URL).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(MediaFetchError);
    const problem = (failure as MediaFetchError).problem;
    expect(problem?.status).toBe(503);
    expect(problem?.title).toBe('Service Unavailable');
    expect(problem?.detail).toBe('Object store is unavailable.');
    expect(problem?.correlationId).toBe(CORRELATION_ID);
    expect(session.isAuthenticated()).toBe(true);
  });

  it('reports a blocked or offline fetch with no status and no problem', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(fetcher.fetchBlob(API_URL)).rejects.toMatchObject({ status: 0, problem: null });
  });
});
