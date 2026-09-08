import { TestBed } from '@angular/core/testing';
import type { KpiWarning } from '../../generated/models/kpi-warning';
import type { Principal } from '../../generated/models/principal';
import { ReviewService } from '../../generated/services/review.service';
import { SessionStore } from '../auth/session-store';
import { LiveAnnouncer } from '../stores/live-announcer';
import { NotificationStore } from '../stores/notification-store';
import { KpiWarningSeeder } from './kpi-warning-seeder';
import { SseDispatcher } from './sse-dispatcher';
import { SseStore } from './sse-store';

const warning = (taskId: string, dueAt: string): KpiWarning => ({
  caseId: `c-${taskId}`,
  reviewTaskId: taskId,
  dueAt,
  warnAt: '2026-09-08T11:15:00Z',
});

/** Stands in for the generated service; records how often the endpoint was actually read. */
class StubReview {
  calls = 0;
  result: KpiWarning[] = [];
  failure: Error | null = null;

  listKpiWarnings(): Promise<KpiWarning[]> {
    this.calls += 1;
    return this.failure === null ? Promise.resolve(this.result) : Promise.reject(this.failure);
  }
}

function tokenFor(role: Principal['role']): string {
  return `header.${btoa(JSON.stringify({ sub: 'u', role, exp: 9_999_999_999 }))}.signature`;
}

describe('KpiWarningSeeder (WEB-FR-356, WEB-FR-358)', () => {
  let review: StubReview;
  let seeder: KpiWarningSeeder;
  let session: SessionStore;
  let notifications: NotificationStore;
  let sse: SseStore;

  beforeEach(() => {
    review = new StubReview();
    TestBed.configureTestingModule({
      providers: [{ provide: ReviewService, useValue: review }],
    });
    seeder = TestBed.inject(KpiWarningSeeder);
    session = TestBed.inject(SessionStore);
    notifications = TestBed.inject(NotificationStore);
    sse = TestBed.inject(SseStore);
  });

  afterEach(() => TestBed.resetTestingModule());

  /** The effect is the trigger; flushing it and its promise is what "wait" means here. */
  async function settle(): Promise<void> {
    TestBed.tick();
    await Promise.resolve();
    await Promise.resolve();
  }

  function signInOfficer(): void {
    session.signIn(tokenFor('OFFICER'), { id: 'u-2', name: 'Officer', role: 'OFFICER' }, new Date());
  }

  it('reads the endpoint exactly once on sign-in and populates the bell', async () => {
    review.result = [warning('t-1', '2026-09-08T11:30:00Z')];
    signInOfficer();
    await settle();
    await settle();

    expect(review.calls).toBe(1);
    const entry = notifications.items()[0];
    expect(entry.kind).toBe('KPI_WARNING');
    expect(entry.reviewTaskId).toBe('t-1');
    expect(entry.dueAt).toBe('2026-09-08T11:30:00Z');
    expect(entry.titleKey).toBe('shared.notifications.kpi.resolutionWarning');
    expect(TestBed.inject(LiveAnnouncer).message()?.key).toBe('shared.notifications.kpi.restored');
  });

  it('never fetches for a farmer — these warnings are officer-addressed', async () => {
    session.signIn(tokenFor('FARMER'), { id: 'u-1', name: 'Demo', role: 'FARMER' }, new Date());
    await settle();

    expect(review.calls).toBe(0);
    expect(notifications.items()).toHaveLength(0);
  });

  it('re-seeds on a resync and does not double what the stream already delivered', async () => {
    review.result = [warning('t-1', '2026-09-08T11:30:00Z')];
    signInOfficer();
    await settle();
    await settle();

    TestBed.inject(SseDispatcher).requestResync();
    await settle();
    await settle();

    expect(review.calls).toBe(2);
    expect(sse.resyncTick()).toBe(1);
    // Same task, same due instant: one warning, however many times it is recovered.
    expect(notifications.items()).toHaveLength(1);
  });

  it('degrades quietly when the endpoint fails, leaving the live channel untouched', async () => {
    review.failure = new Error('500 — the running build predates this endpoint');
    signInOfficer();
    await settle();
    await settle();

    expect(seeder.lastSeedFailed()).toBe(true);
    expect(notifications.items()).toHaveLength(0);
    expect(session.isAuthenticated()).toBe(true);

    // The bell still works from frames: the fetch is recovery, never the primary channel.
    TestBed.inject(SseDispatcher).dispatch(
      'kpi',
      '{"caseId":"c-9","reviewTaskId":"t-9","kind":"RESOLUTION_WARN","dueAt":"2026-09-08T11:30:00Z"}',
    );
    expect(notifications.items()).toHaveLength(1);
  });

  it('stops seeding once the session is cleared', async () => {
    review.result = [warning('t-1', '2026-09-08T11:30:00Z')];
    signInOfficer();
    await settle();
    await settle();

    session.clear();
    await settle();

    expect(review.calls).toBe(1);
  });
});
