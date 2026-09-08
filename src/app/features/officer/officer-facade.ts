import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { APP_CONFIG } from '../../core/config/app-config';
import { HTTP_STATUS, toProblemView, type ProblemView } from '../../core/errors/problem';
import { CaseReviewStore } from '../../core/stores/case-review-store';
import { LiveAnnouncer } from '../../core/stores/live-announcer';
import { QueueStore } from '../../core/stores/queue-store';
import { TOAST_SUCCESS, ToastStore } from '../../core/stores/toast-store';
import type { BulkOperationResult } from '../../generated/models/bulk-operation-result';
import type { CaseDetail } from '../../generated/models/case-detail';
import type { ColleagueOfficer } from '../../generated/models/colleague-officer';
import type { ComputedDose } from '../../generated/models/computed-dose';
import type { Disease } from '../../generated/models/disease';
import type { OfficerQueueRow } from '../../generated/models/officer-queue-row';
import type { PublishAdvisoryRequest } from '../../generated/models/publish-advisory-request';
import type { RejectCaseRequest } from '../../generated/models/reject-case-request';
import type { Remedy } from '../../generated/models/remedy';
import type { ReviewCaseDetail } from '../../generated/models/review-case-detail';
import { AnalysisService } from '../../generated/services/analysis.service';
import { CasesService } from '../../generated/services/cases.service';
import { KnowledgeService } from '../../generated/services/knowledge.service';
import { ReviewService } from '../../generated/services/review.service';
import { OFFICER_PATHS } from './officer-paths';
import {
  adaptReviewTask,
  remedyId,
  UNKNOWN_TASK_VERSION,
  type ReviewTaskSummary,
} from './review-task.adapter';

/**
 * Everything the officer console does to the network, in one place.
 *
 * **How the workspace is composed** (`DEVIATIONS.md` D-05). The live
 * `GET /review/tasks/{taskId}` does not match the frozen `ReviewCaseDetail`, so the workspace
 * is NOT built from it. It is assembled from the endpoints that do match:
 *
 * | Need | Source |
 * |---|---|
 * | case, images, note, audio ref | `CasesService.getCase` |
 * | candidates, symptoms, transcript, **thresholds**, `hasGradcam`, mode, model meta | `AnalysisService.getCaseAnalysis` |
 * | claim state and `expectedVersion` | the `ReviewTask` returned by `claim` / `release` |
 * | farmer name, SLA, re-submission flag | the queue row |
 * | disease list, remedy prefill | `KnowledgeService` |
 *
 * `getReviewTask` is called through the generated client for exactly three things —
 * `suggestedRemedies`, `topDiseaseId`, `publishedAdvisory` — and its body goes through the one
 * marked adapter.
 *
 * `WEB-FR-244` — nothing here retries. A failed action surfaces the server's problem and waits
 * for the officer, because a silent retry of "publish this advisory" is a second advisory.
 */
const FIRST_PAGE = 0;

/** An empty batch is never sent, so this is both the floor and the slice origin. */
const NO_ITEMS = 0;

/** Shared empty result, so a case with no computed dose does not churn a new Map each read. */
const EMPTY_DOSES: ReadonlyMap<string, ComputedDose> = new Map();

/** Task states this class has to name. Taken from the generated union so they cannot drift. */
const STATE_PENDING: OfficerQueueRow['state'] = 'PENDING';
const STATE_CLAIMED: OfficerQueueRow['state'] = 'CLAIMED';

/**
 * `REVIEW-FR-090` / `REVIEW-FR-091` — one label per operational clock, so the words on screen
 * always name the instant beneath them and neither can be read as the farmer's SLA.
 */
export const KPI_ASSIGNMENT_KEY = 'officer.kpi.assignment';
export const KPI_RESOLUTION_KEY = 'officer.kpi.resolution';

export type PublishAction = PublishAdvisoryRequest['action'];

export const ACTION_APPROVED: PublishAction = 'APPROVED';
export const ACTION_EDITED: PublishAction = 'EDITED';
export const ACTION_REPLACED: PublishAction = 'REPLACED';

export type RejectionReason = RejectCaseRequest['reasonCode'];

/**
 * Exactly what an inline approve will publish, captured from `getReviewTask` BEFORE anything is
 * claimed or written, and rendered to the officer before they confirm. The publish request is
 * then built from this object, so the advisory that reaches the farmer is the one that was on
 * screen (`COMMON-CON-003` — the console never composes agronomic content of its own).
 */
export interface QueueApproval {
  readonly taskId: string;
  readonly diseaseId: string;
  readonly remedyIds: readonly string[];
}

/**
 * One task's result inside a bulk run — the server's own per-item verdict
 * (`BulkOperationResult.results`), or, for a task that never reached the request, the code of
 * the failure that stopped it. `errorCode` is `null` on success and on a failure the server
 * named nothing for.
 */
export interface BulkOutcome {
  readonly taskId: string;
  readonly ok: boolean;
  readonly errorCode: string | null;
}

