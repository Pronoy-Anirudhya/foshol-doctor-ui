import { TestBed } from '@angular/core/testing';
import type { AnalysisDetail } from '../../generated/models/analysis-detail';
import type { CaseDetail } from '../../generated/models/case-detail';
import type { Principal } from '../../generated/models/principal';
import type { Remedy } from '../../generated/models/remedy';
import type { ReviewCaseDetail } from '../../generated/models/review-case-detail';
import type { ReviewTask } from '../../generated/models/review-task';
import { SessionStore } from '../auth/session-store';
import { APP_CONFIG } from '../config/app-config';
import {
  CaseReviewStore,
  CLAIM_EXPIRED,
  CLAIM_HELD_BY_ME,
  CLAIM_HELD_BY_OTHER,
  CLAIM_NONE,
} from './case-review-store';

const ME = 'officer-me';
const OTHER = 'officer-other';
const NOW = Date.parse('2026-09-07T16:00:00.000Z');

const OFFICER: Principal = { id: ME, name: 'Demo Officer', role: 'OFFICER' };

const analysis: AnalysisDetail = {
  caseId: 'c-1',
  decisionPath: 'PRIMARY',
  mode: 'REPLAY',
  candidates: [
    { diseaseId: 'd-1', diseaseCode: 'blast', diseaseNameBn: 'Blast', confidence: 0.88, rank: 1, source: 'MODEL' },
  ],
  symptoms: [],
  thresholds: { high: 0.75, low: 0.45 },
};

const caseDetail: CaseDetail = {
  caseId: 'c-1',
  cropId: 'crop-1',
  status: 'IN_REVIEW',
  images: [],
  submittedAt: '2026-09-07T15:00:00.000Z',
};

const remedy = (id: string): Remedy => ({
  id,
  diseaseId: 'd-1',
  titleBn: 'Placeholder',
  stepsBn: [],
  sourceRef: 'demo',
  type: 'CULTURAL',
});

function task(overrides: Partial<ReviewTask> = {}): ReviewTask {
  return {
    taskId: 'task-1',
    caseId: 'c-1',
    state: 'PENDING',
    slaDueAt: '2026-09-07T20:00:00.000Z',
    version: 0,
    ...overrides,
  };
}

function detail(overrides: Partial<ReviewCaseDetail> = {}): ReviewCaseDetail {
  return {
    task: task(),
    case: caseDetail,
    analysis,
    suggestedDiseaseId: 'd-1',
    suggestedRemedies: [remedy('r-1'), remedy('r-2')],
    ...overrides,
  };
}

function setup(): { store: CaseReviewStore; session: SessionStore } {
  TestBed.configureTestingModule({});
  const session = TestBed.inject(SessionStore);
  session.signIn('a.b.c', OFFICER, new Date(NOW + APP_CONFIG.auth.jwtTtlMs));
  return { store: TestBed.inject(CaseReviewStore), session };
}

const claimedByMe = (msLeft: number): ReviewTask =>
  task({
    state: 'CLAIMED',
    officerId: ME,
    officerName: 'Demo Officer',
    claimedAt: new Date(NOW).toISOString(),
    claimExpiresAt: new Date(NOW + msLeft).toISOString(),
  });

