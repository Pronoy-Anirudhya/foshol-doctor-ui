import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  resource,
  signal,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { APP_CONFIG } from '../../../core/config/app-config';
import { toProblemView, type ProblemView } from '../../../core/errors/problem';
import { CaseDraftStore, IMAGE_LIMIT_KEY } from '../../../core/stores/case-draft-store';
import { newUuid } from '../../../core/util/uuid';
import { CasesService } from '../../../generated/services/cases.service';
import { KnowledgeService } from '../../../generated/services/knowledge.service';
import { ErrorPanel } from '../../../shared/ui/error-panel/error-panel';
import { PageHeading } from '../../../shared/ui/page-heading/page-heading';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { Spinner } from '../../../shared/ui/spinner/spinner';
import { CropGrid } from '../crop-picker/crop-grid';
import { FARMER_PATHS } from './farmer-paths';
import { ImagePipeline } from './image-pipeline';
import {
  ImageStrip,
  tilesOf,
  type ServerImageRejection,
  type StripTile,
} from './image-strip';
import { NoteBox } from './note-box';
import { QualityReject } from './quality-reject';
import { QUALITY_ACCEPTED, unreadableVerdict, type QualityVerdict } from './quality-gate';
import { CameraPanel } from './camera-panel';
import { VoicePanel } from './voice-panel';
import { VoiceRecorder } from './voice-recorder';

/**
 * The farmer's evidence-capture screen — demo beats 2 and 3.
 *
 * One screen, three steps, no wizard: crop, photographs, description. A wizard would put the
 * always-available text box (`WEB-FR-140`/`141`) behind a "next", and a degraded path that must
 * be found is not a degraded path.
 *
 * The order of everything on this page is the order of the requirements: preview first
 * (`WEB-FR-111`), local verdict second (`WEB-FR-120`–`124`), re-encode third (`WEB-FR-112`),
 * network last (`WEB-FR-150`). `WEB-TEST-002` asserts the third and fourth never happen for a
 * rejected image.
 */
interface PendingPick {
  readonly id: string;
  readonly previewUrl: string;
}

interface RejectedPick {
  readonly id: string;
  readonly previewUrl: string;
  readonly source: Blob;
  readonly verdict: QualityVerdict;
}

const SERVER_REASON_PREFIX = 'farmer.capture.serverReason.';
const NO_SLOTS = 0;
const SINGLE = 1;
const SKELETON_TILES = 3;