/**
 * A bulk run, as the bar renders it. Counts are derived from `outcomes` rather than tallied
 * alongside it, so the number on screen and the list beneath it cannot disagree.
 *
 * `problem` is the WHOLE REQUEST failing — `400 ERR_BULK_TOO_LARGE`, a `403`, a dropped
 * connection. A `200` with failed items is not that: `REVIEW-FR-098` makes partial success the
 * normal outcome, so per-item failures live in `outcomes` and never light this up.
 */
export interface BulkProgress {
  readonly running: boolean;
  readonly total: number;
  readonly outcomes: readonly BulkOutcome[];
  readonly problem: ProblemView | null;
}

export const IDLE_BULK: BulkProgress = { running: false, total: 0, outcomes: [], problem: null };

/** `BulkOperationResult.results[].status`, from the generated union so it cannot drift. */
const BULK_OK: BulkOperationResult['results'][number]['status'] = 'OK';

export const succeededIn = (bulk: BulkProgress): readonly BulkOutcome[] =>
  bulk.outcomes.filter((outcome) => outcome.ok);

export const failedIn = (bulk: BulkProgress): readonly BulkOutcome[] =>
  bulk.outcomes.filter((outcome) => !outcome.ok);

/** `WEB-FR-233` — the reason set, taken from the generated schema so it cannot drift. */
export const REJECTION_REASONS: readonly RejectionReason[] = [
  'BLURRY_IMAGE',
  'NOT_A_CROP',
  'WRONG_CROP',
  'INSUFFICIENT_DETAIL',
  'INAUDIBLE_AUDIO',
  'OTHER',
];

