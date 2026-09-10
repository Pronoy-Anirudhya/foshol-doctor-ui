import { ChangeDetectionStrategy, Component, computed, inject, resource, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { APP_CONFIG } from '../../../core/config/app-config';
import { toProblemView, type ProblemView } from '../../../core/errors/problem';
import { LanguageStore } from '../../../core/i18n/language-store';
import type { DraftAudio } from '../../../core/stores/case-draft-store';
import type { Crop } from '../../../generated/models/crop';
import type { Disease } from '../../../generated/models/disease';
import { KnowledgeService } from '../../../generated/services/knowledge.service';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { ErrorPanel } from '../../../shared/ui/error-panel/error-panel';
import { Percent1Pipe } from '../../../shared/pipes/percent1.pipe';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { CropGrid } from '../crop-picker/crop-grid';
import { VoiceRecorder } from '../capture/voice-recorder';
import { FaqCandidateList } from './faq-candidate-list';
import { FaqDiseaseSearch } from './faq-disease-search';
import { FaqRecorderPanel } from './faq-recorder-panel';
import { FaqRemedyList } from './faq-remedy-list';
import { FAQ_PATHS } from './faq-paths';
import { FaqStore, type FaqSelection } from './faq-store';

/**
 * প্রশ্নোত্তর — the farmer asks a question out loud and reads the registered answer.
 *
 * This is a **catalogue lookup, not a field diagnosis**, and the whole screen is built to keep
 * that distinction visible. ADR-0003 puts every real diagnosis through
 * `POST /cases` → officer → advisory; nothing on this page submits a case, and the disclaimer
 * saying so is persistent rather than a dismissible toast. What a farmer reads here are rows
 * they could already reach by tapping through a disease list — the microphone is a faster way
 * to the same public catalogue, not a second opinion.
 *
 * The flow is the industry-standard voice pattern, and each arrow is deliberate:
 *
 *   pick a crop → hold and speak → **hear back what we understood** → confirm one disease →
 *   read its remedies
 *
 * The confirmation step is the safety step. `FaqStore` never fetches remedy text until the
 * farmer taps a candidate, so a mishearing costs a wasted tap rather than putting a chemical
 * dosage in front of someone who asked about something else.
 *
 * Every failure has somewhere to go. No microphone, a refused permission, an insecure origin, a
 * `503` from the ASR sidecar, or an inconclusive match all land on the same typed disease list,
 * because `GET /crops/{cropId}/diseases` is unaffected by any of them.
 */
const NONE = 0;

@Component({
  selector: 'foshol-faq-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslatePipe,
    RouterLink,
    CropGrid,
    EmptyState,
    ErrorPanel,
    Skeleton,
    Percent1Pipe,
    FaqRecorderPanel,
    FaqCandidateList,
    FaqRemedyList,
    FaqDiseaseSearch,
  ],
  // VoiceRecorder is page-scoped so leaving the screen gives the microphone back, and FaqStore
  // with it so the transcript and the remedies do not outlive the question that produced them.
  providers: [VoiceRecorder, FaqStore],
  templateUrl: './faq-page.html',
  styleUrl: './faq-page.css',
  host: { class: 'block' },
})
export class FaqPage {
  private readonly knowledge = inject(KnowledgeService);
  private readonly language = inject(LanguageStore);
  protected readonly store = inject(FaqStore);
  protected readonly recorder = inject(VoiceRecorder);

  protected readonly paths = FAQ_PATHS;
  protected readonly skeletonRows = APP_CONFIG.faq.candidateSkeletonRows;
  protected readonly NONE = NONE;

  protected readonly selectedCropId = signal<string | null>(null);
  /** Kept so a failed attempt can be retried without asking the farmer to speak again. */
  private readonly lastClip = signal<DraftAudio | null>(null);
  private readonly browseRequested = signal(false);

  protected readonly crops = resource({ loader: () => this.knowledge.listCrops() });

  protected readonly availableCrops = computed<readonly Crop[]>(() => this.crops.value() ?? []);

  protected readonly cropProblem = computed<ProblemView | null>(() => {
    const failure = this.crops.error();
    return failure === undefined ? null : toProblemView(failure);
  });

  /**
   * The catalogue for the chosen crop. Loaded alongside the voice path rather than only on
   * failure, so the fallback is already on screen the moment it is needed — a farmer whose
   * microphone was refused should not then wait for a second request.
   */
  protected readonly diseases = resource({
    params: () => ({ cropId: this.selectedCropId() }),
    loader: ({ params }): Promise<Disease[]> =>
      params.cropId === null
        ? Promise.resolve([])
        : this.knowledge.listDiseasesByCrop({ cropId: params.cropId }),
  });

  protected readonly cropChosen = computed(() => this.selectedCropId() !== null);

  /**
   * Show the typed list when speaking cannot work, when it did not work, or when the farmer
   * simply asked for it. It is an alternative, never a punishment for a failure.
   */
  protected readonly showBrowse = computed(
    () =>
      this.cropChosen() &&
      (this.browseRequested() ||
        !this.recorder.available() ||
        this.store.sidecarUnavailable() ||
        this.store.inconclusive()),
  );

  protected readonly transcription = computed(() => this.store.result()?.transcription ?? '');
  protected readonly asrConfidence = computed(() => this.store.result()?.asrConfidence ?? NONE);

  protected readonly canRetry = computed(
    () => this.lastClip() !== null && this.selectedCropId() !== null,
  );

  protected onCropChosen(cropId: string): void {
    if (cropId === this.selectedCropId()) return;
    this.selectedCropId.set(cropId);
    // A different crop is a different question: the previous answer no longer describes it.
    this.store.reset();
    this.recorder.discard();
    this.lastClip.set(null);
  }

  protected async onAsk(clip: DraftAudio): Promise<void> {
    const cropId = this.selectedCropId();
    if (cropId === null) return;
    this.lastClip.set(clip);
    this.browseRequested.set(false);
    await this.store.search(cropId, clip, this.language.current());
  }

  protected async onRetry(): Promise<void> {
    const cropId = this.selectedCropId();
    const clip = this.lastClip();
    if (cropId === null || clip === null) return;
    await this.store.search(cropId, clip, this.language.current());
  }

  protected async onConfirmed(selection: FaqSelection): Promise<void> {
    await this.store.confirm(selection);
  }

  protected async onRetryRemedies(): Promise<void> {
    const selection = this.store.selection();
    if (selection === null) return;
    await this.store.confirm(selection);
  }

  protected openBrowse(): void {
    this.browseRequested.set(true);
  }

  protected askAgain(): void {
    this.store.reset();
    this.recorder.discard();
    this.lastClip.set(null);
    this.browseRequested.set(false);
  }
}
