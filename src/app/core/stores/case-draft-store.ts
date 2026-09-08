import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { APP_CONFIG } from '../config/app-config';
import { LocalStore } from '../storage/local-store';
import { newUuid } from '../util/uuid';

/**
 * The farmer's in-flight submission.
 *
 * Two rules shape this store more than anything else:
 *
 * **WEB-DATA-005 / WEB-FR-403** — one `Idempotency-Key` per *attempt*, reused for every retry
 * of that attempt, regenerated only when the content changes. So the key is derived lazily and
 * invalidated by every content mutator; a retry never passes through a mutator, and therefore
 * never gets a new key. A new key with the same body is a duplicate case; the same key with a
 * different body is a `409`. Both are avoided by making the key a function of content changes
 * rather than of clicks.
 *
 * **WEB-DATA-020 / WEB-DATA-021** — only `cropId` and `noteBn` are persisted. Image and audio
 * bytes stay in memory and die with the tab. A `Blob` copied into web storage outlives the
 * session and escapes the server-side ownership check that guards case media.
 */
export type SubmitState = 'IDLE' | 'SUBMITTING' | 'FAILED' | 'SUCCEEDED';

export const SUBMIT_IDLE: SubmitState = 'IDLE';
export const SUBMIT_SUBMITTING: SubmitState = 'SUBMITTING';
export const SUBMIT_FAILED: SubmitState = 'FAILED';
export const SUBMIT_SUCCEEDED: SubmitState = 'SUCCEEDED';

/**
 * `metrics` is deliberately opaque: the capture agent owns the quality-pre-filter numbers and
 * this store must not acquire an opinion about them (WEB-FR-122…124 live over there).
 */
export interface DraftImage {
  readonly id: string;
  readonly blob: Blob;
  readonly previewUrl: string;
  readonly width: number;
  readonly height: number;
  readonly metrics: Readonly<Record<string, unknown>>;
}

export interface DraftAudio {
  readonly blob: Blob;
  readonly durationMs: number;
  readonly mimeType: string;
}

interface PersistedDraft {
  readonly cropId: string | null;
  readonly noteBn: string;
}

/** WEB-DATA-004 — the refusal message key when a fourth image is offered. */
export const IMAGE_LIMIT_KEY = 'live.draft.imageLimit';

const isPersistedDraft = (value: unknown): value is PersistedDraft => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const cropOk = v['cropId'] === null || typeof v['cropId'] === 'string';
  return cropOk && typeof v['noteBn'] === 'string';
};

@Injectable({ providedIn: 'root' })
export class CaseDraftStore {
  private readonly storage = inject(LocalStore);

  private readonly _cropId = signal<string | null>(null);
  private readonly _images = signal<readonly DraftImage[]>([]);
  private readonly _audio = signal<DraftAudio | null>(null);
  private readonly _noteBn = signal('');
  private readonly _parentCaseId = signal<string | null>(null);
  private readonly _idempotencyKey = signal<string | null>(null);
  private readonly _submitState = signal<SubmitState>(SUBMIT_IDLE);
  /**
   * WEB-DATA-004 — an extra image is refused with an in-place message. It is NOT accepted and
   * it does NOT evict an existing one: silently dropping the farmer's third photograph to make
   * room for a fourth is the failure this requirement exists to forbid.
   */
  private readonly _refusalKey = signal<string | null>(null);

  readonly cropId = this._cropId.asReadonly();
  readonly images = this._images.asReadonly();
  readonly audio = this._audio.asReadonly();
  readonly noteBn = this._noteBn.asReadonly();
  readonly parentCaseId = this._parentCaseId.asReadonly();
  readonly idempotencyKey = this._idempotencyKey.asReadonly();
  readonly submitState = this._submitState.asReadonly();
  readonly refusalKey = this._refusalKey.asReadonly();

  readonly imageCount = computed(() => this._images().length);
  readonly isFull = computed(() => this._images().length >= APP_CONFIG.intake.maxImages);
  readonly isSubmitting = computed(() => this._submitState() === SUBMIT_SUBMITTING);
  readonly hasContent = computed(
    () => this._images().length > 0 || this._audio() !== null || this._noteBn().length > 0,
  );
  /** WEB-FR-150 — submit is enabled only between min and max images, with a crop chosen. */
  readonly canSubmit = computed(
    () =>
      this._cropId() !== null &&
      this._images().length >= APP_CONFIG.intake.minImages &&
      this._images().length <= APP_CONFIG.intake.maxImages &&
      this._submitState() !== SUBMIT_SUBMITTING,
  );
  /** WEB-FR-403 — a failed attempt can be retried, and the retry reuses the same key. */
  readonly canRetry = computed(() => this._submitState() === SUBMIT_FAILED && this.canSubmit());

