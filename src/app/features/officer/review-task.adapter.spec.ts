import type { ReviewCaseDetail } from '../../generated/models/review-case-detail';
import liveShape from '../../../testing/fixtures/review-task-live-shape.json';
import {
  adaptReviewTask,
  gradcamPresent,
  remedyId,
  UNKNOWN_TASK_VERSION,
} from './review-task.adapter';

/**
 * `DEVIATIONS.md` D-05. The fixture is the FLAT body the running server actually sends, so
 * this suite fails the moment someone builds the workspace out of the contract shape again.
 */
const TASK_ID = '01a07ca3-bbd0-73b6-b530-dfa384487234';
const flat = liveShape as unknown as ReviewCaseDetail;

const body = (fields: object): ReviewCaseDetail => fields as unknown as ReviewCaseDetail;

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
    expect(summary.gradcamPresent).toBe(false);
    expect(summary.images).toBeNull();
  });
});

/** WEB-FR-211 / WEB-FR-212 — first true wins, and the object key is a flag, never a value. */
describe('gradcamPresent (D-38)', () => {
  it('reads the nested analysis flag', () => {
    expect(gradcamPresent(body({ analysis: { hasGradcam: true } }))).toBe(true);
  });

  it('falls back to the top-level flag', () => {
    expect(gradcamPresent(body({ analysis: { hasGradcam: false }, hasGradcam: true }))).toBe(true);
  });

  it('falls back to a non-null object key, read as a flag only', () => {
    expect(gradcamPresent(body({ gradcamObjectKey: 'cases/c-1/gradcam/g-1.png' }))).toBe(true);
    expect(adaptReviewTask(body({ gradcamObjectKey: 'cases/c-1/gradcam/g-1.png' }), TASK_ID)).not.toHaveProperty('gradcamObjectKey');
  });

  it('says no overlay when none of the three says yes', () => {
    expect(
      gradcamPresent(
        body({ analysis: { hasGradcam: false }, hasGradcam: false, gradcamObjectKey: null }),
      ),
    ).toBe(false);
    expect(gradcamPresent(body({ gradcamObjectKey: '' }))).toBe(false);
  });
});

describe('case images from the task detail (D-38)', () => {
  const primary = { imageId: 'i-1', position: 0, primary: true, qualityScore: 0.91 };
  const second = { imageId: 'i-2', position: 1, primary: false };

  it('prefers the nested case.images over the flat alias', () => {
    const summary = adaptReviewTask(
      body({ case: { images: [primary, second] }, images: [second] }),
      TASK_ID,
    );

    expect(summary.images?.map((image) => image.imageId)).toEqual(['i-1', 'i-2']);
    expect(summary.images?.[0].qualityScore).toBe(0.91);
  });

  it('uses the flat alias when the nested list is absent', () => {
    expect(adaptReviewTask(body({ images: [primary] }), TASK_ID).images?.length).toBe(1);
  });

  it('refuses a malformed list outright rather than showing part of it', () => {
    const summary = adaptReviewTask(body({ case: { images: [primary, { imageId: 7 }] } }), TASK_ID);

    expect(summary.images).toBeNull();
  });
});
