import { TestBed } from '@angular/core/testing';
import type { OfficerQueueRow } from '../../generated/models/officer-queue-row';
import type { PageOfOfficerQueueRow } from '../../generated/models/page-of-officer-queue-row';
import type { Role } from '../auth/jwt';
import { SessionStore } from '../auth/session-store';
import { CaseStatusStore } from '../stores/case-status-store';
import { LiveAnnouncer } from '../stores/live-announcer';
import { NotificationStore } from '../stores/notification-store';
import { QueueStore } from '../stores/queue-store';
import { ToastStore } from '../stores/toast-store';
import { SseDispatcher } from './sse-dispatcher';
import { SseStore } from './sse-store';

const row = (caseId: string): OfficerQueueRow => ({
  caseId,
  reviewTaskId: `task-${caseId}`,
  state: 'PENDING',
  submittedAt: '2026-09-07T16:19:26.677409Z',
  slaDueAt: '2026-09-07T20:19:26.677409Z',
});

const page = (rows: readonly OfficerQueueRow[]): PageOfOfficerQueueRow => ({
  page: 0,
  size: 20,
  totalElements: rows.length,
  totalPages: 1,
  content: [...rows],
});

/**
 * `SessionStore` re-derives the role from the token, so a test that needs a role must hand it a
 * payload carrying that claim — the principal alone is not enough. Signing in here is inert:
 * neither `SseClient` nor `KpiWarningSeeder` is injected in this spec, and nothing ticks.
 */
const signInAs = (role: Role): void => {
  const payload = btoa(JSON.stringify({ sub: 'u', role, exp: 9_999_999_999 }));
  TestBed.inject(SessionStore).signIn(
    `h.${payload}.s`,
    { id: 'u-1', name: 'Demo', role },
    new Date(),
  );
};

const ANALYSED_FRAME = '{"caseId":"c-7","toStatus":"ANALYSED","correlationId":"q-1"}';

