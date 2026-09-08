import { TestBed } from '@angular/core/testing';
import type { PageOfOfficerQueueRow } from '../../generated/models/page-of-officer-queue-row';
import { QueueSampleStore } from './queue-sample-store';

const PAGE: PageOfOfficerQueueRow = {
  page: 0,
  size: 100,
  totalElements: 6,
  totalPages: 1,
  content: [
    {
      caseId: 'c-1',
      reviewTaskId: 't-1',
      state: 'PENDING',
      submittedAt: '2026-09-08T05:07:34Z',
      slaDueAt: '2026-09-08T09:07:35Z',
      topConfidence: 0.91,
      decisionPath: 'PRIMARY',
    },
  ],
};

function store(): QueueSampleStore {
  TestBed.configureTestingModule({});
  return TestBed.inject(QueueSampleStore);
}

describe('QueueSampleStore', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('holds the page the server returned and stamps the load time', async () => {
    const sample = store();
    await sample.load(() => Promise.resolve(PAGE), () => 1234);

    expect(sample.page()).toEqual(PAGE);
    expect(sample.loadedAt()).toBe(1234);
    expect(sample.rowsLoaded()).toBe(1);
    expect(sample.totalElements()).toBe(6);
    expect(sample.stale()).toBe(false);
    expect(sample.loading()).toBe(false);
  });

  // WEB-FR-305 — the last good sample stays on screen under a stale marker.
  it('keeps the previous page and marks it stale when a refresh fails', async () => {
    const sample = store();
    await sample.load(() => Promise.resolve(PAGE), () => 1);
    await sample.load(() => Promise.reject(new Error('boom')), () => 2);

    expect(sample.page()).toEqual(PAGE);
    expect(sample.loadedAt()).toBe(1);
    expect(sample.stale()).toBe(true);
    expect(sample.error()).toBeInstanceOf(Error);
  });

  it('is not stale when the very first load fails — there is nothing to be stale about', async () => {
    const sample = store();
    await sample.load(() => Promise.reject(new Error('boom')));

    expect(sample.page()).toBeNull();
    expect(sample.hasPage()).toBe(false);
    expect(sample.stale()).toBe(false);
    expect(sample.rowsLoaded()).toBe(0);
    expect(sample.totalElements()).toBe(0);
  });

  it('clears the stale marker once a load succeeds again', async () => {
    const sample = store();
    await sample.load(() => Promise.resolve(PAGE));
    await sample.load(() => Promise.reject(new Error('boom')));
    await sample.load(() => Promise.resolve({ ...PAGE, totalElements: 9 }));

    expect(sample.stale()).toBe(false);
    expect(sample.totalElements()).toBe(9);
  });

  it('exposes no setter other than the loader', () => {
    const sample = store();
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(sample) as object);

    expect(methods.filter((m) => /^set|^update|^patch/.test(m))).toEqual([]);
  });

  it('empties on sign-out (WEB-SEC-004)', async () => {
    const sample = store();
    await sample.load(() => Promise.resolve(PAGE));
    sample.clearSession();

    expect(sample.page()).toBeNull();
    expect(sample.loadedAt()).toBeNull();
    expect(sample.error()).toBeNull();
  });
});