@Component({
  selector: 'foshol-capture-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // WEB-FR-145 — the recorder is scoped to this page, so leaving it stops every track.
  providers: [VoiceRecorder],
  host: { class: 'block' },
  imports: [
    CameraPanel,
    CropGrid,
    ErrorPanel,
    ImageStrip,
    NoteBox,
    PageHeading,
    QualityReject,
    Skeleton,
    Spinner,
    TranslatePipe,
    VoicePanel,
  ],
  template: `
    <div class="mx-auto w-full max-w-2xl px-4 pt-6 pb-28 sm:px-6 md:pt-10">
      <foshol-page-heading
        eyebrowKey="farmer.capture.eyebrow"
        titleKey="farmer.capture.title"
        subtitleKey="farmer.capture.subtitle"
      />

      <!-- Step 1 — crop. WEB-FR-100: icon tiles, and AC-02 checks this screen for a <select>. -->
      <section class="step" aria-labelledby="step-crop">
        <h2 class="step-title" id="step-crop">
          <span class="step-number" aria-hidden="true">১</span>
          {{ 'farmer.capture.crop.stepTitle' | translate }}
        </h2>
        @if (crops.isLoading()) {
          <foshol-skeleton variant="media" [count]="skeletonTiles" />
        } @else if (cropProblem(); as failure) {
          <foshol-error-panel [problem]="failure" (retry)="crops.reload()" />
        } @else {
          <foshol-crop-grid
            [crops]="availableCrops()"
            [selectedId]="draft.cropId()"
            (cropChosen)="draft.chooseCrop($event)"
          />
        }
      </section>

      <!-- Step 2 — photographs. -->
      <section class="step" aria-labelledby="step-images">
        <h2 class="step-title" id="step-images">
          <span class="step-number" aria-hidden="true">২</span>
          {{ 'farmer.capture.images.stepTitle' | translate }}
        </h2>
        <p class="step-help">{{ 'farmer.capture.images.help' | translate }}</p>

        @if (tiles().length > 0) {
          <div class="mt-3">
            <foshol-image-strip
              [tiles]="tiles()"
              (removed)="removeImage($event)"
              (moved)="moveImage($event)"
            />
          </div>
        }

        <div class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <!-- WEB-FR-110 — a live camera where the browser can open one (camera-panel.ts
               requests getUserMedia directly, since a laptop browser never honours the
               capture attribute below and would otherwise just show a file browser), the
               mobile capture hint as its own fallback where it cannot. -->
          <foshol-camera-panel [disabled]="!canAddMore()" (captured)="onLivePhoto($event)" />

          <label class="pick touch-target">
            <input
              class="sr-only"
              type="file"
              data-testid="capture-file-input"
              [attr.accept]="acceptTypes"
              [attr.multiple]="canPickMany() ? true : null"
              [disabled]="!canAddMore()"
              (change)="onFilesChosen($event)"
            />
            <span aria-hidden="true">🖼️</span>
            {{ 'farmer.capture.images.chooseFile' | translate }}
          </label>
        </div>

        @if (analysing()) {
          <p class="mt-2">
            <foshol-spinner
              size="sm"
              [showLabel]="true"
              labelKey="farmer.capture.images.checking"
            />
          </p>
        }

        @if (refusalKey(); as key) {
          <p class="refusal" role="status" data-testid="capture-refusal">
            {{ key | translate: { max: maxImages } }}
          </p>
        }

        <!-- Demo beat 3. WEB-FR-123 — rendered from a local verdict; no request was made. -->
        @for (rejection of rejections(); track rejection.id) {
          <div class="mt-4">
            <foshol-quality-reject
              [previewUrl]="rejection.previewUrl"
              [verdict]="rejection.verdict"
              (dismissed)="dismissRejection(rejection.id)"
              (overridden)="overrideRejection(rejection.id)"
            />
          </div>
        }
      </section>

      <!-- Step 3 — describe it. The text box is unconditional (WEB-FR-140/141). -->
      <section class="step" aria-labelledby="step-describe">
        <h2 class="step-title" id="step-describe">
          <span class="step-number" aria-hidden="true">৩</span>
          {{ 'farmer.capture.describe.stepTitle' | translate }}
        </h2>
        <p class="step-help">{{ 'farmer.capture.describe.help' | translate }}</p>

        <div class="mt-3">
          <foshol-voice-panel />
        </div>

        <div class="mt-5">
          <foshol-note-box [value]="draft.noteBn()" (changed)="draft.setNote($event)" />
        </div>
      </section>

      @if (problem(); as failure) {
        <div class="mt-6">
          <!-- WEB-FR-403 / AC-28 — the retry reuses the SAME Idempotency-Key. -->
          <foshol-error-panel [problem]="failure" [retryable]="true" (retry)="submit()" />
        </div>
      }
    </div>

    <!-- Within thumb reach at 360 px, and out of the way of the note box's own keyboard. -->
    <div class="submit-bar">
      <div class="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 sm:px-6">
        <p class="min-w-0 flex-1 text-sm text-ink-muted">
          {{ 'farmer.capture.submit.hint' | translate: { min: minImages } }}
        </p>
        <button
          type="button"
          class="submit touch-target"
          data-testid="capture-submit"
          [disabled]="!canSubmit()"
          (click)="submit()"
        >
          @if (draft.isSubmitting()) {
            {{ 'farmer.capture.submit.sending' | translate }}
          } @else if (draft.canRetry()) {
            {{ 'farmer.capture.submit.retry' | translate }}
          } @else {
            {{ 'farmer.capture.submit.send' | translate }}
          }
        </button>
      </div>
    </div>
  `,
  styles: `
    .step {
      margin-block-start: 1.75rem;
      padding: 1.1rem;
      border: 1px solid var(--color-surface-3);
      border-radius: 1.25rem;
      background: var(--color-surface-0);
      box-shadow: var(--shadow-card);
    }

    .step-title {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      margin-block-end: 0.5rem;
      font-size: 1.125rem;
    }

    .step-number {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      inline-size: 1.9rem;
      block-size: 1.9rem;
      flex: none;
      border-radius: 999px;
      background: var(--color-paddy-100);
      color: var(--color-paddy-700);
      font-size: 0.9375rem;
      font-weight: 700;
    }

    .step-help {
      font-size: 0.9375rem;
      color: var(--color-ink-muted);
    }

    .pick {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 0.85rem 1.1rem;
      border: 1px solid var(--color-surface-3);
      border-radius: 1rem;
      background: var(--color-surface-0);
      color: var(--color-ink);
      font-weight: 700;
      cursor: pointer;
      transition:
        border-color var(--duration-1) var(--ease-settle),
        box-shadow var(--duration-2) var(--ease-settle);
    }

    .pick:hover {
      border-color: var(--color-paddy-600);
      box-shadow: var(--shadow-card);
    }

    .pick-primary {
      background: var(--color-paddy-600);
      border-color: var(--color-paddy-600);
      color: var(--color-ink-invert);
    }

    .pick-primary:hover {
      background: var(--color-paddy-700);
    }

    /* WEB-UX-041 — the visible input is hidden, so the label must show the focus ring. */
    .pick:has(input:focus-visible) {
      outline: 3px solid var(--color-focus);
      outline-offset: 2px;
    }

    .pick:has(input:disabled) {
      opacity: 0.55;
      cursor: not-allowed;
    }

    .refusal {
      margin-block-start: 0.6rem;
      padding: 0.6rem 0.85rem;
      border: 1px solid var(--color-dawn-300);
      border-radius: 0.85rem;
      background: var(--color-dawn-100);
      color: var(--color-dawn-700);
      font-size: 0.875rem;
      font-weight: 600;
    }

    .submit-bar {
      position: sticky;
      inset-block-end: 0;
      padding-block: 0.75rem;
      border-block-start: 1px solid var(--color-surface-3);
      background: color-mix(in srgb, var(--color-surface-1) 92%, transparent);
      backdrop-filter: blur(8px);
    }

    .submit {
      flex: none;
      padding: 0.8rem 1.6rem;
      border-radius: 1rem;
      background: var(--color-paddy-600);
      color: var(--color-ink-invert);
      font-size: 1.0625rem;
      font-weight: 700;
      box-shadow: var(--shadow-card);
      transition:
        background-color var(--duration-1) var(--ease-settle),
        box-shadow var(--duration-2) var(--ease-settle);
    }

    .submit:hover:not(:disabled) {
      background: var(--color-paddy-700);
      box-shadow: var(--shadow-lift);
    }

    .submit:disabled {
      background: var(--color-surface-3);
      color: var(--color-ink-muted);
      box-shadow: none;
      cursor: not-allowed;
    }
  `,
})
export class CapturePage {
  private readonly knowledge = inject(KnowledgeService);
  private readonly cases = inject(CasesService);
  private readonly pipeline = inject(ImagePipeline);
  private readonly recorder = inject(VoiceRecorder);
  private readonly router = inject(Router);

