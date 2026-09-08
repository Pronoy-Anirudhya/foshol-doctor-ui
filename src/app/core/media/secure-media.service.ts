import { computed, inject, Injectable, signal } from '@angular/core';
import { APP_CONFIG } from '../config/app-config';
import {
  IMAGE_VARIANT_DERIVATIVE,
  MediaUrlService,
  type ImageVariant,
  type PresignedUrlView,
} from './out-of-contract/media-url.service';

/**
 * WEB-FR-154 — every stored image and audio object is loaded through the presigned URL the API
 * returned. Nothing here builds an object-store URL; it only caches the one the server minted.
 *
 * WEB-DATA-021 — a presigned URL is NEVER persisted. Not to localStorage, not to
 * sessionStorage, not to IndexedDB, not to the Cache API, not to a cookie. The whole point of a
 * presigned URL is that it expires (COMMON-SEC-016); writing one to disk defeats the limit and
 * leaves a working link to farmer media on a shared demo laptop tomorrow. The cache below is a
 * signal in memory and dies with the tab.
 *
 * WEB-SEC-003 — the bearer reaches the API origin only. The presigned URL is handed to the
 * browser as a plain `<img src>` subresource, so no header of ours travels with it.
 */

/** A presigned URL together with the moment it stops working, as epoch milliseconds. */
interface CachedUrl {
  readonly url: string;
  readonly expiresAtMs: number;
}

export interface ImageRef {
  readonly kind: 'image';
  readonly caseId: string;
  readonly imageId: string;
  readonly variant: ImageVariant;
}

export interface AudioRef {
  readonly kind: 'audio';
  readonly caseId: string;
}

export type MediaRef = ImageRef | AudioRef;

/** `image:{caseId}:{imageId}:{variant}` and `audio:{caseId}`, so the two can never collide. */
export function mediaKey(ref: MediaRef): string {
  return ref.kind === 'image'
    ? `image:${ref.caseId}:${ref.imageId}:${ref.variant}`
    : `audio:${ref.caseId}`;
}

/** Convenience for the common case, so callers do not have to spell out the discriminant. */
export function imageRef(
  caseId: string,
  imageId: string,
  variant: ImageVariant = IMAGE_VARIANT_DERIVATIVE,
): ImageRef {
  return { kind: 'image', caseId, imageId, variant };
}

export function audioRef(caseId: string): AudioRef {
  return { kind: 'audio', caseId };
}

@Injectable({ providedIn: 'root' })
export class SecureMediaService {
  private readonly urls = inject(MediaUrlService);

  /**
   * Signal-backed so a template can read a resolved URL synchronously after the first await,
   * and so `clear()` on logout (WEB-SEC-004) invalidates every bound image at once.
   */
  private readonly _entries = signal<ReadonlyMap<string, CachedUrl>>(new Map());

  /** Exposed for tests and for a debug surface; nothing in the UI renders it. */
  readonly cachedCount = computed(() => this._entries().size);

  /**
   * In-flight promises are held OUTSIDE the signal graph on purpose. They are not state a view
   * ever renders, and putting a pending promise in a signal would make every concurrent caller
   * a change-detection dependency of a value none of them display.
   */
  private readonly inflight = new Map<string, Promise<string>>();

  /**
   * The presigned URL for `ref`, minting a new one when the cached one is inside the refresh
   * margin. Concurrent callers for the same key share one request — a queue of twenty rows all
   * mounting at once must not fire twenty presign calls for the same thumbnail.
   */
  resolve(ref: MediaRef): Promise<string> {
    const key = mediaKey(ref);

    const fresh = this.fresh(key);
    if (fresh !== null) return Promise.resolve(fresh);

    const pending = this.inflight.get(key);
    if (pending !== undefined) return pending;

    return this.start(key, ref);
  }

  /**
   * Discard whatever is cached for `ref` and presign again.
   *
   * This is the one recovery path an `<img>` has: the element reports `error` without a status,
   * so an expired signature, a clock skew and a transient network blip are indistinguishable
   * from inside the component. Re-presigning covers the first two and costs one request.
   */
  refresh(ref: MediaRef): Promise<string> {
    const key = mediaKey(ref);
    this.evict(key);
    this.inflight.delete(key);
    return this.start(key, ref);
  }

  /** The last resolved URL for `ref`, or `null` when nothing usable is cached. */
  peek(ref: MediaRef): string | null {
    return this.fresh(mediaKey(ref));
  }

  /**
   * WEB-SEC-004 — logout clears every store holding case media state. A presigned URL still
   * works after the session ends until it expires, so dropping them is not housekeeping.
   *
   * Named `clearSession()` to match the structural contract `StoreTeardown` collects, so this
   * service can be added to that list with no adapter. AMENDMENT REQUEST (owner: agent owning
   * `core/stores/store-teardown.ts`): add `inject(SecureMediaService)` to `sessionScoped`.
   */
  clearSession(): void {
    this._entries.set(new Map());
    this.inflight.clear();
  }

  private start(key: string, ref: MediaRef): Promise<string> {
    const request = this.presign(ref)
      .then((view) => {
        this.store(key, view);
        return view.url;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, request);
    return request;
  }

  private presign(ref: MediaRef): Promise<PresignedUrlView> {
    return ref.kind === 'image'
      ? this.urls.imageUrl(ref.caseId, ref.imageId, ref.variant)
      : this.urls.audioUrl(ref.caseId);
  }

  /**
   * A cached URL counts as usable only while it has more than `presignRefreshMarginMs` of life
   * left, so an `<img>` is never handed a URL that expires between the binding and the request
   * reaching MinIO. `presignTtlMs` mirrors `foshol.storage.presign-ttl`, but the server's own
   * `expiresAt` is what is actually used here (WEB-NFR-010) — the constant is only the fallback
   * for a response with an unparseable timestamp.
   */
  private fresh(key: string): string | null {
    const entry = this._entries().get(key);
    if (entry === undefined) return null;
    if (entry.expiresAtMs - Date.now() < APP_CONFIG.storage.presignRefreshMarginMs) {
      this.evict(key);
      return null;
    }
    return entry.url;
  }

  private store(key: string, view: PresignedUrlView): void {
    const parsed = Date.parse(view.expiresAt);
    const expiresAtMs = Number.isNaN(parsed) ? Date.now() + APP_CONFIG.storage.presignTtlMs : parsed;

    const next = new Map(this._entries());
    next.set(key, { url: view.url, expiresAtMs });
    this._entries.set(next);
  }

  private evict(key: string): void {
    const current = this._entries();
    if (!current.has(key)) return;
    const next = new Map(current);
    next.delete(key);
    this._entries.set(next);
  }
}
