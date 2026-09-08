import { TestBed } from '@angular/core/testing';
import { APP_CONFIG } from '../config/app-config';
import {
  IMAGE_VARIANT_DERIVATIVE,
  IMAGE_VARIANT_ORIGINAL,
  MediaUrlService,
  type PresignedUrlView,
} from './out-of-contract/media-url.service';
import { audioRef, imageRef, mediaKey, SecureMediaService } from './secure-media.service';

const CASE_ID = 'case-1';
const IMAGE_ID = 'image-1';

/** Far enough out that `presignRefreshMarginMs` has not bitten yet. */
const liveUrl = (url: string): PresignedUrlView => ({
  url,
  expiresAt: new Date(Date.now() + APP_CONFIG.storage.presignTtlMs).toISOString(),
});

/** Inside the refresh margin: the cache must treat this as already spent. */
const staleUrl = (url: string): PresignedUrlView => ({
  url,
  expiresAt: new Date(Date.now() + APP_CONFIG.storage.presignRefreshMarginMs / 2).toISOString(),
});

class FakeMediaUrlService {
  imageCalls = 0;
  audioCalls = 0;
  next: PresignedUrlView = liveUrl('https://store.example/one');
  resolveDeferred: ((view: PresignedUrlView) => void) | null = null;

  imageUrl(): Promise<PresignedUrlView> {
    this.imageCalls += 1;
    if (this.resolveDeferred !== null) return this.deferred();
    return Promise.resolve(this.next);
  }

  audioUrl(): Promise<PresignedUrlView> {
    this.audioCalls += 1;
    return Promise.resolve(this.next);
  }

  private deferred(): Promise<PresignedUrlView> {
    return new Promise((resolve) => {
      this.resolveDeferred = resolve;
    });
  }
}

describe('SecureMediaService', () => {
  let service: SecureMediaService;
  let urls: FakeMediaUrlService;

  beforeEach(() => {
    urls = new FakeMediaUrlService();
    TestBed.configureTestingModule({
      providers: [{ provide: MediaUrlService, useValue: urls }],
    });
    service = TestBed.inject(SecureMediaService);
  });

  it('keys the cache by case, image and variant so the variants never collide', () => {
    expect(mediaKey(imageRef(CASE_ID, IMAGE_ID, IMAGE_VARIANT_DERIVATIVE))).toBe(
      `image:${CASE_ID}:${IMAGE_ID}:derivative`,
    );
    expect(mediaKey(imageRef(CASE_ID, IMAGE_ID, IMAGE_VARIANT_ORIGINAL))).toBe(
      `image:${CASE_ID}:${IMAGE_ID}:original`,
    );
    expect(mediaKey(audioRef(CASE_ID))).toBe(`audio:${CASE_ID}`);
  });

  it('presigns once and serves the cached URL afterwards', async () => {
    const ref = imageRef(CASE_ID, IMAGE_ID, IMAGE_VARIANT_DERIVATIVE);

    await expect(service.resolve(ref)).resolves.toBe('https://store.example/one');
    await expect(service.resolve(ref)).resolves.toBe('https://store.example/one');

    expect(urls.imageCalls).toBe(1);
  });

  it('presigns each variant separately', async () => {
    await service.resolve(imageRef(CASE_ID, IMAGE_ID, IMAGE_VARIANT_DERIVATIVE));
    await service.resolve(imageRef(CASE_ID, IMAGE_ID, IMAGE_VARIANT_ORIGINAL));

    expect(urls.imageCalls).toBe(2);
    expect(service.cachedCount()).toBe(2);
  });

  /** A queue of twenty rows mounting at once must not fire twenty presign calls per thumbnail. */
  it('de-duplicates concurrent requests for the same key', async () => {
    urls.resolveDeferred = () => undefined;
    const ref = imageRef(CASE_ID, IMAGE_ID, IMAGE_VARIANT_DERIVATIVE);

    const first = service.resolve(ref);
    const second = service.resolve(ref);
    const third = service.resolve(ref);

    expect(urls.imageCalls).toBe(1);

    urls.resolveDeferred?.(liveUrl('https://store.example/shared'));
    const [a, b, c] = await Promise.all([first, second, third]);
    expect([a, b, c]).toEqual([
      'https://store.example/shared',
      'https://store.example/shared',
      'https://store.example/shared',
    ]);
  });

  /** WEB-DATA-021 — a presigned URL is time-limited by design, so the cache honours the margin. */
  it('re-presigns when the cached URL is inside the refresh margin', async () => {
    const ref = imageRef(CASE_ID, IMAGE_ID, IMAGE_VARIANT_DERIVATIVE);

    urls.next = staleUrl('https://store.example/expiring');
    await service.resolve(ref);

    urls.next = liveUrl('https://store.example/fresh');
    await expect(service.resolve(ref)).resolves.toBe('https://store.example/fresh');
    expect(urls.imageCalls).toBe(2);
  });

  it('refresh() discards the cached entry and presigns again', async () => {
    const ref = imageRef(CASE_ID, IMAGE_ID, IMAGE_VARIANT_DERIVATIVE);
    await service.resolve(ref);

    urls.next = liveUrl('https://store.example/two');
    await expect(service.refresh(ref)).resolves.toBe('https://store.example/two');
    expect(urls.imageCalls).toBe(2);
    expect(service.peek(ref)).toBe('https://store.example/two');
  });

  /** WEB-SEC-004 — a presigned URL keeps working after logout until it expires. */
  it('clearSession() drops every cached URL', async () => {
    const ref = imageRef(CASE_ID, IMAGE_ID, IMAGE_VARIANT_DERIVATIVE);
    await service.resolve(ref);
    expect(service.peek(ref)).not.toBeNull();

    service.clearSession();

    expect(service.peek(ref)).toBeNull();
    expect(service.cachedCount()).toBe(0);
  });

  it('routes an audio ref to the audio endpoint', async () => {
    await service.resolve(audioRef(CASE_ID));
    expect(urls.audioCalls).toBe(1);
    expect(urls.imageCalls).toBe(0);
  });

  it('does not cache a failed presign', async () => {
    const failing = {
      imageUrl: () => Promise.reject(new Error('boom')),
      audioUrl: () => Promise.reject(new Error('boom')),
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: MediaUrlService, useValue: failing }],
    });
    const isolated = TestBed.inject(SecureMediaService);
    const ref = imageRef(CASE_ID, IMAGE_ID, IMAGE_VARIANT_DERIVATIVE);

    await expect(isolated.resolve(ref)).rejects.toThrow();
    expect(isolated.peek(ref)).toBeNull();
    expect(isolated.cachedCount()).toBe(0);
  });
});