  protected readonly draft = inject(CaseDraftStore);

  protected readonly acceptTypes = APP_CONFIG.intake.allowedImageTypes.join(',');
  protected readonly maxImages = APP_CONFIG.intake.maxImages;
  protected readonly minImages = APP_CONFIG.intake.minImages;
  protected readonly skeletonTiles = SKELETON_TILES;

  protected readonly crops = resource({ loader: () => this.knowledge.listCrops() });
  protected readonly availableCrops = computed(() => this.crops.value() ?? []);
  protected readonly cropProblem = computed(() => {
    const failure = this.crops.error();
    return failure ? toProblemView(failure) : null;
  });

  constructor() {
    /**
     * WEB-DATA-005 — the clip belongs to the draft, not to the recorder, because a NEW
     * recording is a content change and must invalidate the idempotency key. Leaving it in
     * the recorder and reading it at submit time would let a retry after a re-record send a
     * different body under the same key, which the server answers with `409`.
     *
     * `untracked` is load-bearing, not decoration: `setAudio` reaches the store's own
     * content-changed path, which READS `submitState`. Tracked, this effect would take a
     * dependency on it, re-run the moment `beginSubmit()` fired, and mint a fresh idempotency
     * key mid-attempt — silently breaking the retry guarantee of `WEB-FR-403`.
     */
    effect(() => {
      const clip = this.recorder.clip();
      untracked(() => this.draft.setAudio(clip));
    });
  }

