import { TestBed } from '@angular/core/testing';
import type { AdminStats } from '../../generated/models/admin-stats';
import { StatsStore } from './stats-store';

const STATS: AdminStats = {
  casesToday: 1,
  approvalRate: 1,
  medianReviewSeconds: 42,
  modelOfficerAgreementRate: 1,
  advisoriesPublished: 1,
  casesRejected: 0,
  pathCounts: { PRIMARY: 1, SECONDARY: 0, UNDETERMINED: 0 },
  thresholds: { high: 0.75, low: 0.45 },
};

function store(): StatsStore {
  TestBed.configureTestingModule({});
  return TestBed.inject(StatsStore);
}

describe('StatsStore', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('loads values and stamps the load time (WEB-FR-304)', async () => {
    const stats = store();
    await stats.load(() => Promise.resolve(STATS), () => 1234);

    expect(stats.stats()).toEqual(STATS);
    expect(stats.loadedAt()).toBe(1234);
    expect(stats.thresholds()).toEqual({ high: 0.75, low: 0.45 });
    expect(stats.stale()).toBe(false);
    expect(stats.loading()).toBe(false);
  });

  // WEB-FR-305 — the last good values stay on screen under a stale marker.
  it('keeps the previous values and marks them stale when a refresh fails', async () => {
    const stats = store();
    await stats.load(() => Promise.resolve(STATS), () => 1);
    await stats.load(() => Promise.reject(new Error('boom')), () => 2);

    expect(stats.stats()).toEqual(STATS);
    expect(stats.loadedAt()).toBe(1);
    expect(stats.stale()).toBe(true);
    expect(stats.error()).toBeInstanceOf(Error);
  });

  it('is not stale when the very first load fails — there is nothing to be stale about', async () => {
    const stats = store();
    await stats.load(() => Promise.reject(new Error('boom')));

    expect(stats.stats()).toBeNull();
    expect(stats.hasValues()).toBe(false);
    expect(stats.stale()).toBe(false);
  });

  it('clears the stale marker once a load succeeds again', async () => {
    const stats = store();
    await stats.load(() => Promise.resolve(STATS));
    await stats.load(() => Promise.reject(new Error('boom')));
    await stats.load(() => Promise.resolve({ ...STATS, casesToday: 9 }));

    expect(stats.stale()).toBe(false);
    expect(stats.stats()?.casesToday).toBe(9);
  });

  it('exposes no setter other than the loader', () => {
    const stats = store();
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(stats) as object);
    expect(methods.filter((m) => /^set|^update|^patch/.test(m))).toEqual([]);
  });

  it('empties on sign-out (WEB-SEC-004)', async () => {
    const stats = store();
    await stats.load(() => Promise.resolve(STATS));
    stats.clearSession();

    expect(stats.stats()).toBeNull();
    expect(stats.loadedAt()).toBeNull();
    expect(stats.error()).toBeNull();
  });
});
