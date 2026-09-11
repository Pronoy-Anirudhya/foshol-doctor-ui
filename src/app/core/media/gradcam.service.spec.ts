import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Principal } from '../../generated/models/principal';
import { SessionStore } from '../auth/session-store';
import { APP_CONFIG } from '../config/app-config';
import { GradcamFailedError, GradcamService, GradcamUnavailableError } from './gradcam.service';

const TOKEN = 'header.eyJyb2xlIjoiT0ZGSUNFUiJ9.signature';
const OFFICER: Principal = { id: 'p-2', name: 'Demo Officer', role: 'OFFICER' };
const CASE_ID = '01a07caa-d991-7bae-9f48-5cc9a972cde8';
const OBJECT_URL = 'blob:http://localhost:4200/fake';
const CORRELATION_ID = '01a07caa-d705-7ad0-a51b-f334668c9f99';

/** The WEB-SEC-003 header rules are asserted in `redirected-blob.spec.ts`, where they live. */
describe('GradcamService', () => {
  let service: GradcamService;
  let session: SessionStore;
  let fetchMock: ReturnType<typeof vi.fn>;
  let created: Blob[];
  let revoked: string[];

  beforeEach(() => {
    created = [];
    revoked = [];
    fetchMock = vi.fn();

    vi.stubGlobal('fetch', fetchMock);

    // Only the two statics are replaced. Swapping the whole `URL` global would break
    // `new URL(path, origin)`, which is how the service builds the request in the first place.
    URL.createObjectURL = (blob: Blob | MediaSource): string => {
      created.push(blob as Blob);
      return OBJECT_URL;
    };
    URL.revokeObjectURL = (url: string): void => {
      revoked.push(url);
    };

    // A catch-all route, because the 401 case really does navigate to the login.
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: '**', children: [] }])] });
    service = TestBed.inject(GradcamService);
    session = TestBed.inject(SessionStore);
    session.signIn(TOKEN, OFFICER, new Date());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const reply = (status: number, body?: unknown): Response =>
    ({
      ok: status >= 200 && status < 300,
      status,
      redirected: status === 200,
      headers: new Headers(body === undefined ? {} : { 'Content-Type': 'application/problem+json' }),
      blob: () => Promise.resolve(new Blob()),
      json: () => Promise.resolve(body),
    }) as unknown as Response;

  it('builds the URL from the generated path constant, not a hand-written string (WEB-API-001)', async () => {
    fetchMock.mockResolvedValue(reply(200));

    await service.load(CASE_ID);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${APP_CONFIG.api.origin}/api/v1/cases/${CASE_ID}/gradcam`);
  });

  it('turns the response into an object URL the caller owns', async () => {
    fetchMock.mockResolvedValue(reply(200));

    await expect(service.load(CASE_ID)).resolves.toBe(OBJECT_URL);
    expect(created.length).toBe(1);
  });

  it('revokes an object URL on request, and ignores a null', () => {
    service.revoke(OBJECT_URL);
    service.revoke(null);
    expect(revoked).toEqual([OBJECT_URL]);
  });

  /** WEB-FR-212 — "no overlay" is an answer, not an error to show. */
  it('reports 404 as unavailable', async () => {
    fetchMock.mockResolvedValue(reply(404));

    await expect(service.load(CASE_ID)).rejects.toBeInstanceOf(GradcamUnavailableError);
  });

  it('reports a blocked or offline fetch as unavailable with no status', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(service.load(CASE_ID)).rejects.toMatchObject({ status: 0 });
  });

  /** An expired session is handled by `expireSession`; the overlay simply has nothing to offer. */
  it('reports 401 as unavailable, after ending the session', async () => {
    fetchMock.mockResolvedValue(reply(401));

    await expect(service.load(CASE_ID)).rejects.toBeInstanceOf(GradcamUnavailableError);
    expect(session.isAuthenticated()).toBe(false);
  });

  /** WEB-FR-005 — a storage outage carries its problem so the case detail can show it. */
  it('reports 503 as a failure carrying the problem', async () => {
    fetchMock.mockResolvedValue(
      reply(503, {
        status: 503,
        code: 'ERR_STORAGE_UNAVAILABLE',
        title: 'Service Unavailable',
        detail: 'Object store is unavailable.',
        correlationId: CORRELATION_ID,
      }),
    );

    const failure = await service.load(CASE_ID).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(GradcamFailedError);
    expect((failure as GradcamFailedError).problem.correlationId).toBe(CORRELATION_ID);
  });

  /**
   * Two components asking at once share the request but NOT the object URL: the first to be
   * destroyed would otherwise revoke the image out from under the second.
   */
  it('shares one request between concurrent callers but mints an object URL each', async () => {
    fetchMock.mockResolvedValue(reply(200));

    await Promise.all([service.load(CASE_ID), service.load(CASE_ID)]);

    expect(fetchMock.mock.calls.length).toBe(1);
    expect(created.length).toBe(2);
  });
});