  constructor() {
    this.#restore();
    effect(() => {
      const persisted: PersistedDraft = { cropId: this._cropId(), noteBn: this._noteBn() };
      if (persisted.cropId === null && persisted.noteBn.length === 0) {
        this.storage.remove(APP_CONFIG.storageKeys.draft);
        return;
      }
      this.storage.writeJson(APP_CONFIG.storageKeys.draft, persisted);
    });
  }

  // ---- content mutators. Each one invalidates the idempotency key (WEB-DATA-005). ----

  chooseCrop(cropId: string | null): void {
    this._cropId.set(cropId);
    this.#contentChanged();
  }

  /** Returns `false` when the image was refused, so the caller can surface `refusalKey()`. */
  addImage(image: DraftImage): boolean {
    if (this._images().length >= APP_CONFIG.intake.maxImages) {
      this._refusalKey.set(IMAGE_LIMIT_KEY);
      return false;
    }
    this._refusalKey.set(null);
    this._images.update((current) => [...current, image]);
    this.#contentChanged();
    return true;
  }

  removeImage(id: string): void {
    const target = this._images().find((image) => image.id === id);
    if (target === undefined) return;
    this.#revoke(target.previewUrl);
    this._images.update((current) => current.filter((image) => image.id !== id));
    this._refusalKey.set(null);
    this.#contentChanged();
  }

  setAudio(audio: DraftAudio | null): void {
    this._audio.set(audio);
    this.#contentChanged();
  }

  setNote(noteBn: string): void {
    this._noteBn.set(noteBn.slice(0, APP_CONFIG.intake.noteMaxLength));
    this.#contentChanged();
  }

  /** WEB-FR-160 — a resubmission after a rejection carries the rejected case's id. */
  setParentCase(parentCaseId: string | null): void {
    this._parentCaseId.set(parentCaseId);
    this.#contentChanged();
  }

  dismissRefusal(): void {
    this._refusalKey.set(null);
  }

  // ---- submission lifecycle ----

  /**
   * WEB-DATA-005 — the key for THIS attempt. Called once per request, including retries: it
   * returns the same value until a content mutator invalidates it.
   */
  keyForAttempt(): string {
    const existing = this._idempotencyKey();
    if (existing !== null) return existing;
    const fresh = newUuid();
    this._idempotencyKey.set(fresh);
    return fresh;
  }

  beginSubmit(): void {
    this._submitState.set(SUBMIT_SUBMITTING);
  }

  failSubmit(): void {
    this._submitState.set(SUBMIT_FAILED);
  }

  /**
   * WEB-DATA-022 — on success the persisted draft is cleared and every preview object URL is
   * revoked. An unrevoked blob URL keeps the whole image alive for the life of the document,
   * which on a phone is how a capture flow becomes an out-of-memory tab.
   */
  completeSubmit(): void {
    this._submitState.set(SUBMIT_SUCCEEDED);
    this.#discard();
  }

  /** The farmer abandoned the draft. Same cleanup, different terminal state. */
  discard(): void {
    this._submitState.set(SUBMIT_IDLE);
    this.#discard();
  }

  /** WEB-SEC-004 / WEB-DATA-023 — sign-out drops the media and the persisted draft alike. */
  clearSession(): void {
    this.discard();
  }

  #discard(): void {
    for (const image of this._images()) this.#revoke(image.previewUrl);
    this._images.set([]);
    this._audio.set(null);
    this._cropId.set(null);
    this._noteBn.set('');
    this._parentCaseId.set(null);
    this._idempotencyKey.set(null);
    this._refusalKey.set(null);
    this.storage.remove(APP_CONFIG.storageKeys.draft);
  }

  #contentChanged(): void {
    // WEB-DATA-005 — content changed, so the next attempt is a NEW attempt and needs a new key.
    this._idempotencyKey.set(null);

    // `untracked` is load-bearing, not defensive. Reading a signal inside a mutator makes every
    // caller's `effect` depend on it: an effect that calls any of these mutators would re-run
    // the moment `beginSubmit()` flips the state, land back here, and mint a FRESH
    // Idempotency-Key in the middle of the attempt it was already making. The retry would then
    // carry a different key and the server would treat it as a new case — breaking WEB-FR-403
    // and AC-28 invisibly, only under a race, and only in the one place it must not.
    untracked(() => {
      if (this._submitState() !== SUBMIT_SUBMITTING) this._submitState.set(SUBMIT_IDLE);
    });
  }

  #restore(): void {
    const persisted = this.storage.readJson(APP_CONFIG.storageKeys.draft, isPersistedDraft);
    if (persisted === null) return;
    this._cropId.set(persisted.cropId);
    this._noteBn.set(persisted.noteBn.slice(0, APP_CONFIG.intake.noteMaxLength));
  }

  #revoke(previewUrl: string): void {
    try {
      URL.revokeObjectURL(previewUrl);
    } catch {
      /* A non-blob preview (a data: URL in a test) has nothing to revoke. */
    }
  }
}