  private readonly pending = signal<readonly PendingPick[]>([]);
  private readonly _rejections = signal<readonly RejectedPick[]>([]);
  private readonly _problem = signal<ProblemView | null>(null);
  private readonly overflow = signal<string | null>(null);

  protected readonly rejections = this._rejections.asReadonly();
  protected readonly problem = this._problem.asReadonly();
  protected readonly analysing = computed(() => this.pending().length > NO_SLOTS);

  /** WEB-DATA-004 — the store's own refusal wins; the pre-check only covers a multi-select. */
  protected readonly refusalKey = computed(() => this.draft.refusalKey() ?? this.overflow());

  /**
   * WEB-FR-150 / LIVE-API-NOTES §4 — `rejectedImages[].position` is **0-based** on the wire
   * while `CaseImage.position` is 1-based, so it indexes the draft's images directly and must
   * not be offset. The prose field is `messageBn` on both the contract and the live server;
   * `ProblemView` exposes only the latter, so the reason code carries the fallback.
   */
  private readonly serverRejections = computed<ReadonlyMap<number, ServerImageRejection>>(() => {
    const map = new Map<number, ServerImageRejection>();
    for (const rejected of this._problem()?.rejectedImages ?? []) {
      if (rejected.position === null) continue;
      map.set(rejected.position, {
        message: rejected.messageBn,
        reasonKey: rejected.reason === null ? null : `${SERVER_REASON_PREFIX}${rejected.reason}`,
      });
    }
    return map;
  });

  protected readonly tiles = computed<readonly StripTile[]>(() => [
    ...tilesOf(this.draft.images(), this.serverRejections()),
    ...this.pending().map((pick) => ({
      id: pick.id,
      previewUrl: pick.previewUrl,
      ready: false,
      serverMessage: null,
      serverReasonKey: null,
    })),
  ]);

  private readonly slotsFree = computed(
    () => APP_CONFIG.intake.maxImages - this.draft.imageCount() - this.pending().length,
  );
  protected readonly canAddMore = computed(() => this.slotsFree() > NO_SLOTS);
  protected readonly canPickMany = computed(() => APP_CONFIG.intake.maxImages > SINGLE);

  /** WEB-FR-101 — no crop, no submission; and nothing goes out while a pick is being judged. */
  protected readonly canSubmit = computed(() => this.draft.canSubmit() && !this.analysing());

  protected onFilesChosen(event: Event): void {
    const input = event.target as HTMLInputElement;
    const chosen = Array.from(input.files ?? []);
    // The same file chosen twice in a row fires no `change` unless the input is cleared.
    input.value = '';
    if (chosen.length === NO_SLOTS) return;

    this.overflow.set(null);
    this.draft.dismissRefusal();

    for (const file of chosen) {
      if (this.slotsFree() <= NO_SLOTS) {
        // WEB-DATA-004 — refused in place, never by silently dropping an existing photograph.
        this.overflow.set(IMAGE_LIMIT_KEY);
        return;
      }
      void this.ingest(file);
    }
  }

  /** A frame from the live camera, or the fallback file input — either way, one photo. */
  protected onLivePhoto(source: Blob): void {
    if (this.slotsFree() <= NO_SLOTS) {
      // WEB-DATA-004 — refused in place, never by silently dropping an existing photograph.
      this.overflow.set(IMAGE_LIMIT_KEY);
      return;
    }
    this.overflow.set(null);
    this.draft.dismissRefusal();
    void this.ingest(source);
  }

  protected removeImage(id: string): void {
    this.draft.removeImage(id);
    this.overflow.set(null);
  }

