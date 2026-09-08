import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { APP_CONFIG } from '../../config/app-config';
import {
  IMAGE_VARIANT_DERIVATIVE,
  IMAGE_VARIANT_ORIGINAL,
  MediaUrlService,
} from './media-url.service';

/**
 * The out-of-contract service is the one place a path is hand-written, so it is the one place a
 * typo cannot be caught by regenerating the client. These tests are the substitute for that.
 */

const API = APP_CONFIG.api.origin;
const CASE_ID = '01a07caa-d991-7bae-9f48-5cc9a972cde8';
const IMAGE_ID = '01a07caa-d991-7c10-9f49-041142693110';

const PRESIGNED = {
  url: 'http://127.0.0.1:9000/foshol-cases/cases/x/img/y.jpg?X-Amz-Signature=deadbeef',
  expiresAt: '2026-09-07T18:26:02.387445Z',
};

describe('MediaUrlService (out of contract, D-02)', () => {
  let service: MediaUrlService;
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(MediaUrlService);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it('requests the image URL from the API origin only (WEB-SEC-003)', async () => {
    const promise = service.imageUrl(CASE_ID, IMAGE_ID, IMAGE_VARIANT_DERIVATIVE);

    const req = backend.expectOne(
      (r) => r.url === `${API}/api/v1/cases/${CASE_ID}/images/${IMAGE_ID}/url`,
    );
    expect(new URL(req.request.url).origin).toBe(new URL(API).origin);
    req.flush(PRESIGNED);

    await expect(promise).resolves.toEqual(PRESIGNED);
  });

  /**
   * The trap this whole file exists to avoid: `/url` defaults to `original` while `/content`
   * defaults to `DERIVATIVE`, so an omitted parameter silently downloads full-size originals
   * for every thumbnail in the queue.
   */
  it('always sends variant explicitly, and sends the lowercase literal the server matches', async () => {
    const derivative = service.imageUrl(CASE_ID, IMAGE_ID, IMAGE_VARIANT_DERIVATIVE);
    const derivativeReq = backend.expectOne((r) => r.params.get('variant') === 'derivative');
    derivativeReq.flush(PRESIGNED);
    await derivative;

    const original = service.imageUrl(CASE_ID, IMAGE_ID, IMAGE_VARIANT_ORIGINAL);
    const originalReq = backend.expectOne((r) => r.params.get('variant') === 'original');
    originalReq.flush(PRESIGNED);
    await original;
  });

  it('escapes path segments rather than interpolating them raw', async () => {
    const promise = service.imageUrl('a/b', 'c d', IMAGE_VARIANT_ORIGINAL);
    const req = backend.expectOne((r) => r.url.includes('a%2Fb') && r.url.includes('c%20d'));
    req.flush(PRESIGNED);
    await promise;
  });

  it('requests the audio URL with no variant parameter', async () => {
    const promise = service.audioUrl(CASE_ID);
    const req = backend.expectOne(`${API}/api/v1/cases/${CASE_ID}/audio/url`);
    expect(req.request.params.keys().length).toBe(0);
    req.flush(PRESIGNED);
    await promise;
  });
});
