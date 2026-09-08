import type { AdminKpiSummary } from '../../../generated/models/admin-kpi-summary';
import { toKpiSummaryView } from './kpi-summary.adapter';

/**
 * The attribution rule, as tests. Every case here exists because getting it wrong would put a
 * district failure next to a person's name.
 */
describe('toKpiSummaryView', () => {
  const summary = (over: Partial<AdminKpiSummary> = {}): AdminKpiSummary => ({
    assignmentFailures: 0,
    resolutionFailures: 0,
    officers: [],
    ...over,
  });

  it('keeps assignment failures as a district total and never divides them', () => {
    const view = toKpiSummaryView(
      summary({
        assignmentFailures: 7,
        resolutionFailures: 3,
        officers: [{ officerId: 'o-1', officerName: 'Rahim', resolutionFailures: 3 }],
      }),
    );

    expect(view.assignmentFailures).toBe(7);
    // The only per-officer number in the view is the resolution one the server sent.
    expect(view.officers.map((o) => o.resolutionFailures)).toEqual([3]);
    expect(JSON.stringify(view.officers)).not.toContain('7');
  });

  it('orders officers by resolution failures, busiest first, and shares against the busiest', () => {
    const view = toKpiSummaryView(
      summary({
        resolutionFailures: 9,
        officers: [
          { officerId: 'o-1', officerName: 'Amina', resolutionFailures: 2 },
          { officerId: 'o-2', officerName: 'Babul', resolutionFailures: 6 },
          { officerId: 'o-3', officerName: 'Chaitali', resolutionFailures: 1 },
        ],
      }),
    );

    expect(view.officers.map((o) => o.officerName)).toEqual(['Babul', 'Amina', 'Chaitali']);
    expect(view.officers[0]?.share).toBe(1);
    expect(view.officers[1]?.share).toBeCloseTo(2 / 6);
    expect(view.attributedResolutionFailures).toBe(9);
    expect(view.unattributedResolutionFailures).toBe(0);
  });

  it('states the resolution remainder the server named nobody for, rather than hiding it', () => {
    const view = toKpiSummaryView(
      summary({
        resolutionFailures: 10,
        officers: [{ officerId: 'o-1', officerName: 'Amina', resolutionFailures: 4 }],
      }),
    );

    expect(view.attributedResolutionFailures).toBe(4);
    expect(view.unattributedResolutionFailures).toBe(6);
  });

  it('never reports a negative remainder', () => {
    const view = toKpiSummaryView(
      summary({
        resolutionFailures: 1,
        officers: [{ officerId: 'o-1', officerName: 'Amina', resolutionFailures: 4 }],
      }),
    );

    expect(view.unattributedResolutionFailures).toBe(0);
  });

  it('leaves an unnamed officer unnamed instead of inventing a label', () => {
    const view = toKpiSummaryView(
      summary({ resolutionFailures: 1, officers: [{ officerId: 'o-9', resolutionFailures: 1 }] }),
    );

    expect(view.officers[0]?.officerName).toBeNull();
    expect(view.officers[0]?.officerId).toBe('o-9');
  });

  it('treats an all-zero answer as a counted result, not as missing data', () => {
    const view = toKpiSummaryView(summary());

    expect(view.allClear).toBeTruthy();
    expect(view.assignmentFailures).toBe(0);
    expect(view.resolutionFailures).toBe(0);
  });
});
