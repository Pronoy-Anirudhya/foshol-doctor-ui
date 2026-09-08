import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { APP_CONFIG } from '../config/app-config';
import type { SubmitCase$Params } from '../../generated/fn/cases/submit-case';
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
 * **WEB-DATA-020 / WEB-DATA-021** — only typed-in scalars are persisted: `cropId`, `noteBn` and
 * the four field metrics. Image and audio bytes stay in memory and die with the tab. A `Blob`
 * copied into web storage outlives the session and escapes the server-side ownership check that
 * guards case media (`DEVIATIONS.md` D-13 records the widening from two fields to six).
 */
export type SubmitState = 'IDLE' | 'SUBMITTING' | 'FAILED' | 'SUCCEEDED';

export const SUBMIT_IDLE: SubmitState = 'IDLE';
export const SUBMIT_SUBMITTING: SubmitState = 'SUBMITTING';
export const SUBMIT_FAILED: SubmitState = 'FAILED';
export const SUBMIT_SUCCEEDED: SubmitState = 'SUCCEEDED';

/**
 * The unit sets, taken from the generated multipart schema rather than re-typed, so a contract
 * change lands here as a compile error instead of a silently wrong dropdown.
 */
type SubmitBody = SubmitCase$Params['body'];
export type FieldAreaUnit = SubmitBody['fieldAreaUnit'];
export type CropQuantityUnit = NonNullable<SubmitBody['cropQuantityUnit']>;

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

/**
 * The metrics are optional on the way IN because a draft persisted by an earlier build has none.
 * Dropping such a draft on the floor would silently discard the farmer's crop and note over a
 * field they had not been asked for yet, so a legacy entry restores with the metrics defaulted.
 */
interface PersistedDraft {
  readonly cropId: string | null;
  readonly noteBn: string;
  readonly fieldArea?: number | null;
  readonly fieldAreaUnit?: FieldAreaUnit;
  readonly cropQuantity?: number | null;
  readonly cropQuantityUnit?: CropQuantityUnit | null;
}

/** WEB-DATA-004 — the refusal message key when a fourth image is offered. */
export const IMAGE_LIMIT_KEY = 'live.draft.imageLimit';

const DEFAULT_FIELD_AREA_UNIT: FieldAreaUnit = APP_CONFIG.intake.metrics.defaultFieldAreaUnit;
/** The floor an area must clear to count as entered; not a limit, so not an `APP_CONFIG` value. */
const EMPTY = 0;

/** Absent is fine; present-but-not-a-finite-number is not. */
const isOptionalNumber = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  (typeof value === 'number' && Number.isFinite(value));

const isOptionalString = (value: unknown): boolean =>
  value === undefined || value === null || typeof value === 'string';

const isPersistedDraft = (value: unknown): value is PersistedDraft => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const cropOk = v['cropId'] === null || typeof v['cropId'] === 'string';
  return (
    cropOk &&
    typeof v['noteBn'] === 'string' &&
    isOptionalNumber(v['fieldArea']) &&
    isOptionalString(v['fieldAreaUnit']) &&
    isOptionalNumber(v['cropQuantity']) &&
    isOptionalString(v['cropQuantityUnit'])
  );
};

@Injectable({ providedIn: 'root' })
export class CaseDraftStore {
  private readonly storage = inject(LocalStore);

