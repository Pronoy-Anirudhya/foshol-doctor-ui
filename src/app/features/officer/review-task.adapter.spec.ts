import type { ReviewCaseDetail } from '../../generated/models/review-case-detail';
import liveShape from '../../../testing/fixtures/review-task-live-shape.json';
import { adaptReviewTask, remedyId, UNKNOWN_TASK_VERSION } from './review-task.adapter';

/**
 * `DEVIATIONS.md` D-05. The fixture is the FLAT body the running server actually sends, so
 * this suite fails the moment someone builds the workspace out of the contract shape again.
 */
const TASK_ID = '01a07ca3-bbd0-73b6-b530-dfa384487234';
const flat = liveShape as unknown as ReviewCaseDetail;

describe('adaptReviewTask (D-05)', () => {
  it('reads the three fields that live nowhere else', () => {
    const summary = adaptReviewTask(flat, TASK_ID);

    expect(summary.topDiseaseId).toBe('01800000-0000-7000-8000-000000000103');
    expect(summary.suggestedRemedies.length).toBeGreaterThan(0);
    expect(summary.publishedAdvisory).toBeNull();
  });

  it('normalises `remedyId` to `id`, so nothing downstream has to know (D-07)', () => {
    const [first] = adaptReviewTask(flat, TASK_ID).suggestedRemedies;

    expect(first.id).toBe('01800000-0000-7000-8000-000000000507');
    expect(remedyId(first)).toBe(first.id);
  });

  it('reads `id` too, for the same object arriving from /diseases/{id}/remedies (D-07)', () => {
    expect(remedyId({ id: 'r-1' } as never)).toBe('r-1');
    expect(remedyId({ remedyId: 'r-2' } as never)).toBe('r-2');
  });

  it('never presents the flat body’s `version` as an optimistic lock', () => {
    // The live server reported 2 here where `claim` reported 0 for the same task. Using it as
    // expectedVersion would corrupt every write, so it is refused rather than trusted.
    expect(adaptReviewTask(flat, TASK_ID).task.version).toBe(UNKNOWN_TASK_VERSION);
  });

  it('maps `claimedBy` onto the task’s claimant, which the flat body spells differently', () => {
    const claimed = { ...liveShape, state: 'CLAIMED', claimedBy: 'officer-7' };

    const summary = adaptReviewTask(claimed as unknown as ReviewCaseDetail, TASK_ID);

    expect(summary.task.state).toBe('CLAIMED');
    expect(summary.task.officerId).toBe('officer-7');
  });

  it('survives a body that is missing everything, rather than failing the workspace', () => {
    const summary = adaptReviewTask({} as unknown as ReviewCaseDetail, TASK_ID);

    expect(summary.task.taskId).toBe(TASK_ID);
    expect(summary.task.state).toBe('PENDING');
    expect(summary.suggestedRemedies).toEqual([]);
    expect(summary.topDiseaseId).toBeNull();
  });
});
