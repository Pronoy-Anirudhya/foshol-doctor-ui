import { computed, inject, Injectable, signal } from '@angular/core';
import type { AnalysisDetail } from '../../generated/models/analysis-detail';
import type { Candidate } from '../../generated/models/candidate';
import type { CaseDetail } from '../../generated/models/case-detail';
import type { ExtractedSymptom } from '../../generated/models/extracted-symptom';
import type { Remedy } from '../../generated/models/remedy';
import type { ReviewCaseDetail } from '../../generated/models/review-case-detail';
import type { ReviewTask } from '../../generated/models/review-task';
import { SessionStore } from '../auth/session-store';
import { msUntil } from '../time/dhaka-time';

/**
 * The officer's case workspace.
 *
 * **The invariant this store exists to protect** (`WEB-FR-235`, `WEB-FR-242`, `WEB-FR-243`):
 * `remedyDraft` is never discarded by a background refresh. An officer's typing must survive a
 * claim expiring, a `409` from the server, and a re-fetch of the task. Every one of those three
 * arrives as a *background* event the officer did not ask for, and throwing away their words at
 * that moment is the worst available response — so `refresh()` replaces the server-owned halves
 * (`task`, `analysis`, `case`) and provably does not touch the draft. Only `resetDraft()` and
 * `clearSession()` clear it, and both are explicit.
 */
export type ClaimState = 'NONE' | 'HELD_BY_ME' | 'HELD_BY_OTHER' | 'EXPIRED';

export const CLAIM_NONE: ClaimState = 'NONE';
export const CLAIM_HELD_BY_ME: ClaimState = 'HELD_BY_ME';
export const CLAIM_HELD_BY_OTHER: ClaimState = 'HELD_BY_OTHER';
export const CLAIM_EXPIRED: ClaimState = 'EXPIRED';

const TASK_CLAIMED = 'CLAIMED';

export interface RemedyDraft {
  readonly diseaseId: string | null;
  readonly remedyIds: readonly string[];
  readonly officerNoteBn: string;
  /** True once the officer has changed anything: a prefill must never overwrite their edits. */
  readonly dirty: boolean;
}

const EMPTY_DRAFT: RemedyDraft = { diseaseId: null, remedyIds: [], officerNoteBn: '', dirty: false };

@Injectable({ providedIn: 'root' })
export class CaseReviewStore {
  private readonly session = inject(SessionStore);

  private readonly _task = signal<ReviewTask | null>(null);
  private readonly _case = signal<CaseDetail | null>(null);
  private readonly _analysis = signal<AnalysisDetail | null>(null);
  private readonly _suggestedRemedies = signal<readonly Remedy[]>([]);
  private readonly _officerSymptomIds = signal<readonly string[]>([]);
  private readonly _remedyDraft = signal<RemedyDraft>(EMPTY_DRAFT);
  private readonly _loading = signal(false);
  private readonly _error = signal<unknown>(null);
  /**
   * WEB-FR-243 — set when a re-claim failed because another officer now holds the case. The
   * editor stays populated and visible; only submission is withdrawn.
   */
  private readonly _readOnly = signal(false);
  /**
   * The claim countdown's clock. A store owning its own interval would be a timer nobody can
   * stop in a test; the console's claim timer calls `tick()` (WEB-FR-241).
   */
  private readonly _now = signal(Date.now());

  readonly task = this._task.asReadonly();
  readonly case = this._case.asReadonly();
  readonly analysis = this._analysis.asReadonly();
  readonly suggestedRemedies = this._suggestedRemedies.asReadonly();
  readonly officerSymptomIds = this._officerSymptomIds.asReadonly();
  readonly remedyDraft = this._remedyDraft.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly readOnly = this._readOnly.asReadonly();
  readonly now = this._now.asReadonly();

  readonly candidates = computed<readonly Candidate[]>(() => this._analysis()?.candidates ?? []);
  readonly symptoms = computed<readonly ExtractedSymptom[]>(() => this._analysis()?.symptoms ?? []);
  /** WEB-NFR-011 — the two routing thresholds come from the analysis payload, never a constant. */
  readonly thresholds = computed(() => this._analysis()?.thresholds ?? null);

  /** Milliseconds of claim left; `null` when nothing is claimed, never negative. */
  readonly claimRemainingMs = computed<number | null>(() => {
    const expiresAt = this._task()?.claimExpiresAt;
    if (expiresAt === null || expiresAt === undefined) return null;
    return Math.max(0, msUntil(expiresAt, this._now()));
  });