  private readonly _cropId = signal<string | null>(null);
  private readonly _images = signal<readonly DraftImage[]>([]);
  private readonly _audio = signal<DraftAudio | null>(null);
  private readonly _noteBn = signal('');
  /**
   * WEB-FR-126 [DERIVED from the multipart contract] — the field metrics the officer's dose is
   * reckoned from. `fieldArea` is required by the server; the quantity pair is optional. The
   * farmer may also state either in the voice note, and the SERVER decides which source it used
   * (`CaseDetail.metricsSource`) — nothing here forms an opinion about that.
   */
  private readonly _fieldArea = signal<number | null>(null);
  private readonly _fieldAreaUnit = signal<FieldAreaUnit>(DEFAULT_FIELD_AREA_UNIT);
  private readonly _cropQuantity = signal<number | null>(null);
  private readonly _cropQuantityUnit = signal<CropQuantityUnit | null>(null);
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
  readonly fieldArea = this._fieldArea.asReadonly();
  readonly fieldAreaUnit = this._fieldAreaUnit.asReadonly();
  readonly cropQuantity = this._cropQuantity.asReadonly();
  readonly cropQuantityUnit = this._cropQuantityUnit.asReadonly();
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
  /**
   * The server requires `fieldArea` and `fieldAreaUnit` on every submission, so a draft without
   * an area is not submittable — better a disabled button that says why than a guaranteed 400.
   */
  readonly hasFieldArea = computed(() => {
    const area = this._fieldArea();
    return area !== null && area > EMPTY;
  });

  /** WEB-FR-150 — submit is enabled only between min and max images, with a crop chosen. */
  readonly canSubmit = computed(
    () =>
      this._cropId() !== null &&
      this.hasFieldArea() &&
      this._images().length >= APP_CONFIG.intake.minImages &&
      this._images().length <= APP_CONFIG.intake.maxImages &&
      this._submitState() !== SUBMIT_SUBMITTING,
  );
  /** WEB-FR-403 — a failed attempt can be retried, and the retry reuses the same key. */
  readonly canRetry = computed(() => this._submitState() === SUBMIT_FAILED && this.canSubmit());

  constructor() {
    this.#restore();
    effect(() => {
      const fieldArea = this._fieldArea();
      const cropQuantity = this._cropQuantity();
      const cropQuantityUnit = this._cropQuantityUnit();
      const persisted: PersistedDraft = {
        cropId: this._cropId(),
        noteBn: this._noteBn(),
        // Written only once entered, so a draft the farmer has not reached step 4 of round-trips
        // through storage byte-identical to how earlier builds wrote it.
        ...(fieldArea === null
          ? {}
          : { fieldArea, fieldAreaUnit: this._fieldAreaUnit() }),
        ...(cropQuantity === null || cropQuantityUnit === null
          ? {}
          : { cropQuantity, cropQuantityUnit }),
      };
      if (
        persisted.cropId === null &&
        persisted.noteBn.length === 0 &&
        fieldArea === null &&
        cropQuantity === null
      ) {
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

  /**
   * A changed area is a changed body, so like every other content mutator these invalidate the
   * idempotency key: retrying with a new area under the old key is exactly the 409 that
   * `WEB-DATA-005` exists to prevent.
   */
  setFieldArea(fieldArea: number | null): void {
    this._fieldArea.set(fieldArea);
    this.#contentChanged();
  }

  setFieldAreaUnit(unit: FieldAreaUnit): void {
    this._fieldAreaUnit.set(unit);
    this.#contentChanged();
  }

  setCropQuantity(cropQuantity: number | null): void {
    this._cropQuantity.set(cropQuantity);
    this.#contentChanged();
  }

  setCropQuantityUnit(unit: CropQuantityUnit | null): void {
    this._cropQuantityUnit.set(unit);
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
    this._fieldArea.set(null);
    this._fieldAreaUnit.set(DEFAULT_FIELD_AREA_UNIT);
    this._cropQuantity.set(null);
    this._cropQuantityUnit.set(null);
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
    this._fieldArea.set(persisted.fieldArea ?? null);
    this._fieldAreaUnit.set(persisted.fieldAreaUnit ?? DEFAULT_FIELD_AREA_UNIT);
    this._cropQuantity.set(persisted.cropQuantity ?? null);
    this._cropQuantityUnit.set(persisted.cropQuantityUnit ?? null);
  }

  #revoke(previewUrl: string): void {
    try {
      URL.revokeObjectURL(previewUrl);
    } catch {
      /* A non-blob preview (a data: URL in a test) has nothing to revoke. */
    }
  }
}
