import { TestBed } from '@angular/core/testing';
import { CaseStatusStore } from './case-status-store';

function store(): CaseStatusStore {
  TestBed.configureTestingModule({});
  return TestBed.inject(CaseStatusStore);
}

describe('CaseStatusStore', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('records exactly the status the server sent', () => {
    const cases = store();
    cases.applyServerStatus('c-1', 'ANALYSING', 'SUBMITTED', 1000);

    expect(cases.statusOf('c-1')).toBe('ANALYSING');
    expect(cases.entryOf('c-1')).toEqual({
      caseId: 'c-1',
      status: 'ANALYSING',
      fromStatus: 'SUBMITTED',
      at: 1000,
    });
    expect(cases.lastEventAt()).toBe(1000);
  });

  it('invents no transition — an unseen case has no status at all', () => {
    const cases = store();
    expect(cases.statusOf('never-seen')).toBeNull();
    expect(cases.isTerminal('never-seen')).toBe(false);
  });

  it('replaces a status only with a later server value, and skips nothing', () => {
    const cases = store();
    cases.applyServerStatus('c-1', 'SUBMITTED', null, 1);
    // The server may legitimately skip a stage; whatever it sends is what is held.
    cases.applyServerStatus('c-1', 'IN_REVIEW', 'SUBMITTED', 2);

    expect(cases.statusOf('c-1')).toBe('IN_REVIEW');
    expect(cases.entryOf('c-1')?.fromStatus).toBe('SUBMITTED');
  });

  it('marks a case dirty without conjuring a status for it', () => {
    const cases = store();
    cases.markNeedsRefresh('c-unknown', 500);

    expect(cases.needsRefresh('c-unknown')).toBe(true);
    expect(cases.statusOf('c-unknown')).toBeNull();
    expect(cases.trackedCount()).toBe(0);
  });

  it('keeps the dirty flag across a later status update, until the view clears it', () => {
    const cases = store();
    cases.markNeedsRefresh('c-1');
    cases.applyServerStatus('c-1', 'ADVISED');

    expect(cases.needsRefresh('c-1')).toBe(true);
    cases.clearRefresh('c-1');
    expect(cases.needsRefresh('c-1')).toBe(false);
  });

  it('recognises the three terminal statuses', () => {
    const cases = store();
    for (const status of ['ADVISED', 'REJECTED', 'FAILED'] as const) {
      cases.applyServerStatus(status, status);
      expect(cases.isTerminal(status)).toBe(true);
    }
    cases.applyServerStatus('c-live', 'IN_REVIEW');
    expect(cases.isTerminal('c-live')).toBe(false);
  });

  it('empties on sign-out (WEB-SEC-004)', () => {
    const cases = store();
    cases.applyServerStatus('c-1', 'ADVISED');
    cases.markNeedsRefresh('c-1');

    cases.clearSession();

    expect(cases.trackedCount()).toBe(0);
    expect(cases.needsRefresh('c-1')).toBe(false);
    expect(cases.lastEventAt()).toBeNull();
  });
});
