import { TestBed } from '@angular/core/testing';
import { APP_CONFIG } from '../config/app-config';
import {
  NotificationStore,
  NOTIFY_ADVISORY,
  NOTIFY_KPI_WARNING,
  NOTIFY_QUEUE_ARRIVAL,
  NOTIFY_REJECTION,
  NOTIFY_STATUS,
} from './notification-store';

function store(): NotificationStore {
  TestBed.configureTestingModule({});
  return TestBed.inject(NotificationStore);
}

describe('NotificationStore (WEB-FR-354)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('keeps arrivals newest-first, because the bell is read top-down', () => {
    const notifications = store();
    notifications.record({ kind: NOTIFY_STATUS, titleKey: 'live.case.statusChanged' });
    notifications.record({ kind: NOTIFY_ADVISORY, titleKey: 'live.advisory.published' });

    expect(notifications.items().map((n) => n.titleKey)).toEqual([
      'live.advisory.published',
      'live.case.statusChanged',
    ]);
  });

  /**
   * A `queue` frame carries neither a server id nor a task, so the case IS the identity — which
   * is what stops a resync replay from stacking the same arrival. The three tests after this one
   * pin the edges of that fallback: it is scoped to this kind, and to this kind only.
   */
  it('identifies a queue arrival by its case, so a replayed frame is not a second row', () => {
    const notifications = store();
    const first = notifications.record({ kind: NOTIFY_QUEUE_ARRIVAL, caseId: 'c-1' });
    const phase = notifications.arrivalPhase();
    const replay = notifications.record({ kind: NOTIFY_QUEUE_ARRIVAL, caseId: 'c-1' });

    expect(first).not.toBeNull();
    expect(replay).toBeNull();
    expect(notifications.items()).toHaveLength(1);
    // A swallowed replay must not re-arm the arrival animation either.
    expect(notifications.arrivalPhase()).toBe(phase);
  });

  it('records a queue arrival per case — two cases are two pieces of work', () => {
    const notifications = store();
    notifications.record({ kind: NOTIFY_QUEUE_ARRIVAL, caseId: 'c-1' });
    notifications.record({ kind: NOTIFY_QUEUE_ARRIVAL, caseId: 'c-2' });

    expect(notifications.items()).toHaveLength(2);
  });

  it('does not let a queue arrival swallow another kind about the same case', () => {
    const notifications = store();
    notifications.record({ kind: NOTIFY_QUEUE_ARRIVAL, caseId: 'c-1' });
    notifications.record({ kind: NOTIFY_STATUS, bodyKey: 'badge.status.ANALYSED', caseId: 'c-1' });

    expect(notifications.items()).toHaveLength(2);
  });

  /**
   * The regression lock. A farmer's status chain is several entries about ONE case, and the
   * server may omit `notificationId` — so the case fallback must never widen past its own kind.
   */
  it('keeps every id-less status change about the same case', () => {
    const notifications = store();
    notifications.record({ kind: NOTIFY_STATUS, bodyKey: 'badge.status.ANALYSED', caseId: 'c-1' });
    notifications.record({ kind: NOTIFY_STATUS, bodyKey: 'badge.status.IN_REVIEW', caseId: 'c-1' });
    notifications.record({ kind: NOTIFY_STATUS, bodyKey: 'badge.status.IN_REVIEW', caseId: 'c-1' });

    expect(notifications.items()).toHaveLength(3);
  });

  it('caps the list at notifications.maxItems and drops the oldest', () => {
    const notifications = store();
    const overflow = APP_CONFIG.notifications.maxItems + 3;
    for (let i = 0; i < overflow; i++) {
      notifications.record({ kind: NOTIFY_STATUS, body: `${i}` });
    }

    expect(notifications.items()).toHaveLength(APP_CONFIG.notifications.maxItems);
    // Newest first, so the head is the last one recorded and the very first one is gone.
    expect(notifications.items()[0].body).toBe(`${overflow - 1}`);
    expect(notifications.items().some((n) => n.body === '0')).toBe(false);
  });

  it('dedupes on the server notificationId so a resync does not duplicate a row', () => {
    const notifications = store();
    const first = notifications.record({
      kind: NOTIFY_ADVISORY,
      title: 'পরামর্শ প্রস্তুত',
      notificationId: 'n-1',
      caseId: 'c-1',
    });
    const replay = notifications.record({
      kind: NOTIFY_ADVISORY,
      title: 'পরামর্শ প্রস্তুত',
      notificationId: 'n-1',
      caseId: 'c-1',
    });

    expect(first).not.toBeNull();
    expect(replay).toBeNull();
    expect(notifications.items()).toHaveLength(1);
  });

  it('still records two frames that carried no server id', () => {
    const notifications = store();
    notifications.record({ kind: NOTIFY_STATUS, titleKey: 'live.case.statusChanged' });
    notifications.record({ kind: NOTIFY_STATUS, titleKey: 'live.case.statusChanged' });

    expect(notifications.items()).toHaveLength(2);
  });

  it('carries a server-supplied title verbatim alongside a key-free entry', () => {
    const notifications = store();
    notifications.record({
      kind: NOTIFY_ADVISORY,
      title: 'পরামর্শ প্রস্তুত',
      body: 'বিস্তারিত',
      caseId: 'c-1',
    });

    const entry = notifications.items()[0];
    expect(entry.title).toBe('পরামর্শ প্রস্তুত');
    expect(entry.titleKey).toBeUndefined();
    expect(entry.caseId).toBe('c-1');
  });

  it('counts unread until markAllRead, which leaves the rows in place', () => {
    const notifications = store();
    notifications.record({ kind: NOTIFY_STATUS });
    notifications.record({ kind: NOTIFY_REJECTION });

    expect(notifications.unreadCount()).toBe(2);
    expect(notifications.hasUnread()).toBe(true);

    notifications.markAllRead();

    expect(notifications.unreadCount()).toBe(0);
    expect(notifications.hasUnread()).toBe(false);
    expect(notifications.items()).toHaveLength(2);
  });

  it('dismisses one entry without disturbing the others', () => {
    const notifications = store();
    const first = notifications.record({ kind: NOTIFY_STATUS, body: 'one' });
    notifications.record({ kind: NOTIFY_STATUS, body: 'two' });

    notifications.dismiss(first as string);

    expect(notifications.items().map((n) => n.body)).toEqual(['two']);
  });

  it('alternates arrivalPhase on every arrival, so the CSS cue re-fires without a timer', () => {
    const notifications = store();
    const start = notifications.arrivalPhase();

    notifications.record({ kind: NOTIFY_STATUS });
    const afterFirst = notifications.arrivalPhase();
    notifications.record({ kind: NOTIFY_STATUS });

    expect(afterFirst).not.toBe(start);
    expect(notifications.arrivalPhase()).toBe(start);
  });

  it('does not flip the phase for a deduped replay — nothing arrived', () => {
    const notifications = store();
    notifications.record({ kind: NOTIFY_ADVISORY, notificationId: 'n-1' });
    const phase = notifications.arrivalPhase();

    notifications.record({ kind: NOTIFY_ADVISORY, notificationId: 'n-1' });

    expect(notifications.arrivalPhase()).toBe(phase);
  });

  it('empties on sign-out so one session cannot read the next one (WEB-SEC-004)', () => {
    const notifications = store();
    notifications.record({ kind: NOTIFY_ADVISORY, caseId: 'c-1' });

    notifications.clearSession();

    expect(notifications.items()).toHaveLength(0);
    expect(notifications.unreadCount()).toBe(0);
    expect(notifications.isEmpty()).toBe(true);
  });

  it('identifies a KPI warning by task and due instant, because it carries no server id', () => {
    const notifications = store();
    const entry = {
      kind: NOTIFY_KPI_WARNING,
      caseId: 'c-1',
      reviewTaskId: 't-1',
      dueAt: '2026-09-08T11:30:00Z',
    };

    const first = notifications.record(entry);
    const replay = notifications.record(entry);
    const later = notifications.record({ ...entry, dueAt: '2026-09-08T11:45:00Z' });

    expect(first).not.toBeNull();
    expect(replay).toBeNull();
    expect(later).not.toBeNull();
    expect(notifications.items()).toHaveLength(2);
  });

  it('stamps an arrival time it is given, so a view never has to guess one', () => {
    const notifications = store();
    const at = Date.parse('2026-09-08T10:19:26.000Z');

    notifications.record({ kind: NOTIFY_STATUS }, at);

    expect(notifications.items()[0].receivedAtMs).toBe(at);
    expect(notifications.items()[0].read).toBe(false);
  });
});
