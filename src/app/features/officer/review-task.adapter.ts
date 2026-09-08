import type { Advisory } from '../../generated/models/advisory';
import type { Remedy } from '../../generated/models/remedy';
import type { ReviewCaseDetail } from '../../generated/models/review-case-detail';
import type { ReviewTask } from '../../generated/models/review-task';

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════
 *  THE ONE ADAPTER — `DEVIATIONS.md` D-05.
 * ══════════════════════════════════════════════════════════════════════════════════════════
 *
 * `GET /review/tasks/{taskId}` is typed by the frozen contract as the nested
 * `{task, case, analysis, farmerName, suggestedDiseaseId, suggestedRemedies, priorAdvisory}`.
 * The running server returns **one flat object** instead (full field list in
 * `LIVE-API-NOTES.md`). The generated client therefore hands us a `ReviewCaseDetail` whose
 * fields are all `undefined` at runtime, and TypeScript cannot see that it is lying.
 *
 * So this file — and only this file — casts the generated response through `unknown` and reads
 * the body the server actually sends. Everything else in the officer console is composed from
 * endpoints that DO match the contract (`GET /cases/{caseId}`, `GET /cases/{caseId}/analysis`,
 * and the `ReviewTask` returned by `claim`), which is why this adapter is small: it exists for
 * `suggestedRemedies`, `topDiseaseId` and `publishedAdvisory`, which live nowhere else.
 *
 * The call itself still goes through the **generated** client, so no URL is hand-written and
 * `WEB-API-001` holds.
 *
 * **Unblock:** reconcile the backend response with the frozen schema, or update the schema
 * (owner: A1). Then delete this file and read `ReviewCaseDetail` directly.
 */

/** The flat body, as observed. Every field optional: this is untrusted shape, not a contract. */
interface FlatReviewTaskBody {
  caseId?: unknown;
  reviewTaskId?: unknown;
  farmerName?: unknown;
  state?: unknown;
  officerId?: unknown;
  /** The claimant. The flat body uses this name; `ReviewTask` calls it `officerId`. */
  claimedBy?: unknown;
  claimExpiresAt?: unknown;
  claimedAt?: unknown;
  slaDueAt?: unknown;
  requeueCount?: unknown;
  isResubmission?: unknown;
  topDiseaseId?: unknown;
  suggestedRemedies?: unknown;
  publishedAdvisory?: unknown;
  version?: unknown;
}

const TASK_STATES: readonly string[] = ['PENDING', 'CLAIMED', 'DONE', 'REJECTED'];
const DEFAULT_STATE: ReviewTask['state'] = 'PENDING';

/**
 * The flat body's `version` is NOT `ReviewTask.version`: it reported `2` where `claim`
 * reported `0` on the same task (`LIVE-API-NOTES.md`). Optimistic locking must therefore never
 * use it, so the provisional task carries this instead of a number that looks authoritative.
 * A real version arrives with the `ReviewTask` that `claim` returns, and every write is gated
 * on holding a claim anyway (`WEB-FR-240`).
 */
export const UNKNOWN_TASK_VERSION = -1;

export interface ReviewTaskSummary {
  /**
   * A provisional `ReviewTask` for rendering claim state before the officer claims. Its
   * `version` is `UNKNOWN_TASK_VERSION` — see above.
   */
  readonly task: ReviewTask;
  readonly caseId: string;
  readonly farmerName: string | null;
  readonly isResubmission: boolean;
  /** The disease the model put first — the editor's prefill (`WEB-FR-231`). */
  readonly topDiseaseId: string | null;
  /** Active remedies for `topDiseaseId`, keyed `remedyId` on the wire (D-07). */
  readonly suggestedRemedies: readonly Remedy[];
  /** Set on a re-submission whose parent already produced an advisory. */
  readonly publishedAdvisory: Advisory | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

const readBoolean = (value: unknown): boolean => value === true;

const readNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * D-07 — the same remedy object arrives keyed `id` from `GET /diseases/{id}/remedies` and
 * keyed `remedyId` when nested here. Normalising to `id` at the boundary means nothing
 * downstream has to know, and `remedyId(...)` below is the single reader for the rest.
 */
function normaliseRemedy(value: unknown): Remedy | null {
  if (!isRecord(value)) return null;
  const identity = readString(value['id']) ?? readString(value['remedyId']);
  if (identity === null) return null;
  return { ...(value as unknown as Remedy), id: identity };
}

/** D-07 — read a remedy's identity from either spelling, wherever it came from. */
export function remedyId(remedy: Remedy): string {
  const loose = remedy as unknown as Record<string, unknown>;
  return readString(loose['id']) ?? readString(loose['remedyId']) ?? '';
}

/**
 * Maps the flat body onto the pieces the console cannot get anywhere else.
 *
 * `taskId` falls back to the id we asked for, because a body that omits it is still a body
 * whose `suggestedRemedies` we want; failing the whole workspace over a missing echo would be
 * a worse answer than rendering the case.
 */
export function adaptReviewTask(response: ReviewCaseDetail, taskId: string): ReviewTaskSummary {
  const body = response as unknown as FlatReviewTaskBody;

  const stateValue = readString(body.state);
  const state = (
    stateValue !== null && TASK_STATES.includes(stateValue) ? stateValue : DEFAULT_STATE
  ) as ReviewTask['state'];

  const caseId = readString(body.caseId) ?? '';
  const remedies = Array.isArray(body.suggestedRemedies)
    ? body.suggestedRemedies.map(normaliseRemedy).filter((r): r is Remedy => r !== null)
    : [];

  const task: ReviewTask = {
    taskId: readString(body.reviewTaskId) ?? taskId,
    caseId,
    state,
    officerId: readString(body.claimedBy) ?? readString(body.officerId),
    claimedAt: readString(body.claimedAt),
    claimExpiresAt: readString(body.claimExpiresAt),
    slaDueAt: readString(body.slaDueAt) ?? '',
    requeueCount: readNumber(body.requeueCount) ?? 0,
    version: UNKNOWN_TASK_VERSION,
  };

  return {
    task,
    caseId,
    farmerName: readString(body.farmerName),
    isResubmission: readBoolean(body.isResubmission),
    topDiseaseId: readString(body.topDiseaseId),
    suggestedRemedies: remedies,
    publishedAdvisory: isRecord(body.publishedAdvisory)
      ? (body.publishedAdvisory as unknown as Advisory)
      : null,
  };
}
