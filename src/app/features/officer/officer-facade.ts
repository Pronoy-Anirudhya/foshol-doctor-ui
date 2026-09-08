import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { APP_CONFIG } from '../../core/config/app-config';
import { HTTP_STATUS, toProblemView, type ProblemView } from '../../core/errors/problem';
import { CaseReviewStore } from '../../core/stores/case-review-store';
import { LiveAnnouncer } from '../../core/stores/live-announcer';
import { QueueStore } from '../../core/stores/queue-store';
import { TOAST_SUCCESS, ToastStore } from '../../core/stores/toast-store';
import type { CaseDetail } from '../../generated/models/case-detail';
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
import { adaptReviewTask, remedyId, type ReviewTaskSummary } from './review-task.adapter';

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

/** Shared empty result, so a case with no computed dose does not churn a new Map each read. */
const EMPTY_DOSES: ReadonlyMap<string, ComputedDose> = new Map();

export type PublishAction = PublishAdvisoryRequest['action'];

export const ACTION_APPROVED: PublishAction = 'APPROVED';
export const ACTION_EDITED: PublishAction = 'EDITED';
export const ACTION_REPLACED: PublishAction = 'REPLACED';

export type RejectionReason = RejectCaseRequest['reasonCode'];

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
