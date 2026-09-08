import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { SseStore } from '../../../core/sse/sse-store';
import {
  CaseReviewStore,
  CLAIM_EXPIRED,
  CLAIM_HELD_BY_ME,
  CLAIM_HELD_BY_OTHER,
} from '../../../core/stores/case-review-store';
import type { CaseImage } from '../../../generated/models/case-image';
import { AnalysisModeBadge } from '../../../shared/ui/analysis-mode-badge/analysis-mode-badge';
import { AudioPlayer } from '../../../shared/ui/audio-player/audio-player';
import { DecisionPathBadge } from '../../../shared/ui/decision-path-badge/decision-path-badge';
import { ErrorPanel } from '../../../shared/ui/error-panel/error-panel';
import { GradcamView } from '../../../shared/ui/gradcam-view/gradcam-view';
import { Icon } from '../../../shared/ui/icon/icon';
import { ImageZoom } from '../../../shared/ui/image-zoom/image-zoom';
import { MatcherChip } from '../../../shared/ui/matcher-chip/matcher-chip';
import { SecureImage } from '../../../shared/ui/secure-image/secure-image';
import { Spinner } from '../../../shared/ui/spinner/spinner';
import { DhakaDateTimePipe } from '../../../shared/pipes/dhaka-date-time.pipe';
import { Percent1Pipe } from '../../../shared/pipes/percent1.pipe';
import {
  ACTION_APPROVED,
  ACTION_EDITED,
  ACTION_REPLACED,
  OfficerFacade,
  REJECTION_REASONS,
  type RejectionReason,
} from '../officer-facade';
import { OFFICER_PATHS } from '../officer-paths';
import { CandidateList } from './candidate-list';
import { ClaimTimerRing } from './claim-timer-ring';
import { RemedyEditor } from './remedy-editor';

/**
 * The case workspace — where the human approval gate actually happens.
 *
 * **Composed, not fetched** (`DEVIATIONS.md` D-05): the live `GET /review/tasks/{taskId}` does
 * not match the frozen `ReviewCaseDetail`, so `OfficerFacade` assembles this view from
 * `GET /cases/{caseId}`, `GET /cases/{caseId}/analysis`, the `ReviewTask` returned by `claim`,
 * the queue row and the knowledge endpoints. Nothing on this screen reads the flat body except
 * through the one marked adapter.
 *
 * The requirements this component carries:
 *  - `WEB-FR-210`…`212` — every image, zoomable by pointer and keyboard; the Grad-CAM toggle
 *    exists only where the analysis says there is an overlay, and is hidden — not disabled —
 *    otherwise.
 *  - `WEB-FR-213`…`217` — audio with its Bangla transcript beside it, symptom chips carrying
 *    name, score and matcher, the decision-path and `REPLAY`/`LIVE` badges on every case, and
 *    the model identity, version, latency, margin and unmapped-label count.
 *  - `WEB-FR-219` — demo beat 8. When the analysis carries an `errorCode`, the banner names it
 *    **and all four actions stay available**: the sidecar dies on stage and the case still
 *    reaches a human as `UNDETERMINED`.
 *  - `WEB-FR-230`…`235`, `WEB-FR-240`…`244` — the four terminal actions, the claim lifecycle,
 *    and the promise that runs through all of it: the officer's unsaved words are never
 *    discarded by a background event.
 */
const NO_UNMAPPED = 0;

/**
 * Utility classes rather than component CSS. Tailwind scans TypeScript, so these are emitted
 * exactly as if they were written in the template — and keeping the button, field and action
 * bar rules out of `case-workspace-page.css` is what holds that file inside the 4 kB
 * per-component style budget the production build enforces.
 *
 * WEB-UX-033 — every one of them starts with `touch-target`.
 */
const BUTTON_BASE =
  'touch-target inline-flex items-center justify-center rounded-xl px-4 text-sm font-bold transition-colors duration-1 ease-settle disabled:cursor-not-allowed disabled:border-surface-3 disabled:bg-surface-2 disabled:text-ink-faint disabled:shadow-none';

