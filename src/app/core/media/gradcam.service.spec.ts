import { TestBed } from '@angular/core/testing';
import type { Principal } from '../../generated/models/principal';
import { SessionStore } from '../auth/session-store';
import { APP_CONFIG } from '../config/app-config';
import { GradcamService, GradcamUnavailableError } from './gradcam.service';

const TOKEN = 'header.eyJyb2xlIjoiT0ZGSUNFUiJ9.signature';
const OFFICER: Principal = { id: 'p-2', name: 'Demo Officer', role: 'OFFICER' };
const CASE_ID = '01a07caa-d991-7bae-9f48-5cc9a972cde8';
const OBJECT_URL = 'blob:http://localhost:4200/fake';

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

    TestBed.configureTestingModule({});
    service = TestBed.inject(GradcamService);
    session = TestBed.inject(SessionStore);
    session.signIn(TOKEN, OFFICER, new Date());
  });

  afterEach(() => vi.unstubAllGlobals());

  const okResponse = (): Response =>
    ({ ok: true, status: 200, blob: () => Promise.resolve(new Blob()) }) as unknown as Response;

  it('builds the URL from the generated path constant, not a hand-written string (WEB-API-001)', async () => {
    fetchMock.mockResolvedValue(okResponse());

    await service.load(CASE_ID);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${APP_CONFIG.api.origin}/api/v1/cases/${CASE_ID}/gradcam`);
  });

  /**
   * WEB-SEC-003 — the bearer is set, and it is set on a URL asserted to be the API origin. The
   * browser drops it on the cross-origin redirect into the object store; MinIO rejects a
   * presigned GET that also carries one with 400 InvalidRequest.
   */
  it('sends the bearer, omits credentials and follows the redirect', async () => {
    fetchMock.mockResolvedValue(okResponse());

    await service.load(CASE_ID);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${TOKEN}`);
    expect(init.credentials).toBe('omit');
    expect(init.redirect).toBe('follow');
  });

  it('turns the response into an object URL the caller owns', async () => {
    fetchMock.mockResolvedValue(okResponse());

    await expect(service.load(CASE_ID)).resolves.toBe(OBJECT_URL);
    expect(created.length).toBe(1);
  });

  it('revokes an object URL on request, and ignores a null', () => {
    service.revoke(OBJECT_URL);
    service.revoke(null);
    expect(revoked).toEqual([OBJECT_URL]);
  });

  /** WEB-FR-212 — the caller must be able to treat every failure the same way. */
  it('reports 404 as unavailable rather than as a bare HTTP error', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 } as unknown as Response);

    await expect(service.load(CASE_ID)).rejects.toBeInstanceOf(GradcamUnavailableError);
  });

  it('reports a blocked or offline fetch as unavailable with no status', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(service.load(CASE_ID)).rejects.toMatchObject({ status: 0 });
  });

  /**
   * Two components asking at once share the request but NOT the object URL: the first to be
   * destroyed would otherwise revoke the image out from under the second.
   */
  it('shares one request between concurrent callers but mints an object URL each', async () => {
    fetchMock.mockResolvedValue(okResponse());

    await Promise.all([service.load(CASE_ID), service.load(CASE_ID)]);

    expect(fetchMock.mock.calls.length).toBe(1);
    expect(created.length).toBe(2);
  });
});