@Injectable({ providedIn: 'root' })
export class OfficerFacade {
  private readonly reviewApi = inject(ReviewService);
  private readonly casesApi = inject(CasesService);
  private readonly analysisApi = inject(AnalysisService);
  private readonly knowledgeApi = inject(KnowledgeService);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastStore);
  private readonly announcer = inject(LiveAnnouncer);

  readonly queue = inject(QueueStore);
  readonly workspace = inject(CaseReviewStore);

  private readonly _queueProblem = signal<ProblemView | null>(null);
  private readonly _casePayload = signal<ProblemView | null>(null);
  private readonly _actionProblem = signal<ProblemView | null>(null);
  private readonly _summary = signal<ReviewTaskSummary | null>(null);
  private readonly _diseases = signal<readonly Disease[]>([]);
  private readonly _diseasesLoading = signal(false);
  private readonly _remedies = signal<readonly Remedy[]>([]);
  private readonly _remediesLoading = signal(false);
  private readonly _claimPending = signal(false);
  private readonly _actionPending = signal(false);
  private readonly _colleagues = signal<readonly ColleagueOfficer[]>([]);
  private readonly _colleaguesLoading = signal(false);
  private readonly _colleaguesProblem = signal<ProblemView | null>(null);
  /**
   * Transfer failures are held apart from `_actionProblem` on purpose: the transfer panel names
   * this endpoint's own error codes in its own words, and sharing one signal would print the
   * same failure twice — once there and once in the workspace's generic action-problem block.
   */
  private readonly _transferProblem = signal<ProblemView | null>(null);

  readonly queueProblem = this._queueProblem.asReadonly();
  readonly caseProblem = this._casePayload.asReadonly();
  /** `WEB-FR-235` — the last failed action, kept on screen beside the editor it did not clear. */
  readonly actionProblem = this._actionProblem.asReadonly();
  readonly summary = this._summary.asReadonly();
  readonly diseases = this._diseases.asReadonly();
  readonly diseasesLoading = this._diseasesLoading.asReadonly();
  /** The active remedies of the selected disease, exactly as the API returned them. */
  readonly remedies = this._remedies.asReadonly();
  readonly remediesLoading = this._remediesLoading.asReadonly();
  readonly claimPending = this._claimPending.asReadonly();
  readonly actionPending = this._actionPending.asReadonly();
  /** `REVIEW-FR-097` — active officers in the caller's district, self already excluded. */
  readonly colleagues = this._colleagues.asReadonly();
  readonly colleaguesLoading = this._colleaguesLoading.asReadonly();
  readonly colleaguesProblem = this._colleaguesProblem.asReadonly();
  readonly transferProblem = this._transferProblem.asReadonly();

  readonly conflicted = computed(() => this._actionProblem()?.status === HTTP_STATUS.conflict);

  /** The queue row for the open case, when it is on the loaded page — SLA and farmer name. */
  readonly openRow = computed<OfficerQueueRow | null>(() => {
    const caseId = this.workspace.case()?.caseId;
    if (caseId === undefined) return null;
    return this.queue.rows().find((row) => row.caseId === caseId) ?? null;
  });

  readonly farmerName = computed(
    () => this.openRow()?.farmerName ?? this._summary()?.farmerName ?? null,
  );

  readonly slaDueAt = computed(
    () => this.openRow()?.slaDueAt ?? this.workspace.task()?.slaDueAt ?? null,
  );

  readonly isResubmission = computed(
    () => this.openRow()?.isResubmission ?? this._summary()?.isResubmission ?? false,
  );

  /**
   * The OPERATIONAL clock for the open case — the officer's own deadline, never the farmer's
   * wait above.
   *
   * `REVIEW-FR-090` / `REVIEW-FR-091`: a `PENDING` task is counting down to `assignmentDueAt`,
   * a `CLAIMED` one to `resolutionDueAt`, and a decided task is counting down to nothing at
   * all. Both are frozen server instants and both are nullable — the running server omits them
   * entirely — so `null` here means "render no clock", which is what `KpiClock` does with it.
   *
   * `WEB-NFR-001` — the instant is read, never derived. Nothing in this class knows the working
   * calendar, and nothing in it ever adds an hour to `now`.
   */
  readonly kpiDueAt = computed<string | null>(() => {
    const task = this.workspace.task();
    const row = this.openRow();
    const state = task?.state ?? row?.state ?? null;
    if (state === STATE_CLAIMED) return task?.resolutionDueAt ?? row?.resolutionDueAt ?? null;
    if (state === STATE_PENDING) return task?.assignmentDueAt ?? row?.assignmentDueAt ?? null;
    return null;
  });

  readonly kpiLabelKey = computed(() => {
    const state = this.workspace.task()?.state ?? this.openRow()?.state ?? null;
    return state === STATE_CLAIMED ? KPI_RESOLUTION_KEY : KPI_ASSIGNMENT_KEY;
  });

  /**
   * The server's own dose arithmetic, keyed by remedy id.
   *
   * `computedDose` rides only on the review task's `suggestedRemedies`, which the server computes
   * for the **rank-1** disease from the case's `fieldArea`. The editor renders the knowledge
   * catalogue instead (`listRemedies`), and by contract that response never carries a dose — so
   * the two are joined here rather than in the template.
   *
   * The join is gated on the officer still having the rank-1 disease selected. Once they replace
   * it, the dose belongs to a diagnosis that is no longer on screen, and a dose shown against the
   * wrong disease is not a stale number, it is a wrong instruction (`COMMON-CON-003`). Nothing
   * here recomputes anything: `WEB-NFR-001` — area x rate is the server's sum, not ours.
   */
  readonly computedDoseById = computed<ReadonlyMap<string, ComputedDose>>(() => {
    const summary = this._summary();
    const selected = this.workspace.remedyDraft().diseaseId;
    if (summary === null || selected === null || selected !== summary.topDiseaseId) {
      return EMPTY_DOSES;
    }
    const doses = new Map<string, ComputedDose>();
    for (const remedy of summary.suggestedRemedies) {
      if (remedy.computedDose === undefined || remedy.computedDose === null) continue;
      doses.set(remedyId(remedy), remedy.computedDose);
    }
    return doses;
  });

  // ── Queue ────────────────────────────────────────────────────────────────────────────────

  /**
   * `WEB-FR-205` — the manual refresh control calls this, and so does `WEB-FR-358` when the
   * stream reconnects after a gap. There is no timer anywhere in this class (`WEB-FR-356`).
   *
   * `GetReviewQueue$Params.state` is a real, generated query parameter — filtering by it is
   * the server doing the filtering, not a client-side approximation of it. `QueueStore` holds
   * which one is active (WEB-SEC-004: it already clears on sign-out with the rest of the queue
   * state), so every caller here — this one included — keeps whatever filter is active without
   * having to pass it through explicitly.
   */
  async loadQueue(page: number = this.queue.page()): Promise<void> {
    this.queue.beginLoad();
    this._queueProblem.set(null);
    try {
      const result = await this.reviewApi.getReviewQueue({
        page,
        size: APP_CONFIG.page.defaultSize,
        state: this.queue.stateFilter() ?? undefined,
      });
      // WEB-FR-200 — adopted whole, in the server's order. Nothing here sorts.
      this.queue.applyPage(result);
      this.approvalReads.clear();
    } catch (error) {
      const problem = toProblemView(error);
      this.queue.failLoad(problem);
      this._queueProblem.set(problem);
    }
  }

  /** Changing the filter starts over at the first page — a page index from one filter means
      nothing under another. */
  async setStateFilter(state: OfficerQueueRow['state'] | null): Promise<void> {
    this.queue.setStateFilter(state);
    await this.loadQueue(FIRST_PAGE);
  }

  // ── Inline queue actions (WEB-FR-230/233/240/244) ────────────────────────────────────────

  /**
   * Approving or rejecting straight from a queue row.
   *
   * **Nothing in this section touches `CaseReviewStore`.** That store holds the case the
   * officer currently has OPEN in the workspace pane, together with their unsaved remedy draft
   * and note. A row action is about a different case, and letting it write there would let a
   * click in the left pane silently rewrite what the right pane is about to publish.
   *
   * **There is no one-click approve, and this does not pretend otherwise.** `approve` needs a
   * `diseaseId`, a `remedyIds` list and the `expectedVersion` the officer holds, so the honest
   * minimum is: read what would be published → show it → claim → publish exactly that.
   *
   * The read happens BEFORE the claim, deliberately. Claiming on the way to a *confirmation*
   * would lock the task for `APP_CONFIG.review.claimTtlMs` as a side effect of merely opening a
   * menu, and an officer who then changes their mind would leave the case unavailable to
   * everyone else for fifteen minutes. So: `readApproval` (a plain GET, no claim) → the officer
   * sees the diagnosis and the remedy count → `claimReviewTask` → `publishAdvisory` with the
   * ids that were on screen. That ordering is also what makes "never publish advice the officer
   * has not been shown" true by construction rather than by hope: the request body is built
   * from the approval that was rendered, not from a second, unseen read.
   */

  private readonly _rowActionProblem = signal<ProblemView | null>(null);
  private readonly _rowActionTaskId = signal<string | null>(null);
  private readonly _bulk = signal<BulkProgress>(IDLE_BULK);

  /** `WEB-FR-244` — the last inline failure, shown until the officer dismisses it. */
  readonly rowActionProblem = this._rowActionProblem.asReadonly();
  /** The task an inline action is currently writing, so exactly one row shows a pending state. */
  readonly rowActionTaskId = this._rowActionTaskId.asReadonly();
  readonly bulk = this._bulk.asReadonly();

  /**
   * What an inline approve WOULD publish, read without writing and without claiming.
   *
   * `getReviewTask` is the only source of `topDiseaseId` and `suggestedRemedies` (D-05), and
   * the flat body goes through the one adapter as everywhere else. `null` means the task
   * carries no suggested diagnosis — approve is then not offered at all, because an advisory
   * with no disease is not an advisory.
   */
  async readApproval(taskId: string): Promise<QueueApproval | null> {
    const inFlight = this.approvalReads.get(taskId);
    if (inFlight !== undefined) return inFlight;
    const pending = this.fetchApproval(taskId);
    this.approvalReads.set(taskId, pending);
    return pending;
  }

  /**
   * `WEB-UX-032` renders the queue twice — cards below `md`, a table above — and both live in
   * the DOM at once, so opening one row's confirm panel mounts two of them. They are the same
   * question about the same task, so they share one answer rather than issuing two GETs and
   * risking two different ones. The cache is dropped whenever a fresh page arrives, because a
   * reloaded queue is exactly when a task's suggestion may have changed.
   */
  private readonly approvalReads = new Map<string, Promise<QueueApproval | null>>();

  private async fetchApproval(taskId: string): Promise<QueueApproval | null> {
    try {
      const summary = adaptReviewTask(await this.reviewApi.getReviewTask({ taskId }), taskId);
      if (summary.topDiseaseId === null) return null;
      return {
        taskId,
        diseaseId: summary.topDiseaseId,
        remedyIds: summary.suggestedRemedies.map(remedyId),
      };
    } catch (error) {
      this._rowActionProblem.set(toProblemView(error));
      return null;
    }
  }

  /** The same read for a selection, so a bulk confirmation can state every row it will publish. */
  async readApprovals(taskIds: readonly string[]): Promise<readonly QueueApproval[]> {
    const results = await Promise.all(taskIds.map((taskId) => this.readApproval(taskId)));
    return results.filter((approval): approval is QueueApproval => approval !== null);
  }

  /** `WEB-FR-240` — claim, then publish the approval the officer was shown. */
  async approveFromQueue(approval: QueueApproval): Promise<boolean> {
    return this.runRowAction(
      approval.taskId,
      () => this.approveOne(approval),
      'officer.queue.action.approved',
    );
  }

  /** `WEB-FR-233` — the caller has already required both a reason and a Bangla message. */
  async rejectFromQueue(
    taskId: string,
    reasonCode: RejectionReason,
    messageBn: string,
  ): Promise<boolean> {
    return this.runRowAction(
      taskId,
      () => this.rejectOne(taskId, reasonCode, messageBn),
      'officer.queue.action.rejected',
    );
  }

  clearRowActionProblem(): void {
    this._rowActionProblem.set(null);
  }

  clearBulk(): void {
    this._bulk.set(IDLE_BULK);
  }

  private async runRowAction(
    taskId: string,
    step: () => Promise<ProblemView | null>,
    announceKey: string,
  ): Promise<boolean> {
    if (this._rowActionTaskId() !== null) return false;
    this._rowActionTaskId.set(taskId);
    this._rowActionProblem.set(null);
    try {
      const problem = await step();
      if (problem !== null) {
        this._rowActionProblem.set(problem);
        // WEB-FR-243 — a 409 means somebody else reached this case first. Re-read rather than
        // retry (WEB-FR-244); the queue is the only thing that can say who holds it now.
        if (problem.status === HTTP_STATUS.conflict) await this.loadQueue();
        return false;
      }
      this.toasts.show({ kind: TOAST_SUCCESS, titleKey: announceKey });
      this.announcer.announce(announceKey);
      await this.loadQueue();
      return true;
    } finally {
      this._rowActionTaskId.set(null);
    }
  }

  /**
   * `WEB-NFR-001` — `action` is sent because the generated request type demands it; the server
   * derives the value it actually records (`LIVE-API-NOTES.md`), and nothing here reads it back.
   */
  private async approveOne(approval: QueueApproval): Promise<ProblemView | null> {
    let claimed = false;
    try {
      const task = await this.reviewApi.claimReviewTask({ taskId: approval.taskId });
      claimed = true;
      await this.reviewApi.publishAdvisory({
        taskId: approval.taskId,
        body: {
          action: ACTION_APPROVED,
          diseaseId: approval.diseaseId,
          remedyIds: [...approval.remedyIds],
          expectedVersion: task.version,
        },
      });
      return null;
    } catch (error) {
      if (claimed) await this.releaseQuietly(approval.taskId);
      return toProblemView(error);
    }
  }

  private async rejectOne(
    taskId: string,
    reasonCode: RejectionReason,
    messageBn: string,
  ): Promise<ProblemView | null> {
    let claimed = false;
    try {
      const task = await this.reviewApi.claimReviewTask({ taskId });
      claimed = true;
      await this.reviewApi.rejectCase({
        taskId,
        body: { reasonCode, messageBn, expectedVersion: task.version },
      });
      return null;
    } catch (error) {
      if (claimed) await this.releaseQuietly(taskId);
      return toProblemView(error);
    }
  }

  /**
   * A claim taken for an action that then failed is handed straight back. Without this, one
   * failed inline approve would park the case behind a claim for the full claim TTL, which is
   * the queue punishing every other officer for one officer's failed request. The release
   * itself is best-effort on purpose: its failure must not replace the real problem on screen,
   * and the claim expires by itself regardless.
   */
  private async releaseQuietly(taskId: string): Promise<void> {
    try {
      await this.reviewApi.releaseReviewTask({ taskId });
    } catch {
      // Intentionally swallowed — see above.
    }
  }

  // ── Bulk actions (REVIEW-FR-098) ─────────────────────────────────────────────────────────

  /**
   * **These are the real bulk endpoints.** An earlier build of this console looped the
   * single-task endpoints because no bulk endpoint existed; `POST /review/tasks/bulk-approve`,
   * `bulk-reject` and `bulk-transfer` now do exist, and the write is one request.
   *
   * All three answer **`200` with per-item results**, not a single pass/fail: `REVIEW-FR-098`
   * makes partial success the normal outcome, so one failed row must never read as a failed
   * run. Everything below therefore records `succeeded`, `failed` and a verdict per task id,
   * and reserves `BulkProgress.problem` for the request itself being refused.
   *
   * **The claim stays per task, and only for approve and reject.** There is no bulk-claim
   * endpoint, and `BulkApproveRequest`/`BulkRejectRequest` items each require the
   * `expectedVersion` the officer holds — which only `claim` returns (`review-task.adapter.ts`
   * explains why the flat task body's `version` may never be used for this). So the shape is:
   * claim each selected task, build one request from the versions those claims returned, send
   * it once. Bulk TRANSFER needs no claim at all, because it operates only on tasks the caller
   * already holds and `BulkTaskItem.expectedVersion` is optional.
   */

  /**
   * `REVIEW-FR-096` — one target for the whole batch, and only tasks the caller already holds.
   *
   * No `expectedVersion` is sent: the caller's claim came from a queue row, and a queue row
   * carries no task version this client is allowed to trust. The field is optional here for
   * exactly that reason, and the server's own claim check is what makes the write safe.
   */
  async bulkTransfer(taskIds: readonly string[], targetOfficerId: string): Promise<void> {
    const items = this.startBulk(taskIds);
    if (items === null) return;
    try {
      this.applyBulkResult(
        await this.reviewApi.bulkTransferReviewTasks({
          body: { targetOfficerId, items: items.map((taskId) => ({ taskId })) },
        }),
      );
    } catch (error) {
      this.failBulk(items, error);
    }
    await this.settleBulk();
  }

  /**
   * `WEB-FR-240` — every item publishes exactly the approval the officer was shown, with the
   * version the claim just returned. `COMMON-CON-003` — `diseaseId` and `remedyIds` come off
   * `QueueApproval` verbatim and `officerNoteBn` is deliberately absent: a bulk run has no
   * officer note, and this console never composes agronomic text of its own.
   */
  async bulkApprove(approvals: readonly QueueApproval[]): Promise<void> {
    const byTask = new Map(approvals.map((approval) => [approval.taskId, approval]));
    const taskIds = this.startBulk([...byTask.keys()]);
    if (taskIds === null) return;

    const versions = await this.claimEach(taskIds);
    const items = [...versions].flatMap(([taskId, expectedVersion]) => {
      const approval = byTask.get(taskId);
      return approval === undefined
        ? []
        : [
            {
              taskId,
              action: ACTION_APPROVED,
              diseaseId: approval.diseaseId,
              remedyIds: [...approval.remedyIds],
              expectedVersion,
            },
          ];
    });

    if (items.length > NO_ITEMS) {
      try {
        this.applyBulkResult(await this.reviewApi.bulkApproveReviewTasks({ body: { items } }));
      } catch (error) {
        this.failBulk(
          items.map((item) => item.taskId),
          error,
        );
      }
    }
    await this.releaseFailedClaims(versions);
    await this.settleBulk();
  }

  /** `WEB-FR-233` — the caller has already required a reason and a Bangla message the officer
      typed. Nothing here writes Bangla. */
  async bulkReject(
    taskIds: readonly string[],
    reasonCode: RejectionReason,
    messageBn: string,
  ): Promise<void> {
    const started = this.startBulk(taskIds);
    if (started === null) return;

    const versions = await this.claimEach(started);
    const items = [...versions].map(([taskId, expectedVersion]) => ({
      taskId,
      reasonCode,
      messageBn,
      expectedVersion,
    }));

    if (items.length > NO_ITEMS) {
      try {
        this.applyBulkResult(await this.reviewApi.bulkRejectReviewTasks({ body: { items } }));
      } catch (error) {
        this.failBulk(
          items.map((item) => item.taskId),
          error,
        );
      }
    }
    await this.releaseFailedClaims(versions);
    await this.settleBulk();
  }

  /**
   * Opens a run, or refuses to. `null` means nothing was started — an empty selection is never
   * sent, and a second run is never stacked on a running one.
   *
   * The slice is the same cap the queue page enforces on the selection itself
   * (`APP_CONFIG.review.bulkMaxSize`, mirroring `foshol.review.bulk.max-size`). Composing a
   * request this client already knows would come back `400 ERR_BULK_TOO_LARGE` is a round trip
   * spent to be told something we could say ourselves. De-duplication is the same argument for
   * `ERR_BULK_DUPLICATE`.
   */
  private startBulk(taskIds: readonly string[]): readonly string[] | null {
    if (this._bulk().running) return null;
    const unique = [...new Set(taskIds)].slice(NO_ITEMS, APP_CONFIG.review.bulkMaxSize);
    if (unique.length === NO_ITEMS) return null;
    this._bulk.set({ ...IDLE_BULK, running: true, total: unique.length });
    return unique;
  }

  /**
   * One claim per task, because there is no bulk-claim endpoint and every approve/reject item
   * must carry the version its claim returned. A task that cannot be claimed never reaches the
   * request and is reported with the server's own code — usually `ERR_TASK_CLAIMED`, meaning
   * another officer got there first, which is a per-row fact and not a failed run.
   */
  private async claimEach(taskIds: readonly string[]): Promise<Map<string, number>> {
    const versions = new Map<string, number>();
    for (const taskId of taskIds) {
      try {
        const task = await this.reviewApi.claimReviewTask({ taskId });
        versions.set(taskId, task.version);
      } catch (error) {
        this.recordOutcomes([{ taskId, ok: false, errorCode: toProblemView(error).code }]);
      }
    }
    return versions;
  }

  /**
   * A claim taken for a bulk item that then failed is handed straight back, for the same reason
   * `releaseQuietly` exists on the single-row path: one failed item must not park a case behind
   * a claim for the full TTL and punish every other officer for it.
   */
  private async releaseFailedClaims(versions: ReadonlyMap<string, number>): Promise<void> {
    const failed = failedIn(this._bulk()).map((outcome) => outcome.taskId);
    for (const taskId of failed) {
      if (versions.has(taskId)) await this.releaseQuietly(taskId);
    }
  }

  private applyBulkResult(result: BulkOperationResult): void {
    this.recordOutcomes(
      result.results.map((item) => ({
        taskId: item.taskId,
        ok: item.status === BULK_OK,
        errorCode: item.errorCode ?? null,
      })),
    );
  }

  /** The request itself was refused, so every item it carried failed for that one reason. */
  private failBulk(taskIds: readonly string[], error: unknown): void {
    const problem = toProblemView(error);
    this._bulk.update((now) => ({ ...now, problem }));
    this.recordOutcomes(
      taskIds.map((taskId) => ({ taskId, ok: false, errorCode: problem.code })),
    );
  }

  private recordOutcomes(outcomes: readonly BulkOutcome[]): void {
    this._bulk.update((now) => ({ ...now, outcomes: [...now.outcomes, ...outcomes] }));
  }

  private async settleBulk(): Promise<void> {
    const finished = this._bulk();
    this._bulk.set({ ...finished, running: false });
    this.announcer.announce('officer.queue.bulk.finished', {
      succeeded: succeededIn(finished).length,
      failed: failedIn(finished).length,
    });
    await this.loadQueue();
  }

  // ── Workspace ────────────────────────────────────────────────────────────────────────────

  async openTask(taskId: string): Promise<void> {
    this.workspace.beginLoad();
    this._casePayload.set(null);
    this._actionProblem.set(null);
    try {
      const detail = await this.composeTask(taskId);
      this.workspace.openTask(detail);
      await this.afterCaseLoaded(detail.case, detail.suggestedDiseaseId ?? null);
    } catch (error) {
      const problem = toProblemView(error);
      this.workspace.failLoad(problem);
      this._casePayload.set(problem);
    }
  }

  /**
   * `WEB-FR-235` / `WEB-FR-242` — a background re-read after a `409`, a claim expiry or an SSE
   * resync. `CaseReviewStore.refresh` replaces only the server-owned halves, so the officer's
   * unsaved editor content survives this call by construction.
   */
  async refreshCase(): Promise<void> {
    const taskId = this.workspace.task()?.taskId ?? this._summary()?.task.taskId;
    if (taskId === undefined || taskId === null) return;
    try {
      this.workspace.refresh(await this.composeTask(taskId));
    } catch (error) {
      this._casePayload.set(toProblemView(error));
    }
  }

  private async composeTask(taskId: string): Promise<ReviewCaseDetail> {
    const summary = adaptReviewTask(await this.reviewApi.getReviewTask({ taskId }), taskId);
    this._summary.set(summary);

    const [caseDetail, analysis] = await Promise.all([
      this.casesApi.getCase({ caseId: summary.caseId }),
      this.analysisApi.getCaseAnalysis({ caseId: summary.caseId }),
    ]);

    return {
      task: summary.task,
      case: caseDetail,
      analysis,
      farmerName: summary.farmerName ?? undefined,
      suggestedDiseaseId: summary.topDiseaseId,
      suggestedRemedies: [...summary.suggestedRemedies],
      priorAdvisory: summary.publishedAdvisory ?? undefined,
    } satisfies ReviewCaseDetail;
  }

  /**
   * `WEB-FR-232` needs the crop's disease list before the officer presses Replace, and
   * `WEB-FR-231` needs the active remedies of whichever disease is currently selected. Both
   * are knowledge-module reads: the AI's candidate list is a suggestion, the knowledge base is
   * authoritative, and the editor is filled from the authoritative one.
   */
  private async afterCaseLoaded(caseDetail: CaseDetail, diseaseId: string | null): Promise<void> {
    const selected = this.workspace.remedyDraft().diseaseId ?? diseaseId;
    await Promise.all([
      this.loadDiseases(caseDetail.cropId),
      selected === null ? Promise.resolve() : this.loadRemedies(selected),
    ]);
  }

  private async loadDiseases(cropId: string): Promise<void> {
    this._diseasesLoading.set(true);
    try {
      this._diseases.set(await this.knowledgeApi.listDiseasesByCrop({ cropId }));
    } catch {
      // A missing disease list disables Replace; it must never blank the case detail, which
      // is the surface the human gate actually depends on.
      this._diseases.set([]);
    } finally {
      this._diseasesLoading.set(false);
    }
  }

  private async loadRemedies(diseaseId: string): Promise<readonly Remedy[]> {
    this._remediesLoading.set(true);
    try {
      const remedies = await this.knowledgeApi.listRemedies({ diseaseId });
      this._remedies.set(remedies);
      return remedies;
    } catch {
      this._remedies.set([]);
      return [];
    } finally {
      this._remediesLoading.set(false);
    }
  }

  /**
   * `WEB-FR-232` — a different disease refills the editor from THAT disease's active remedies.
   * The officer's note is deliberately untouched: they wrote it about this case, not about the
   * disease they just corrected.
   */
  async selectDisease(diseaseId: string): Promise<void> {
    this.workspace.chooseDisease(diseaseId);
    const remedies = await this.loadRemedies(diseaseId);
    this.workspace.setRemedies(remedies.map(remedyId));
  }

  // ── Claim lifecycle ──────────────────────────────────────────────────────────────────────

  /** `WEB-FR-240` — no action control is enabled until this succeeds. */
  async claim(): Promise<void> {
    const taskId = this.workspace.task()?.taskId;
    if (taskId === undefined || this._claimPending()) return;

    this._claimPending.set(true);
    this._actionProblem.set(null);
    try {
      this.workspace.applyTask(await this.reviewApi.claimReviewTask({ taskId }));
      this.announcer.announce('officer.live.claimed');
    } catch (error) {
      const problem = toProblemView(error);
      this._actionProblem.set(problem);
      // WEB-FR-243 — a 409 on a re-claim means somebody else has it now. The editor keeps
      // every word the officer typed; only the ability to submit is withdrawn.
      if (problem.status === HTTP_STATUS.conflict) {
        this.workspace.markReadOnly();
        await this.refreshCase();
      }
    } finally {
      this._claimPending.set(false);
    }
  }

  /**
   * **Divergence, verified against the running server:** the frozen contract types `release`
   * as `200` with a `ReviewTask`, but the live endpoint answers **`204` with no body**. So
   * there is nothing to adopt, and adopting the `null` the generated client hands back would
   * blank the task and leave the officer unable to re-claim the case they just released.
   * The released state is re-read instead (`WEB-NFR-001` — the server's value, not a guess).
   */
  async release(): Promise<void> {
    const taskId = this.workspace.task()?.taskId;
    if (taskId === undefined || this._claimPending()) return;

    this._claimPending.set(true);
    try {
      await this.reviewApi.releaseReviewTask({ taskId });
      await this.refreshCase();
      this.announcer.announce('officer.live.released');
    } catch (error) {
      this._actionProblem.set(toProblemView(error));
    } finally {
      this._claimPending.set(false);
    }
  }

  // ── Same-district transfer (REVIEW-FR-096 / REVIEW-FR-097) ───────────────────────────────

  /**
   * `REVIEW-FR-097` — who may receive a transfer, answered by the server.
   *
   * Cached for the session because a district's officer roster does not change while an officer
   * works a queue, and re-reading it every time a panel opens would be a request per keystroke
   * of hesitation. `force` is the retry control's way back in.
   */
  async loadColleagues(force = false): Promise<void> {
    if (this._colleaguesLoading()) return;
    if (!force && this._colleagues().length > NO_ITEMS) return;
    this._colleaguesLoading.set(true);
    this._colleaguesProblem.set(null);
    try {
      this._colleagues.set(await this.reviewApi.listDistrictOfficers());
    } catch (error) {
      this._colleagues.set([]);
      this._colleaguesProblem.set(toProblemView(error));
    } finally {
      this._colleaguesLoading.set(false);
    }
  }

  /**
   * `REVIEW-FR-096` — move a LIVE claim to a colleague in the same district.
   *
   * The caller must be holding the claim; `workspace.canAct()` is that check, and it is the
   * server's `state`/`officerId` being read rather than a rule re-implemented here
   * (`WEB-NFR-001`). `PENDING` is a shared pool and is never assigned from this console, no
   * cross-district target is ever offered, and a decided task offers no transfer control at all
   * — the server still refuses each of those, and its `errorCode` is what the officer reads.
   *
   * `expectedVersion` is the version the held `ReviewTask` carries — the one `claim` returned.
   * When this session never claimed (a reload while already holding the case) the adapter has
   * only `UNKNOWN_TASK_VERSION` to offer, and the field is then omitted rather than filled with
   * a number that would fail the lock for the wrong reason. It is optional for that case.
   *
   * `WEB-FR-234` — a successful transfer is a terminal act for this officer, so it ends the same
   * way approve and reject do: back to the queue, reloaded.
   */
  async transfer(targetOfficerId: string): Promise<boolean> {
    const task = this.workspace.task();
    if (task === null || !this.workspace.canAct() || this._actionPending()) return false;

    this._actionPending.set(true);
    this._transferProblem.set(null);
    try {
      await this.reviewApi.transferReviewTask({
        taskId: task.taskId,
        body:
          task.version === UNKNOWN_TASK_VERSION
            ? { targetOfficerId }
            : { targetOfficerId, expectedVersion: task.version },
      });
      await this.finish('officer.transfer.done', { case: task.caseId });
      return true;
    } catch (error) {
      const problem = toProblemView(error);
      this._transferProblem.set(problem);
      // WEB-FR-235 — a 409 means the claim state moved under us; re-read rather than retry.
      if (problem.status === HTTP_STATUS.conflict) await this.refreshCase();
      return false;
    } finally {
      this._actionPending.set(false);
    }
  }

  /** Closing the transfer panel puts its failure away with it. */
  clearTransferProblem(): void {
    this._transferProblem.set(null);
  }

  // ── The four terminal actions (WEB-FR-230) ───────────────────────────────────────────────

  /**
   * `WEB-NFR-001` — `action` is sent because the generated request type requires it, but the
   * SERVER derives the real value (`LIVE-API-NOTES.md`: sending `APPROVED` came back
   * `EDITED`). The confirmation therefore names `advisory.action` as returned, never the value
   * posted here.
   */
  async publish(action: PublishAction): Promise<boolean> {
    const task = this.workspace.task();
    const draft = this.workspace.remedyDraft();
    if (task === null || draft.diseaseId === null || !this.workspace.canAct()) return false;
    if (this._actionPending()) return false;

    this._actionPending.set(true);
    this._actionProblem.set(null);
    try {
      const advisory = await this.reviewApi.publishAdvisory({
        taskId: task.taskId,
        body: {
          action,
          diseaseId: draft.diseaseId,
          remedyIds: [...draft.remedyIds],
          officerNoteBn: draft.officerNoteBn,
          expectedVersion: task.version,
        },
      });
      await this.finish('officer.action.published', {
        case: advisory.caseId,
        action: advisory.action,
      });
      return true;
    } catch (error) {
      await this.failAction(error);
      return false;
    } finally {
      this._actionPending.set(false);
    }
  }

  /** `WEB-FR-233` — the caller has already required both a reason and a Bangla message. */
  async reject(reasonCode: RejectionReason, messageBn: string): Promise<boolean> {
    const task = this.workspace.task();
    if (task === null || !this.workspace.canAct() || this._actionPending()) return false;

    this._actionPending.set(true);
    this._actionProblem.set(null);
    try {
      const rejection = await this.reviewApi.rejectCase({
        taskId: task.taskId,
        body: { reasonCode, messageBn, expectedVersion: task.version },
      });
      await this.finish('officer.action.rejected', { case: rejection.caseId });
      return true;
    } catch (error) {
      await this.failAction(error);
      return false;
    } finally {
      this._actionPending.set(false);
    }
  }

  /** `WEB-FR-234` — back to the queue, with a confirmation that names the case. */
  private async finish(key: string, params: Record<string, string>): Promise<void> {
    this.toasts.show({ kind: TOAST_SUCCESS, titleKey: key });
    this.announcer.announce(key, params);
    this.workspace.clearCase();
    this._summary.set(null);
    this._remedies.set([]);
    await this.router.navigateByUrl(OFFICER_PATHS.queue);
    await this.loadQueue();
  }

  /**
   * `WEB-FR-235` / `WEB-FR-244` — a `409` shows a state-conflict message and refreshes the
   * case. It does NOT retry, and it does not clear the draft: `refreshCase` replaces only what
   * the server owns.
   */
  private async failAction(error: unknown): Promise<void> {
    const problem = toProblemView(error);
    this._actionProblem.set(problem);
    if (problem.status === HTTP_STATUS.conflict) await this.refreshCase();
  }

  /** Leaving the workspace: the draft goes with the case it belonged to. */
  closeCase(): void {
    this.workspace.clearCase();
    this._summary.set(null);
    this._remedies.set([]);
    this._diseases.set([]);
    this._actionProblem.set(null);
    this._casePayload.set(null);
  }
}