@Component({
  selector: 'foshol-case-workspace-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AnalysisModeBadge,
    AudioPlayer,
    CandidateList,
    ClaimTimerRing,
    DecisionPathBadge,
    DhakaDateTimePipe,
    ErrorPanel,
    GradcamView,
    Icon,
    ImageZoom,
    MatcherChip,
    Percent1Pipe,
    RemedyEditor,
    RouterLink,
    SecureImage,
    Spinner,
    TranslatePipe,
  ],
  templateUrl: './case-workspace-page.html',
  styleUrl: './case-workspace-page.css',
  host: { class: 'block' },
})
export class CaseWorkspacePage {
  /** Bound from the `:taskId` route parameter by `withComponentInputBinding()`. */
  readonly taskId = input.required<string>();

  protected readonly facade = inject(OfficerFacade);
  protected readonly store = inject(CaseReviewStore);
  private readonly sse = inject(SseStore);

  protected readonly queuePath = OFFICER_PATHS.queue;
  protected readonly rejectionReasons = REJECTION_REASONS;

  protected readonly btnPrimary = `${BUTTON_BASE} bg-paddy-600 text-ink-invert shadow-stamp hover:bg-paddy-700`;
  protected readonly btnConsole = `${BUTTON_BASE} bg-slate-800 text-ink-invert shadow-stamp hover:bg-slate-900`;
  protected readonly btnQuiet = `${BUTTON_BASE} border border-surface-3 bg-surface-0 text-ink hover:bg-surface-1`;
  protected readonly btnDanger = `${BUTTON_BASE} border border-clay-300 bg-clay-100 text-clay-700 hover:bg-clay-300 hover:text-ink`;
  /** WEB-UX-030 — sticky at 360 px so all four actions stay reachable; in the flow from md. */
  protected readonly actionBarClass =
    'sticky bottom-0 z-10 mt-4 flex flex-wrap gap-2 border-t border-surface-2 bg-surface-0 py-2.5 md:static';
  protected readonly fieldLabelClass = 'mt-3 block font-bold text-ink';
  protected readonly fieldClass =
    'mt-1.5 w-full rounded-xl border border-surface-3 bg-surface-0 px-3 py-2 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-muted';
  protected readonly fieldErrorClass = 'mt-1.5 text-sm font-bold text-clay-700';

  protected readonly caseDetail = this.store.case;
  protected readonly analysis = this.store.analysis;
  protected readonly draft = this.store.remedyDraft;

  protected readonly activeImageId = signal<string | null>(null);
  protected readonly replaceOpen = signal(false);
  protected readonly rejectOpen = signal(false);
  protected readonly rejectReason = signal<RejectionReason | null>(null);
  protected readonly rejectMessage = signal('');
  protected readonly rejectAttempted = signal(false);
  private readonly rejectReasonInputRef =
    viewChild<ElementRef<HTMLSelectElement>>('rejectReasonInput');
  private readonly rejectMessageInputRef =
    viewChild<ElementRef<HTMLTextAreaElement>>('rejectMessageInput');

  protected readonly claimState = this.store.claimState;
  protected readonly canAct = this.store.canAct;
  protected readonly expired = computed(() => this.store.claimState() === CLAIM_EXPIRED);
  protected readonly heldByMe = computed(() => this.store.claimState() === CLAIM_HELD_BY_ME);
  /** `WEB-FR-243` — either the server says someone else holds it, or a re-claim just lost. */
  protected readonly readOnly = computed(
    () => this.store.readOnly() || this.store.claimState() === CLAIM_HELD_BY_OTHER,
  );
  protected readonly claimStateKey = computed(
    () => `officer.claim.state.${this.store.claimState()}`,
  );
  protected readonly showTimer = computed(() => this.store.claimRemainingMs() !== null);

  protected readonly images = computed<readonly CaseImage[]>(() => this.caseDetail()?.images ?? []);

  protected readonly activeImage = computed<CaseImage | null>(() => {
    const images = this.images();
    if (images.length === 0) return null;
    const chosen = images.find((image) => image.imageId === this.activeImageId());
    return chosen ?? images.find((image) => image.primary) ?? images[0];
  });