describe('CaseReviewStore', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('prefills the editor from the server suggestion on a fresh open', () => {
    const { store } = setup();
    store.openTask(detail(), NOW);

    expect(store.remedyDraft().diseaseId).toBe('d-1');
    expect(store.remedyDraft().remedyIds).toEqual(['r-1', 'r-2']);
    expect(store.remedyDraft().dirty).toBe(false);
    expect(store.candidates()).toHaveLength(1);
    expect(store.thresholds()).toEqual({ high: 0.75, low: 0.45 });
  });

  // WEB-FR-235 / WEB-FR-242 / WEB-FR-243 / WEB-TEST-004 — the officer's typing survives.
  it('never discards remedyDraft on a background refresh', () => {
    const { store } = setup();
    store.openTask(detail(), NOW);

    store.chooseDisease('d-other');
    store.setRemedies(['r-9']);
    store.setOfficerNote('আমার নিজের পর্যবেক্ষণ');

    store.refresh(detail({ task: claimedByMe(APP_CONFIG.review.claimTtlMs) }), NOW);

    expect(store.remedyDraft().diseaseId).toBe('d-other');
    expect(store.remedyDraft().remedyIds).toEqual(['r-9']);
    expect(store.remedyDraft().officerNoteBn).toBe('আমার নিজের পর্যবেক্ষণ');
    // The server-owned half was replaced, so the refresh did happen.
    expect(store.task()?.state).toBe('CLAIMED');
  });

  it('does not re-prefill over a dirty draft when the same task is reopened', () => {
    const { store } = setup();
    store.openTask(detail(), NOW);
    store.setRemedies(['r-9']);

    store.openTask(detail(), NOW);

    expect(store.remedyDraft().remedyIds).toEqual(['r-9']);
  });

  it('starts a genuinely different task from the server suggestion', () => {
    const { store } = setup();
    store.openTask(detail(), NOW);
    store.setRemedies(['r-9']);

    store.openTask(detail({ task: task({ taskId: 'task-2' }), suggestedRemedies: [remedy('r-5')] }), NOW);

    expect(store.remedyDraft().remedyIds).toEqual(['r-5']);
    expect(store.remedyDraft().dirty).toBe(false);
  });

  // AC-14 — the claim expiry transition.
  it('moves from HELD_BY_ME to EXPIRED as the claim runs out, keeping the edits', () => {
    const { store } = setup();
    store.openTask(detail({ task: claimedByMe(APP_CONFIG.review.claimTtlMs) }), NOW);
    store.setOfficerNote('অসম্পূর্ণ টাইপিং');

    expect(store.claimState()).toBe(CLAIM_HELD_BY_ME);
    expect(store.claimRemainingMs()).toBe(APP_CONFIG.review.claimTtlMs);
    expect(store.canAct()).toBe(true);

    store.tick(NOW + APP_CONFIG.review.claimTtlMs);

    expect(store.claimState()).toBe(CLAIM_EXPIRED);
    expect(store.claimRemainingMs()).toBe(0);
    expect(store.canAct()).toBe(false);
    expect(store.remedyDraft().officerNoteBn).toBe('অসম্পূর্ণ টাইপিং');
  });

  it('never reports a negative remaining claim time', () => {
    const { store } = setup();
    store.openTask(detail({ task: claimedByMe(APP_CONFIG.review.claimTtlMs) }), NOW);
    store.tick(NOW + APP_CONFIG.review.claimTtlMs * 2);
    expect(store.claimRemainingMs()).toBe(0);
  });

  it('reports a claim held by another officer as theirs, not as expired', () => {
    const { store } = setup();
    store.openTask(
      detail({ task: task({ ...claimedByMe(APP_CONFIG.review.claimTtlMs), officerId: OTHER }) }),
      NOW,
    );

    expect(store.claimState()).toBe(CLAIM_HELD_BY_OTHER);
    store.tick(NOW + APP_CONFIG.review.claimTtlMs * 2);
    expect(store.claimState()).toBe(CLAIM_HELD_BY_OTHER);
    expect(store.canAct()).toBe(false);
  });

  it('reports NONE while the task is unclaimed', () => {
    const { store } = setup();
    store.openTask(detail(), NOW);

    expect(store.claimState()).toBe(CLAIM_NONE);
    expect(store.claimRemainingMs()).toBeNull();
    expect(store.canAct()).toBe(false);
  });

  // AC-15 — a failed re-claim makes the case read-only, and the text stays visible.
  it('keeps the unsaved text when a re-claim fails and the case goes read-only', () => {
    const { store } = setup();
    store.openTask(detail({ task: claimedByMe(APP_CONFIG.review.claimTtlMs) }), NOW);
    store.setOfficerNote('এখনও পাঠানো হয়নি');

    store.markReadOnly();
    store.applyTask(task({ ...claimedByMe(APP_CONFIG.review.claimTtlMs), officerId: OTHER, version: 1 }));

    expect(store.readOnly()).toBe(true);
    expect(store.canAct()).toBe(false);
    expect(store.remedyDraft().officerNoteBn).toBe('এখনও পাঠানো হয়নি');
  });

  it('toggles a remedy on and off and marks the draft dirty', () => {
    const { store } = setup();
    store.openTask(detail(), NOW);

    store.toggleRemedy('r-1');
    expect(store.remedyDraft().remedyIds).toEqual(['r-2']);
    store.toggleRemedy('r-1');
    expect(store.remedyDraft().remedyIds).toEqual(['r-2', 'r-1']);
    expect(store.remedyDraft().dirty).toBe(true);
  });

  it('clears the workspace, draft included, on sign-out (WEB-SEC-004)', () => {
    const { store } = setup();
    store.openTask(detail({ task: claimedByMe(APP_CONFIG.review.claimTtlMs) }), NOW);
    store.setOfficerNote('গোপন নোট');

    store.clearSession();

    expect(store.task()).toBeNull();
    expect(store.analysis()).toBeNull();
    expect(store.remedyDraft().officerNoteBn).toBe('');
    expect(store.remedyDraft().dirty).toBe(false);
  });
});
