import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  resource,
  signal,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { APP_CONFIG } from '../../../core/config/app-config';
import { toProblemView } from '../../../core/errors/problem';
import { SseStore } from '../../../core/sse/sse-store';
import { CaseStatusStore } from '../../../core/stores/case-status-store';
import type { CaseStatus } from '../../../generated/models/case-status';
import { CasesService } from '../../../generated/services/cases.service';
import { ReviewService } from '../../../generated/services/review.service';
import { DhakaDateTimePipe } from '../../../shared/pipes/dhaka-date-time.pipe';
import { ErrorPanel } from '../../../shared/ui/error-panel/error-panel';
import { SecureImage } from '../../../shared/ui/secure-image/secure-image';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { StatusStepper } from '../../../shared/ui/status-stepper/status-stepper';
import { AdvisoryCard } from '../advisory/advisory-card';
import { RejectionPanel } from './rejection-panel';

/**
 * The case status view — where the farmer lands after a `202` (`WEB-FR-151`) and where the
 * advisory eventually appears.
 *
 * `WEB-FR-152` / `WEB-FR-353` — the stepper is driven by SSE `case-status` frames, which
 * `SseDispatcher` has already written into `CaseStatusStore`. **Nothing here polls, and a
 * status frame provokes no request at all** (`WEB-FR-356`, AC-21): the store already holds
 * everything the stepper needs.
 *
 * `WEB-FR-354` / `WEB-FR-358` — an advisory frame marks the case as needing a refresh and a
 * reconnect-after-a-gap bumps `resyncTick`; both are watched here, and only those two refetch.
 *
 * The wait is not an apology. Between `IN_REVIEW` and `ADVISED` a human being is reading this
 * farmer's photographs, which is the entire product — so the copy says that warmly rather than
 * pretending the system is slow.
 */
const STATUS_ADVISED: CaseStatus = 'ADVISED';
const STATUS_REJECTED: CaseStatus = 'REJECTED';
const STATUS_FAILED: CaseStatus = 'FAILED';
const STATUS_IN_REVIEW: CaseStatus = 'IN_REVIEW';
const STATUS_ANALYSED: CaseStatus = 'ANALYSED';

/** `WEB-API-003` — the wire's page index is zero-based. */
const FIRST_PAGE = 0;

@Component({
  selector: 'foshol-case-status-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslatePipe,
    DhakaDateTimePipe,
    AdvisoryCard,
    ErrorPanel,
    RejectionPanel,
    SecureImage,
    Skeleton,
    StatusStepper,
  ],
  host: { class: 'block' },
  templateUrl: './case-status-page.html',
})
export class CaseStatusPage {
  private readonly cases = inject(CasesService);
  private readonly review = inject(ReviewService);
  private readonly caseStatus = inject(CaseStatusStore);
  private readonly sse = inject(SseStore);

  /** Bound by the router from `cases/:caseId` (`withComponentInputBinding`). */
  readonly caseId = input.required<string>();

  /**
   * When the currently held `CaseDetail` was read. A `case-status` frame that arrived AFTER
   * that read is newer than the body, and vice versa — which is the whole reason the two are
   * compared rather than one being preferred blindly.
   */
  private readonly _loadedAt = signal(0);

  private readonly caseDetail = resource({
    params: () => ({ caseId: this.caseId() }),
    loader: async ({ params }) => {
      const detail = await this.cases.getCase({ caseId: params.caseId });
      this._loadedAt.set(Date.now());
      return detail;
    },
  });

  protected readonly detail = computed(() =>
    this.caseDetail.hasValue() ? this.caseDetail.value() : null,
  );
  protected readonly detailLoading = computed(() => this.caseDetail.isLoading());
  protected readonly detailProblem = computed(() => {
    const error = this.caseDetail.error();
    return error === undefined ? null : toProblemView(error);
  });

  /**
   * The status on screen. Only ever a value the server sent — either in the case body or in an
   * SSE frame — never a locally inferred next step (`WEB-NFR-001`).
   */
  protected readonly status = computed<CaseStatus | null>(() => {
    const entry = this.caseStatus.entryOf(this.caseId());
    const body = this.detail()?.status ?? null;
    if (entry === null) return body;
    if (body === null || entry.at >= this._loadedAt()) return entry.status;
    return body;
  });

  protected readonly isAdvised = computed(() => this.status() === STATUS_ADVISED);
  protected readonly isRejected = computed(() => this.status() === STATUS_REJECTED);
  protected readonly isFailed = computed(() => this.status() === STATUS_FAILED);
  protected readonly isWaitingOnOfficer = computed(() => {
    const current = this.status();
    return current === STATUS_IN_REVIEW || current === STATUS_ANALYSED;
  });

  /** Bumped so an `ADVISORY_REVISED` frame re-reads the advisory rather than keeping v1. */
  private readonly _advisoryTick = signal(0);

  private readonly advisoryResource = resource({
    params: () =>
      this.isAdvised() ? { caseId: this.caseId(), at: this._advisoryTick() } : undefined,
    loader: ({ params }) => this.review.getCaseAdvisory({ caseId: params.caseId }),
  });

  protected readonly advisory = computed(() =>
    this.advisoryResource.hasValue() ? this.advisoryResource.value() : null,
  );
  protected readonly advisoryLoading = computed(() => this.advisoryResource.isLoading());

  /**
   * The officer's Bangla rejection message.
   *
   * There is no farmer-facing rejection resource in the frozen contract — the handover (§7.7)
   * says the message rides on the case history row — so the row is where it is read from. Only
   * the first page is searched: a rejection the farmer has just been notified about is on it,
   * and paging through a history to find one string would be worse than omitting it. When it
   * is not found the panel still renders, without a quotation; nothing is invented for it
   * (`COMMON-CON-003`).
   */
  private readonly rejectionResource = resource({
    params: () => (this.isRejected() ? { caseId: this.caseId() } : undefined),
    loader: async ({ params }) => {
      const page = await this.cases.listMyCases({
        page: FIRST_PAGE,
        size: APP_CONFIG.page.defaultSize,
      });
      return page.content.find((row) => row.caseId === params.caseId)?.rejectionMessageBn ?? null;
    },
  });

  protected readonly rejectionMessage = computed(() =>
    this.rejectionResource.hasValue() ? this.rejectionResource.value() : null,
  );

  #seenResyncTick = this.sse.resyncTick();

  constructor() {
    // WEB-FR-354 — an advisory or rejection frame is the one thing that dirties this view.
    effect(() => {
      if (!this.caseStatus.needsRefresh(this.caseId())) return;
      this.caseStatus.clearRefresh(this.caseId());
      this.refresh();
    });

    // WEB-FR-358 — the stream reopened after a gap, so frames were missed.
    effect(() => {
      const tick = this.sse.resyncTick();
      if (tick === this.#seenResyncTick) return;
      this.#seenResyncTick = tick;
      this.refresh();
    });
  }

  /** WEB-FR-356 — the degraded path is this control, never a timer. */
  protected refresh(): void {
    this.caseDetail.reload();
    this._advisoryTick.update((tick) => tick + 1);
  }
}
