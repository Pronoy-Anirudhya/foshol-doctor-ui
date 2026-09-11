import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Principal } from '../../generated/models/principal';
import { SessionStore } from '../auth/session-store';
import { APP_CONFIG } from '../config/app-config';
import {
  CASE_IMAGE_DERIVATIVE,
  CASE_IMAGE_ORIGINAL,
  CaseImageContentService,
} from './case-image-content.service';
import { MediaFetchError } from './redirected-blob';

const TOKEN = 'header.eyJyb2xlIjoiT0ZGSUNFUiJ9.signature';
const OFFICER: Principal = { id: 'p-2', name: 'Demo Officer', role: 'OFFICER' };
const CASE_ID = '01a07caa-d991-7bae-9f48-5cc9a972cde8';
const IMAGE_ID = '01a07caa-d991-7c10-9f49-041142693110';
const OBJECT_URL = 'blob:http://localhost:4200/photo';

describe('CaseImageContentService (WEB-FR-210, D-38)', () => {
  let service: CaseImageContentService;
  let fetchMock: ReturnType<typeof vi.fn>;
  let revoked: string[];

  beforeEach(() => {
    revoked = [];
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    URL.createObjectURL = (): string => OBJECT_URL;
    URL.revokeObjectURL = (url: string): void => {
      revoked.push(url);
    };

    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    service = TestBed.inject(CaseImageContentService);
    TestBed.inject(SessionStore).signIn(TOKEN, OFFICER, new Date());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const ok = (): Response =>
    ({
      ok: true,
      status: 200,
      redirected: true,
      headers: new Headers(),
      blob: () => Promise.resolve(new Blob(['jpeg'])),
    }) as unknown as Response;

  const requested = (): string => (fetchMock.mock.calls[0] as [string, RequestInit])[0];

  it('asks the contract content operation for the original by name (WEB-API-001)', async () => {
    fetchMock.mockResolvedValue(ok());

    await service.load(CASE_ID, IMAGE_ID, CASE_IMAGE_ORIGINAL);

    expect(requested()).toBe(
      `${APP_CONFIG.api.origin}/api/v1/cases/${CASE_ID}/images/${IMAGE_ID}/content?variant=ORIGINAL`,
    );
  });

  /** The server defaults to the derivative; the client still says so rather than relying on it. */
  it('names the derivative too, never leaving it to the server default', async () => {
    fetchMock.mockResolvedValue(ok());

    await service.load(CASE_ID, IMAGE_ID, CASE_IMAGE_DERIVATIVE);

    expect(new URL(requested()).searchParams.get('variant')).toBe('DERIVATIVE');
  });

  it('returns an object URL the caller owns, and revokes it on request', async () => {
    fetchMock.mockResolvedValue(ok());

    await expect(service.load(CASE_ID, IMAGE_ID, CASE_IMAGE_ORIGINAL)).resolves.toBe(OBJECT_URL);
    service.revoke(OBJECT_URL);
    service.revoke(null);
    expect(revoked).toEqual([OBJECT_URL]);
  });

  it('rejects with the fetch failure when the photograph cannot be served', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      redirected: false,
      headers: new Headers(),
    } as unknown as Response);

    await expect(service.load(CASE_ID, IMAGE_ID, CASE_IMAGE_ORIGINAL)).rejects.toBeInstanceOf(
      MediaFetchError,
    );
  });
});