  /** `WEB-FR-217` — the count, so an unmapped model output is never silently dropped. */
  protected readonly unmappedCount = computed(
    () => this.analysis()?.unmappedLabels?.length ?? NO_UNMAPPED,
  );

  /** The human-supplied name of whichever disease the officer currently has selected. */
  protected readonly selectedDiseaseName = computed(() => {
    const diseaseId = this.draft().diseaseId;
    if (diseaseId === null) return '';
    const disease = this.facade.diseases().find((entry) => entry.id === diseaseId);
    if (disease !== undefined) return disease.nameBn;
    const candidate = this.store.candidates().find((entry) => entry.diseaseId === diseaseId);
    return candidate?.diseaseNameBn ?? '';
  });

  protected readonly hasDisease = computed(() => this.draft().diseaseId !== null);
  protected readonly hasRemedy = computed(() => this.draft().remedyIds.length > 0);
  protected readonly canSubmit = computed(
    () => this.canAct() && this.hasDisease() && this.hasRemedy() && !this.facade.actionPending(),
  );

  /** `WEB-FR-233` — a reason AND a Bangla message, both, before Reject can be submitted. */
  protected readonly rejectValid = computed(
    () => this.rejectReason() !== null && this.rejectMessage().trim().length > 0,
  );

  private lastResyncTick = this.sse.resyncTick();

  constructor() {
    effect(() => {
      const taskId = this.taskId();
      // Reading the id is the whole dependency: everything else this effect touches is a
      // write, and re-running on a signal it wrote would be a loop.
      void this.facade.openTask(taskId);
    });

    /** `WEB-FR-358` — the stream missed events, so the open case is re-read. Not a timer. */
    effect(() => {
      const tick = this.sse.resyncTick();
      if (tick === this.lastResyncTick) return;
      this.lastResyncTick = tick;
      void this.facade.refreshCase();
    });

    inject(DestroyRef).onDestroy(() => this.facade.closeCase());
  }

  protected pickImage(imageId: string): void {
    this.activeImageId.set(imageId);
  }

  protected claim(): void {
    void this.facade.claim();
  }

  protected release(): void {
    void this.facade.release();
  }

  protected approve(): void {
    void this.facade.publish(ACTION_APPROVED);
  }

  protected edit(): void {
    void this.facade.publish(ACTION_EDITED);
  }

  /** `WEB-FR-232` — Replace opens the crop's disease list; confirming publishes as REPLACED. */
  protected openReplace(): void {
    this.rejectOpen.set(false);
    this.replaceOpen.update((open) => !open);
  }

  protected chooseDisease(diseaseId: string): void {
    void this.facade.selectDisease(diseaseId);
  }

  protected confirmReplace(): void {
    void this.facade.publish(ACTION_REPLACED);
  }

  protected openReject(): void {
    this.replaceOpen.set(false);
    this.rejectOpen.update((open) => !open);
    this.rejectAttempted.set(false);
  }

  protected setRejectReason(event: Event): void {
    const target = event.target as HTMLSelectElement;
    const value = target.value;
    this.rejectReason.set(REJECTION_REASONS.find((reason) => reason === value) ?? null);
  }

  protected setRejectMessage(event: Event): void {
    this.rejectMessage.set((event.target as HTMLTextAreaElement).value);
  }

  protected submitReject(): void {
    this.rejectAttempted.set(true);
    const reason = this.rejectReason();
    if (reason === null || !this.rejectValid()) {
      // The reason select precedes the message textarea on screen, so it wins the focus first.
      const target =
        reason === null ? this.rejectReasonInputRef() : this.rejectMessageInputRef();
      target?.nativeElement.focus();
      return;
    }
    void this.facade.reject(reason, this.rejectMessage().trim());
  }

  protected toggleRemedy(remedyId: string): void {
    this.store.toggleRemedy(remedyId);
  }

  protected setNote(note: string): void {
    this.store.setOfficerNote(note);
  }

  protected refresh(): void {
    void this.facade.refreshCase();
  }
}