  readonly claimState = computed<ClaimState>(() => {
    const task = this._task();
    if (task === null || task.state !== TASK_CLAIMED || !task.officerId) return CLAIM_NONE;
    // Another officer's claim reads as theirs whether or not it has run out: either way this
    // officer may not act, and "expired" would wrongly suggest the case is theirs to re-take.
    if (task.officerId !== this.session.subjectId()) return CLAIM_HELD_BY_OTHER;
    const remaining = this.claimRemainingMs();
    return remaining !== null && remaining <= 0 ? CLAIM_EXPIRED : CLAIM_HELD_BY_ME;
  });

  /** WEB-FR-240 — the four actions are enabled only while this officer holds a live claim. */
  readonly canAct = computed(() => !this._readOnly() && this.claimState() === CLAIM_HELD_BY_ME);

  beginLoad(): void {
    this._loading.set(true);
    this._error.set(null);
  }

  failLoad(error: unknown): void {
    this._loading.set(false);
    this._error.set(error);
  }

  /**
   * A fresh open of a task. Prefills the editor from `suggestedDiseaseId` +
   * `suggestedRemedies` — but only when the draft is not already dirty, so navigating away and
   * back does not silently revert the officer's choices to the model's suggestion.
   */
  openTask(detail: ReviewCaseDetail, at: number = Date.now()): void {
    const changedCase = this._task()?.taskId !== detail.task.taskId;
    if (changedCase) {
      this._remedyDraft.set(EMPTY_DRAFT);
      this._officerSymptomIds.set([]);
      this._readOnly.set(false);
    }
    this.#adoptServerState(detail, at);
    if (!this._remedyDraft().dirty) this.#prefill(detail);
  }

  /**
   * WEB-FR-235 / WEB-FR-242 — a background re-read after a `409`, a claim expiry or an SSE
   * nudge. It replaces only what the server owns. `_remedyDraft` is not mentioned in this
   * method, and that omission is the requirement.
   */
  refresh(detail: ReviewCaseDetail, at: number = Date.now()): void {
    this.#adoptServerState(detail, at);
  }

  /** The task alone, as returned by claim / release. Again, the draft is untouched. */
  applyTask(task: ReviewTask): void {
    this._task.set(task);
  }

  /** WEB-FR-243 — another officer holds it now: keep the text, withdraw the submit. */
  markReadOnly(): void {
    this._readOnly.set(true);
  }

  /** WEB-FR-241 — driven by the console's claim timer, one signal write per tick. */
  tick(now: number = Date.now()): void {
    this._now.set(now);
  }

  chooseDisease(diseaseId: string | null): void {
    this._remedyDraft.update((draft) => ({ ...draft, diseaseId, dirty: true }));
  }

  toggleRemedy(remedyId: string): void {
    this._remedyDraft.update((draft) => {
      const selected = draft.remedyIds.includes(remedyId);
      const remedyIds = selected
        ? draft.remedyIds.filter((id) => id !== remedyId)
        : [...draft.remedyIds, remedyId];
      return { ...draft, remedyIds, dirty: true };
    });
  }

  setRemedies(remedyIds: readonly string[]): void {
    this._remedyDraft.update((draft) => ({ ...draft, remedyIds: [...remedyIds], dirty: true }));
  }

  setOfficerNote(officerNoteBn: string): void {
    this._remedyDraft.update((draft) => ({ ...draft, officerNoteBn, dirty: true }));
  }

  setOfficerSymptoms(symptomIds: readonly string[]): void {
    this._officerSymptomIds.set([...symptomIds]);
  }

  /** Explicit only — the officer asking to start over, never a background event. */
  resetDraft(): void {
    this._remedyDraft.set(EMPTY_DRAFT);
  }

  /** After a successful publish: the workspace is finished with. */
  clearCase(): void {
    this._task.set(null);
    this._case.set(null);
    this._analysis.set(null);
    this._suggestedRemedies.set([]);
    this._officerSymptomIds.set([]);
    this._remedyDraft.set(EMPTY_DRAFT);
    this._readOnly.set(false);
    this._error.set(null);
    this._loading.set(false);
  }

  /** WEB-SEC-004 — sign-out discards the workspace, draft included. */
  clearSession(): void {
    this.clearCase();
  }

  #adoptServerState(detail: ReviewCaseDetail, at: number): void {
    this._task.set(detail.task);
    this._case.set(detail.case);
    this._analysis.set(detail.analysis);
    this._suggestedRemedies.set([...detail.suggestedRemedies]);
    this._loading.set(false);
    this._error.set(null);
    this._now.set(at);
  }

  #prefill(detail: ReviewCaseDetail): void {
    this._remedyDraft.set({
      diseaseId: detail.suggestedDiseaseId ?? null,
      remedyIds: detail.suggestedRemedies.map((remedy) => remedy.id),
      officerNoteBn: '',
      dirty: false,
    });
  }
}
