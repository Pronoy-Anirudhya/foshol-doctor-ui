import { TestBed } from '@angular/core/testing';
import type { OfficerQueueRow } from '../../generated/models/officer-queue-row';
import type { PageOfOfficerQueueRow } from '../../generated/models/page-of-officer-queue-row';
import { APP_CONFIG } from '../config/app-config';
import { QueueStore } from './queue-store';

const row = (caseId: string, topConfidence: number): OfficerQueueRow => ({
  caseId,
  reviewTaskId: `task-${caseId}`,
  state: 'PENDING',
  topConfidence,
  submittedAt: '2026-09-07T16:19:26.677409Z',
  slaDueAt: '2026-09-07T20:19:26.677409Z',
});

/**
 * Deliberately NOT in confidence order and NOT in id order: the server owns the order and this
 * fixture does not follow any rule a client could reproduce, so any client-side comparator would
 * visibly rearrange it.
 */
const SERVER_ORDER: readonly OfficerQueueRow[] = [
  row('c-mid', 0.51),
  row('c-low', 0.12),
  row('c-high', 0.94),
  row('c-other', 0.33),
];

const page = (rows: readonly OfficerQueueRow[]): PageOfOfficerQueueRow => ({
  page: 0,
  size: APP_CONFIG.page.defaultSize,
  totalElements: rows.length,
  totalPages: 1,
  content: [...rows],
});

function store(): QueueStore {
  TestBed.configureTestingModule({});
  return TestBed.inject(QueueStore);
}

describe('QueueStore', () => {
  afterEach(() => TestBed.resetTestingModule());

  // WEB-FR-200 / REVIEW-FR-030 / WEB-TEST-004 — queue order preservation.
  it('holds rows in exactly the server order', () => {
    const queue = store();
    queue.applyPage(page(SERVER_ORDER));

    expect(queue.rows().map((r) => r.caseId)).toEqual(['c-mid', 'c-low', 'c-high', 'c-other']);
    expect(queue.view().map((v) => v.row.caseId)).toEqual(['c-mid', 'c-low', 'c-high', 'c-other']);
  });

  it('exposes no sort control of any kind', () => {
    const queue = store();
    const surface = [
      ...Object.getOwnPropertyNames(queue),
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(queue) as object),
    ];
    expect(surface.filter((name) => /sort|order|compare/i.test(name))).toEqual([]);
  });

  it('keeps the order when a row is patched in place (WEB-FR-204)', () => {
    const queue = store();
    queue.applyPage(page(SERVER_ORDER));

    expect(queue.patchRow('c-high', 'IN_REVIEW')).toBe(true);

    expect(queue.rows().map((r) => r.caseId)).toEqual(['c-mid', 'c-low', 'c-high', 'c-other']);
    expect(queue.view()[2].liveStatus).toBe('IN_REVIEW');
    expect(queue.needsReload()).toBe(false);
  });

  it('leaves the server row object untouched when applying a live status', () => {
    const queue = store();
    queue.applyPage(page(SERVER_ORDER));
    queue.patchRow('c-low', 'IN_REVIEW');

    // The review-task state is the server's; a CaseStatus is never mapped onto it here.
    expect(queue.rows()[1].state).toBe('PENDING');
  });

  it('asks for a refetch when a case leaves the queue', () => {
    const queue = store();
    queue.applyPage(page(SERVER_ORDER));

    expect(queue.patchRow('c-low', 'ADVISED')).toBe(false);
    expect(queue.needsReload()).toBe(true);
    expect(queue.rows().map((r) => r.caseId)).toEqual(['c-mid', 'c-low', 'c-high', 'c-other']);
  });

  it('asks for a refetch for a case that is not on this page', () => {
    const queue = store();
    queue.applyPage(page(SERVER_ORDER));

    expect(queue.patchRow('c-elsewhere', 'ANALYSED')).toBe(false);
    expect(queue.needsReload()).toBe(true);
  });

  it('records staleSince once and keeps the first timestamp', () => {
    const queue = store();
    queue.applyPage(page(SERVER_ORDER));

    queue.markNeedsReload(1000);
    queue.markNeedsReload(9000);
    expect(queue.staleSince()).toBe(1000);
  });

  it('clears the stale marker and the live overlay when a fresh page arrives', () => {
    const queue = store();
    queue.applyPage(page(SERVER_ORDER));
    queue.patchRow('c-high', 'IN_REVIEW');
    queue.markNeedsReload();

    queue.applyPage(page(SERVER_ORDER));

    expect(queue.needsReload()).toBe(false);
    expect(queue.staleSince()).toBeNull();
    expect(queue.view()[2].liveStatus).toBeNull();
  });

  it('adopts the server page metadata verbatim', () => {
    const queue = store();
    queue.applyPage({ page: 2, size: 5, totalElements: 12, totalPages: 3, content: [] });

    expect(queue.page()).toBe(2);
    expect(queue.size()).toBe(5);
    expect(queue.totalElements()).toBe(12);
    expect(queue.totalPages()).toBe(3);
    expect(queue.hasPrevious()).toBe(true);
    expect(queue.hasNext()).toBe(false);
    expect(queue.isEmpty()).toBe(true);
  });

  it('keeps the rows on a failed load and records the error', () => {
    const queue = store();
    queue.applyPage(page(SERVER_ORDER));
    queue.beginLoad();
    queue.failLoad(new Error('offline'));

    expect(queue.rows()).toHaveLength(SERVER_ORDER.length);
    expect(queue.loading()).toBe(false);
    expect(queue.error()).toBeInstanceOf(Error);
  });

  it('empties on sign-out (WEB-SEC-004)', () => {
    const queue = store();
    queue.applyPage(page(SERVER_ORDER));
    queue.patchRow('c-high', 'IN_REVIEW');

    queue.clearSession();

    expect(queue.rows()).toEqual([]);
    expect(queue.totalElements()).toBe(0);
    expect(queue.size()).toBe(APP_CONFIG.page.defaultSize);
    expect(queue.needsReload()).toBe(false);
  });
});
