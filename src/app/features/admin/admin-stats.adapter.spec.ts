import type { AdminStats } from '../../generated/models/admin-stats';
import { toAdminStatsView } from './admin-stats.adapter';

/**
 * DEVIATIONS.md D-06 — the adapter is the only thing standing between a live body that names
 * `medianReviewMinutes` and a page that would otherwise render minutes as seconds.
 */
const live = (overrides: Record<string, unknown> = {}): AdminStats =>
  ({
    casesToday: 4,
    approvalRate: 0.5,
    medianReviewMinutes: 3.5,
    agreementRate: null,
    agreementSampleSize: 0,
    confidenceHigh: 0.75,
    confidenceLow: 0.45,
    ...overrides,
  }) as unknown as AdminStats;

describe('toAdminStatsView (D-06, WEB-FR-301/302)', () => {
  it('maps the live body, flat thresholds included', () => {
    const view = toAdminStatsView(live());

    expect(view.casesToday).toBe(4);
    expect(view.approvalRate).toBe(0.5);
    expect(view.medianReviewMinutes).toBe(3.5);
    expect(view.thresholds).toEqual({ low: 0.45, high: 0.75 });
  });

  it('reads minutes as minutes and seconds as minutes, never one as the other', () => {
    expect(toAdminStatsView(live({ medianReviewMinutes: 2 })).medianReviewMinutes).toBe(2);

    // The contract's field carries SECONDS. 120 of them are two minutes, not two.
    const reconciled = live({ medianReviewMinutes: undefined, medianReviewSeconds: 120 });
    expect(toAdminStatsView(reconciled).medianReviewMinutes).toBe(2);
  });

  it('accepts the contract shape too, so a reconciled backend keeps working', () => {
    const contractShaped = {
      casesToday: 9,
      approvalRate: 0.8,
      medianReviewSeconds: 300,
      modelOfficerAgreementRate: 0.6,
      thresholds: { low: 0.4, high: 0.8 },
    } as unknown as AdminStats;

    const view = toAdminStatsView(contractShaped);

    expect(view.medianReviewMinutes).toBe(5);
    expect(view.agreementRate).toBe(0.6);
    expect(view.thresholds).toEqual({ low: 0.4, high: 0.8 });
  });

  it('keeps nulls as nulls — they are the normal state, not a zero', () => {
    const view = toAdminStatsView(
      live({ approvalRate: null, medianReviewMinutes: null, agreementRate: null }),
    );

    expect(view.approvalRate).toBeNull();
    expect(view.medianReviewMinutes).toBeNull();
    expect(view.agreementRate).toBeNull();
    expect(view.agreementSampleSize).toBe(0);
  });

  it('returns no threshold pair rather than half of one', () => {
    expect(toAdminStatsView(live({ confidenceLow: undefined })).thresholds).toBeNull();
    expect(toAdminStatsView(live({ confidenceHigh: null })).thresholds).toBeNull();
  });

  it('does not model the three fields the server never sends', () => {
    // The three absentees this guards against are `advisoriesPublished`, `casesRejected` and
    // `pathCounts`: they exist on the generated contract but never on the wire (D-06), so the
    // view must not carry them. Everything the live body does send is modelled.
    expect(Object.keys(toAdminStatsView(live())).sort()).toEqual([
      'agreementRate',
      'agreementSampleSize',
      'approvalRate',
      'casesLifetime',
      'casesThisMonth',
      'casesThisYear',
      'casesToday',
      'medianReviewMinutes',
      'rejectionRate',
      'thresholds',
    ]);
  });
});