  /**
   * WEB-FR-115 — reordering. `CaseDraftStore` exposes append and remove but no move, so the
   * target order is realised by removing and re-appending each image in turn: after every id
   * has been re-appended in the desired sequence the array *is* that sequence. The preview URL
   * is recreated from the retained blob because `removeImage` revokes the old one.
   */
  protected moveImage(move: { id: string; delta: number }): void {
    const order = this.draft.images().map((image) => image.id);
    const from = order.indexOf(move.id);
    const to = from + move.delta;
    if (from < NO_SLOTS || to < NO_SLOTS || to >= order.length) return;

    const reordered = [...order];
    reordered[from] = order[to];
    reordered[to] = order[from];

    const byId = new Map(this.draft.images().map((image) => [image.id, image]));
    for (const id of reordered) {
      const image = byId.get(id);
      if (image === undefined) continue;
      this.draft.removeImage(id);
      this.draft.addImage({ ...image, previewUrl: URL.createObjectURL(image.blob) });
    }
  }

  protected dismissRejection(id: string): void {
    this.dropRejection(id);
  }

  /** WEB-FR-124 — "send anyway", for the vegetation heuristic and nothing else. */
  protected overrideRejection(id: string): void {
    const rejection = this._rejections().find((entry) => entry.id === id);
    if (rejection === undefined || !rejection.verdict.overridable) return;
    const source = rejection.source;
    this.dropRejection(id);
    void this.ingest(source, true);
  }

  protected async submit(): Promise<void> {
    if (!this.canSubmit()) return;

    const cropId = this.draft.cropId();
    if (cropId === null) return;

    this._problem.set(null);
    this.draft.beginSubmit();

    const audio = this.draft.audio();
    const note = this.draft.noteBn().trim();
    const parentCaseId = this.draft.parentCaseId();

    try {
      const accepted = await this.cases.submitCase({
        // WEB-DATA-005 — the same key for every retry of this attempt (`WEB-FR-403`).
        'Idempotency-Key': this.draft.keyForAttempt(),
        body: {
          cropId,
          images: this.draft.images().map((image) => image.blob),
          ...(audio === null ? {} : { audio: audio.blob }),
          ...(note.length === NO_SLOTS ? {} : { noteBn: note }),
          ...(parentCaseId === null ? {} : { parentCaseId }),
        },
      });

      // WEB-FR-145 — the microphone goes back on submission, not only on navigation.
      this.recorder.releaseMicrophone();
      this.draft.completeSubmit();
      // WEB-FR-151 — a 202 lands on the case status view for the returned id.
      await this.router.navigateByUrl(FARMER_PATHS.caseStatus(accepted.caseId));
    } catch (caught: unknown) {
      this.draft.failSubmit();
      this._problem.set(toProblemView(caught));
    }
  }

  /**
   * WEB-FR-111 — the object URL is created SYNCHRONOUSLY here, so the thumbnail is on screen
   * on the same frame the file was chosen, long before the decode this method then awaits.
   */
  private async ingest(source: Blob, overrideVegetation = false): Promise<void> {
    const id = newUuid();
    const previewUrl = URL.createObjectURL(source);
    this.pending.update((current) => [...current, { id, previewUrl }]);

    try {
      const prepared = await this.pipeline.prepare(source, overrideVegetation);

      if (prepared.blob === null) {
        this._rejections.update((current) => [
          ...current,
          { id, previewUrl, source, verdict: prepared.verdict },
        ]);
        return;
      }

      const added = this.draft.addImage({
        id,
        blob: prepared.blob,
        previewUrl,
        width: prepared.width,
        height: prepared.height,
        // The store keeps these opaque; they are what the local gate measured (WEB-FR-125).
        metrics: {
          outcome: prepared.verdict.outcome,
          overridden: prepared.verdict.outcome !== QUALITY_ACCEPTED,
          ...prepared.verdict.measurements,
        },
      });
      if (!added) URL.revokeObjectURL(previewUrl);
    } catch {
      // A file the browser will not decode is a rejection, not a crash.
      this._rejections.update((current) => [
        ...current,
        { id, previewUrl, source, verdict: unreadableVerdict() },
      ]);
    } finally {
      this.pending.update((current) => current.filter((pick) => pick.id !== id));
    }
  }

  private dropRejection(id: string): void {
    const rejection = this._rejections().find((entry) => entry.id === id);
    if (rejection !== undefined) URL.revokeObjectURL(rejection.previewUrl);
    this._rejections.update((current) => current.filter((entry) => entry.id !== id));
  }
}
