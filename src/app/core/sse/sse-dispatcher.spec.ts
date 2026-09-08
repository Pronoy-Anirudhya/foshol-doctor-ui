import { TestBed } from '@angular/core/testing';
import type { OfficerQueueRow } from '../../generated/models/officer-queue-row';
import type { PageOfOfficerQueueRow } from '../../generated/models/page-of-officer-queue-row';
import { CaseStatusStore } from '../stores/case-status-store';
import { LiveAnnouncer } from '../stores/live-announcer';
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

describe('SseDispatcher', () => {
  let dispatcher: SseDispatcher;
  let caseStatus: CaseStatusStore;
  let queue: QueueStore;
  let toasts: ToastStore;
  let announcer: LiveAnnouncer;
  let sse: SseStore;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    dispatcher = TestBed.inject(SseDispatcher);
    caseStatus = TestBed.inject(CaseStatusStore);
    queue = TestBed.inject(QueueStore);
    toasts = TestBed.inject(ToastStore);
    announcer = TestBed.inject(LiveAnnouncer);
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
  });

  it('counts an unknown event and leaves everything else alone (WEB-FR-352)', () => {
    dispatcher.dispatch('brand-new-event', '{}');
    dispatcher.dispatch('another-one', '{}');

    expect(sse.unknownEventCount()).toBe(2);
    expect(toasts.toasts()).toHaveLength(0);
    expect(queue.needsReload()).toBe(false);
  });
});