describe('SseDispatcher', () => {
  let dispatcher: SseDispatcher;
  let caseStatus: CaseStatusStore;
  let queue: QueueStore;
  let toasts: ToastStore;
  let announcer: LiveAnnouncer;
  let notifications: NotificationStore;
  let sse: SseStore;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    dispatcher = TestBed.inject(SseDispatcher);
    caseStatus = TestBed.inject(CaseStatusStore);
    queue = TestBed.inject(QueueStore);
    toasts = TestBed.inject(ToastStore);
    announcer = TestBed.inject(LiveAnnouncer);
    notifications = TestBed.inject(NotificationStore);
    sse = TestBed.inject(SseStore);
  });

  afterEach(() => {
    toasts.dismissAll();
    TestBed.resetTestingModule();
  });

  // The wire names of handover §10, not the enum-style names in the OpenAPI prose.
  it('binds to the wire event name "case-status" (WEB-FR-353)', () => {
    dispatcher.dispatch('case-status', '{"caseId":"c-1","fromStatus":"ANALYSED","toStatus":"IN_REVIEW"}');

    expect(caseStatus.statusOf('c-1')).toBe('IN_REVIEW');
    expect(caseStatus.entryOf('c-1')?.fromStatus).toBe('ANALYSED');
    expect(announcer.message()?.key).toBe('live.case.statusChanged');
  });

  it('does not react to the OpenAPI prose name CASE_STATUS_CHANGED', () => {
    dispatcher.dispatch('CASE_STATUS_CHANGED', '{"caseId":"c-1","toStatus":"IN_REVIEW"}');

    expect(caseStatus.statusOf('c-1')).toBeNull();
    expect(sse.unknownEventCount()).toBe(1);
  });

  it('toasts a published advisory and marks the case for refresh (WEB-FR-354)', () => {
    dispatcher.dispatch(
      'advisory',
      '{"caseId":"c-1","advisoryId":"a-1","type":"ADVISORY_PUBLISHED","titleBn":"পরামর্শ প্রস্তুত","bodyBn":"বিস্তারিত দেখুন"}',
    );

    const toast = toasts.toasts()[0];
    expect(toast.kind).toBe('SUCCESS');
    expect(toast.caseId).toBe('c-1');
    // Server-authored Bangla passes straight through; it is never looked up in a catalogue.
    expect(toast.title).toBe('পরামর্শ প্রস্তুত');
    expect(toast.body).toBe('বিস্তারিত দেখুন');
    expect(toast.titleKey).toBeUndefined();
    expect(caseStatus.needsRefresh('c-1')).toBe(true);
  });

  it('falls back to a chrome title key when the server sent no title', () => {
    dispatcher.dispatch('advisory', '{"caseId":"c-1","type":"ADVISORY_REVISED"}');

    const toast = toasts.toasts()[0];
    expect(toast.titleKey).toBe('live.advisory.revised');
    expect(toast.title).toBeUndefined();
    expect(toast.kind).toBe('INFO');
  });

  it('treats CASE_REJECTED as a warning toast on the advisory channel', () => {
    dispatcher.dispatch('advisory', '{"caseId":"c-9","type":"CASE_REJECTED"}');

    expect(toasts.toasts()[0].kind).toBe('WARNING');
    expect(caseStatus.needsRefresh('c-9')).toBe(true);
  });

  it('patches a queue row in place without re-ordering (WEB-FR-204)', () => {
    queue.applyPage(page([row('c-1'), row('c-2'), row('c-3')]));

    dispatcher.dispatch('queue', '{"caseId":"c-2","toStatus":"IN_REVIEW"}');

    expect(queue.rows().map((r) => r.caseId)).toEqual(['c-1', 'c-2', 'c-3']);
    expect(queue.view()[1].liveStatus).toBe('IN_REVIEW');
    expect(queue.needsReload()).toBe(false);
  });

  it('asks for a refetch when a queue change would move rows', () => {
    queue.applyPage(page([row('c-1')]));

    // A case not on this page cannot be placed without knowing the server's order.
    dispatcher.dispatch('queue', '{"caseId":"c-99","toStatus":"ANALYSED"}');

    expect(queue.needsReload()).toBe(true);
    expect(queue.rows().map((r) => r.caseId)).toEqual(['c-1']);
  });

  it('bumps resyncTick and stales the queue on a resync frame (WEB-FR-358)', () => {
    const before = sse.resyncTick();
    dispatcher.dispatch('resync', '{}');

    expect(sse.resyncTick()).toBe(before + 1);
    expect(queue.needsReload()).toBe(true);
  });

  it('does nothing on a reconnect frame — the read loop handles the close', () => {
    const before = sse.resyncTick();
    dispatcher.dispatch('reconnect', '{}');

    expect(sse.resyncTick()).toBe(before);
    expect(sse.unknownEventCount()).toBe(0);
  });

  it('drops a malformed payload without touching any store', () => {
    dispatcher.dispatch('case-status', 'not json at all');
    dispatcher.dispatch('case-status', '{"caseId":"c-1"}');
    dispatcher.dispatch('case-status', '{"caseId":"c-1","toStatus":"NOT_A_STATUS"}');
    dispatcher.dispatch('advisory', '{"caseId":"c-1","type":"NOT_A_TYPE"}');

    expect(caseStatus.statusOf('c-1')).toBeNull();
    expect(toasts.toasts()).toHaveLength(0);
    expect(notifications.items()).toHaveLength(0);
  });

  it('keeps an advisory in the notification centre after the toast expires (WEB-FR-354)', () => {
    dispatcher.dispatch(
      'advisory',
      '{"notificationId":"n-1","caseId":"c-1","type":"ADVISORY_PUBLISHED","titleBn":"পরামর্শ প্রস্তুত","bodyBn":"বিস্তারিত দেখুন"}',
    );

    const entry = notifications.items()[0];
    expect(entry.kind).toBe('ADVISORY');
    expect(entry.title).toBe('পরামর্শ প্রস্তুত');
    expect(entry.caseId).toBe('c-1');
    expect(entry.notificationId).toBe('n-1');
    expect(notifications.unreadCount()).toBe(1);
  });

  // WEB-FR-358 — a resync replays frames that were already delivered.
  it('does not duplicate a replayed frame that carries the same notificationId', () => {
    const frame = '{"notificationId":"n-7","caseId":"c-1","type":"ADVISORY_REVISED"}';
    dispatcher.dispatch('advisory', frame);
    dispatcher.dispatch('advisory', frame);

    expect(notifications.items()).toHaveLength(1);
    expect(notifications.items()[0].kind).toBe('REVISION');
  });

  it('records a case transition with the status label the badges already use', () => {
    dispatcher.dispatch(
      'case-status',
      '{"notificationId":"n-2","caseId":"c-4","toStatus":"IN_REVIEW"}',
    );

    const entry = notifications.items()[0];
    expect(entry.kind).toBe('STATUS');
    expect(entry.titleKey).toBe('live.case.statusChanged');
    expect(entry.bodyKey).toBe('badge.status.IN_REVIEW');
    expect(entry.caseId).toBe('c-4');
  });

  it('records a KPI warning against the review task, with no toast and no request', () => {
    dispatcher.dispatch(
      'kpi',
      '{"caseId":"c-9","reviewTaskId":"t-9","kind":"RESOLUTION_WARN","dueAt":"2026-09-08T11:30:00Z","correlationId":"r-1"}',
    );

    const entry = notifications.items()[0];
    expect(entry.kind).toBe('KPI_WARNING');
    expect(entry.reviewTaskId).toBe('t-9');
    expect(entry.dueAt).toBe('2026-09-08T11:30:00Z');
    expect(entry.caseId).toBe('c-9');
    expect(entry.titleKey).toBe('shared.notifications.kpi.resolutionWarning');
    expect(announcer.message()?.key).toBe('shared.notifications.kpi.resolutionWarning');
    // A deadline fifteen minutes out is not worth seizing the screen for mid-review.
    expect(toasts.toasts()).toHaveLength(0);
    expect(queue.needsReload()).toBe(false);
  });

  it('drops a KPI frame for a farmer — officers receive queue/kpi, farmers advisory/case-status', () => {
    const session = TestBed.inject(SessionStore);
    const payload = btoa(JSON.stringify({ sub: 'u', role: 'FARMER', exp: 9_999_999_999 }));
    session.signIn(`h.${payload}.s`, { id: 'u-1', name: 'Demo', role: 'FARMER' }, new Date());

    dispatcher.dispatch(
      'kpi',
      '{"caseId":"c-9","reviewTaskId":"t-9","kind":"RESOLUTION_WARN","dueAt":"2026-09-08T11:30:00Z"}',
    );

    expect(notifications.items()).toHaveLength(0);
    // Dropped, not counted: the event name IS known, it is simply not addressed to this role.
    expect(sse.unknownEventCount()).toBe(0);
  });

  it('drops a KPI frame whose kind is not whitelisted, and one with no task id', () => {
    dispatcher.dispatch(
      'kpi',
      '{"caseId":"c-9","reviewTaskId":"t-9","kind":"ASSIGNMENT_WARN","dueAt":"2026-09-08T11:30:00Z"}',
    );
    dispatcher.dispatch('kpi', '{"caseId":"c-9","kind":"RESOLUTION_WARN","dueAt":"2026-09-08T11:30:00Z"}');

    expect(notifications.items()).toHaveLength(0);
  });

  it('does not double a KPI warning replayed for the same task and due instant', () => {
    const frame =
      '{"caseId":"c-9","reviewTaskId":"t-9","kind":"RESOLUTION_WARN","dueAt":"2026-09-08T11:30:00Z"}';
    dispatcher.dispatch('kpi', frame);
    dispatcher.dispatch('kpi', frame);
    // A NEW due instant is a new warning, not a replay.
    dispatcher.dispatch(
      'kpi',
      '{"caseId":"c-9","reviewTaskId":"t-9","kind":"RESOLUTION_WARN","dueAt":"2026-09-08T11:45:00Z"}',
    );

    expect(notifications.items()).toHaveLength(2);
  });

  // ── The officer's queue arrival: the same chrome a farmer gets for an advisory ──────────────

  it('toasts and records new review work for an officer, and still asks for the refetch', () => {
    signInAs('OFFICER');
    queue.applyPage(page([row('c-1')]));

    dispatcher.dispatch('queue', ANALYSED_FRAME);

    const toast = toasts.toasts()[0];
    expect(toasts.toasts()).toHaveLength(1);
    expect(toast.kind).toBe('INFO');
    expect(toast.titleKey).toBe('shared.notifications.queue.analysed');
    expect(toast.bodyKey).toBe('shared.notifications.queue.analysedBody');
    expect(toast.caseId).toBe('c-7');

    const entry = notifications.items()[0];
    expect(notifications.items()).toHaveLength(1);
    expect(entry.kind).toBe('QUEUE_ARRIVAL');
    expect(entry.titleKey).toBe('shared.notifications.queue.analysed');
    expect(entry.caseId).toBe('c-7');
    expect(notifications.unreadCount()).toBe(1);

    // The queue's own behaviour is untouched: a case not on this page still asks for the page.
    expect(queue.needsReload()).toBe(true);
    expect(queue.rows().map((r) => r.caseId)).toEqual(['c-1']);
    expect(announcer.message()?.key).toBe('shared.notifications.queue.analysed');
  });

  it('stays quiet for an officer on ANALYSING — there is no review row to claim yet', () => {
    signInAs('OFFICER');

    dispatcher.dispatch('queue', '{"caseId":"c-7","toStatus":"ANALYSING"}');

    expect(toasts.toasts()).toHaveLength(0);
    expect(notifications.items()).toHaveLength(0);
    expect(announcer.message()?.key).toBe('live.queue.updated');
  });

  it('stays quiet for an officer on work LEAVING the queue, but still stales the page', () => {
    signInAs('OFFICER');
    queue.applyPage(page([row('c-7')]));

    dispatcher.dispatch('queue', '{"caseId":"c-7","toStatus":"ADVISED"}');

    expect(toasts.toasts()).toHaveLength(0);
    expect(notifications.items()).toHaveLength(0);
    expect(queue.needsReload()).toBe(true);
  });

  // WEB-FR-358 — a resync replays frames. `ToastStore` has no dedupe of its own, so the toast
  // count is the assertion that matters here: the bell alone would pass with the bug present.
  it('does not double a replayed queue arrival, in the bell OR on screen', () => {
    signInAs('OFFICER');

    dispatcher.dispatch('queue', ANALYSED_FRAME);
    dispatcher.dispatch('queue', ANALYSED_FRAME);

    expect(notifications.items()).toHaveLength(1);
    expect(toasts.toasts()).toHaveLength(1);
  });

  it('raises no notification chrome on a queue frame for a farmer', () => {
    signInAs('FARMER');

    dispatcher.dispatch('queue', ANALYSED_FRAME);

    expect(toasts.toasts()).toHaveLength(0);
    expect(notifications.items()).toHaveLength(0);
  });

  it('raises no notification chrome on a queue frame for an admin — admins have no bell', () => {
    signInAs('ADMIN');

    dispatcher.dispatch('queue', ANALYSED_FRAME);

    expect(toasts.toasts()).toHaveLength(0);
    expect(notifications.items()).toHaveLength(0);
  });

  // ── The farmer's case transitions ───────────────────────────────────────────────────────────

  it('toasts a farmer on the transitions worth interrupting for', () => {
    signInAs('FARMER');

    dispatcher.dispatch('case-status', '{"caseId":"c-1","toStatus":"ANALYSED"}');
    dispatcher.dispatch('case-status', '{"caseId":"c-2","toStatus":"IN_REVIEW"}');
    dispatcher.dispatch('case-status', '{"caseId":"c-3","toStatus":"FAILED"}');

    expect(toasts.toasts().map((t) => t.kind)).toEqual(['INFO', 'INFO', 'ERROR']);
    expect(toasts.toasts()[0].titleKey).toBe('live.case.statusChanged');
    expect(toasts.toasts()[0].bodyKey).toBe('badge.status.ANALYSED');
    expect(toasts.toasts()[2].bodyKey).toBe('badge.status.FAILED');
  });

  it('keeps a farmer status change in the bell without a toast where a toast would be noise', () => {
    signInAs('FARMER');

    // Their own button coming back at them.
    dispatcher.dispatch('case-status', '{"caseId":"c-1","toStatus":"SUBMITTED"}');
    // Both of these already toast from the `advisory` channel — see #onAdvisory.
    dispatcher.dispatch('case-status', '{"caseId":"c-2","toStatus":"ADVISED"}');
    dispatcher.dispatch('case-status', '{"caseId":"c-3","toStatus":"REJECTED"}');

    expect(toasts.toasts()).toHaveLength(0);
    expect(notifications.items()).toHaveLength(3);
  });

  it('shows exactly one toast when a rejection arrives on both channels', () => {
    signInAs('FARMER');

    dispatcher.dispatch('advisory', '{"caseId":"c-9","type":"CASE_REJECTED"}');
    dispatcher.dispatch('case-status', '{"caseId":"c-9","toStatus":"REJECTED"}');

    expect(toasts.toasts()).toHaveLength(1);
    expect(toasts.toasts()[0].kind).toBe('WARNING');
  });

  /**
   * The regression lock for the dedupe identity. A farmer's status chain arrives as several
   * entries for ONE case, and the server may omit `notificationId` — so any identity that folded
   * `caseId` in generally would collapse the whole chain into one bell row.
   */
  it('keeps every step of a status chain that carries no server id', () => {
    dispatcher.dispatch('case-status', '{"caseId":"c-1","toStatus":"ANALYSING"}');
    dispatcher.dispatch('case-status', '{"caseId":"c-1","toStatus":"ANALYSED"}');
    dispatcher.dispatch('case-status', '{"caseId":"c-1","toStatus":"IN_REVIEW"}');

    expect(notifications.items()).toHaveLength(3);
  });

  it('counts an unknown event and leaves everything else alone (WEB-FR-352)', () => {
    dispatcher.dispatch('brand-new-event', '{}');
    dispatcher.dispatch('another-one', '{}');

    expect(sse.unknownEventCount()).toBe(2);
    expect(toasts.toasts()).toHaveLength(0);
    expect(queue.needsReload()).toBe(false);
  });
});
