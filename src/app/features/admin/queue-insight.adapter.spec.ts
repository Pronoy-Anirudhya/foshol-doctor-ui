import { APP_CONFIG } from '../../core/config/app-config';
import type { OfficerQueueRow } from '../../generated/models/officer-queue-row';
import type { PageOfOfficerQueueRow } from '../../generated/models/page-of-officer-queue-row';
import { toQueueInsightView } from './queue-insight.adapter';

const BINS = APP_CONFIG.admin.confidenceBins;
const NOW = Date.parse('2026-09-08T12:00:00Z');
const HOUR = APP_CONFIG.admin.slaDueSoonMs;

let seq = 0;
const row = (overrides: Partial<OfficerQueueRow> = {}): OfficerQueueRow => ({
  caseId: `c-${(seq += 1)}`,
  reviewTaskId: `t-${seq}`,
  state: 'PENDING',
  submittedAt: '2026-09-08T06:00:00Z',
  slaDueAt: '2026-09-08T18:00:00Z',
  ...overrides,
});

const page = (
  rows: readonly OfficerQueueRow[],
  totalElements = rows.length,
): PageOfOfficerQueueRow => ({
  page: APP_CONFIG.admin.samplePage,
  size: APP_CONFIG.admin.sampleSize,
  totalElements,
  totalPages: 1,
  content: [...rows],
});

const view = (rows: readonly OfficerQueueRow[], total?: number) =>
  toQueueInsightView(page(rows, total), NOW);

describe('toQueueInsightView — the sample, never the census (WEB-NFR-001)', () => {
  it('states both how many rows it has and how many exist', () => {
    const insight = view([row(), row()], 87);

    expect(insight.rowsLoaded).toBe(2);
    expect(insight.totalElements).toBe(87);
  });
});

describe('confidence landscape', () => {
  it('always produces exactly the configured number of bins', () => {
    expect(view([]).confidence.bins.length).toBe(BINS);
    expect(view([row({ topConfidence: 0.5 })]).confidence.bins.length).toBe(BINS);
  });

  /**
   * The boundary cases inherited from the deleted `threshold-track.spec.ts`. 20 bins is chosen
   * so both thresholds land ON a bin edge: 0.45 × 20 = 9 and 0.75 × 20 = 15 are integers, so a
   * confidence exactly at a threshold opens the band above it rather than straddling a bar.
   */
  const BOUNDARIES = [
    { name: 'zero', confidence: 0, bin: 0 },
    { name: 'exactly the low threshold', confidence: 0.45, bin: 9 },
    { name: 'strictly between the thresholds', confidence: 0.6, bin: 12 },
    { name: 'exactly the high threshold', confidence: 0.75, bin: 15 },
    { name: 'one', confidence: 1, bin: BINS - 1 },
  ];

  for (const boundary of BOUNDARIES) {
    it(`places ${boundary.name} in bin ${boundary.bin}, on a bin edge`, () => {
      const bins = view([row({ topConfidence: boundary.confidence })]).confidence.bins;

      expect(bins[boundary.bin]).toBe(1);
      expect(bins.reduce((a, b) => a + b, 0)).toBe(1);
    });
  }

  it('collects one rug tick per scored row and counts the unscored ones as text', () => {
    const insight = view([
      row({ topConfidence: 0.91 }),
      row({ topConfidence: null }),
      row({}),
      row({ topConfidence: 0.2 }),
    ]);

    expect(insight.confidence.ticks).toEqual([0.91, 0.2]);
    expect(insight.confidence.scored).toBe(2);
    expect(insight.confidence.unscored).toBe(2);
  });

  it('names the fullest bin so the peak is never carried by colour alone', () => {
    const insight = view([
      row({ topConfidence: 0.91 }),
      row({ topConfidence: 0.92 }),
      row({ topConfidence: 0.1 }),
    ]);

    expect(insight.confidence.peakBin).toBe(18);
    expect(insight.confidence.peakCount).toBe(2);
  });

  it('reports no peak at all rather than bin zero when nothing is scored', () => {
    const insight = view([row({ topConfidence: null })]);

    expect(insight.confidence.peakBin).toBe(-1);
    expect(insight.confidence.peakCount).toBe(0);
    expect(insight.confidence.scored).toBe(0);
  });
});

describe('band tallies', () => {
  /**
   * The load-bearing test of this file. The two rows below are routed by the server in a way
   * that bucketing `topConfidence` against 0.45/0.75 would NOT reproduce. The tallies must
   * follow the server, because re-deriving routing client-side is what WEB-NFR-001 forbids.
   */
  it('counts the server decisionPath, never a client re-bucketing of topConfidence', () => {
    const insight = view([
      row({ topConfidence: 0.91, decisionPath: 'UNDETERMINED' }),
      row({ topConfidence: 0.1, decisionPath: 'PRIMARY' }),
    ]);

    expect(insight.bands).toEqual([
      { path: 'UNDETERMINED', count: 1 },
      { path: 'SECONDARY', count: 0 },
      { path: 'PRIMARY', count: 1 },
    ]);
  });

  it('always returns the three bands in ascending-confidence order, zeroes included', () => {
    expect(view([]).bands.map((b) => b.path)).toEqual(['UNDETERMINED', 'SECONDARY', 'PRIMARY']);
    expect(view([]).bands.every((b) => b.count === 0)).toBe(true);
  });

  it('counts an unrouted row separately rather than inventing a fourth band', () => {
    const insight = view([row({}), row({ decisionPath: 'PRIMARY' })]);

    expect(insight.bandUnrouted).toBe(1);
    expect(insight.bands.length).toBe(3);
  });
});

describe('submission cadence', () => {
  const at = (iso: string) => row({ submittedAt: iso });

  it('buckets across the observed window, not a fixed clock window', () => {
    const insight = view([
      at('2026-09-08T00:00:00Z'),
      at('2026-09-08T00:00:00Z'),
      at('2026-09-08T12:00:00Z'),
    ]);

    expect(insight.cadence.fromMs).toBe(Date.parse('2026-09-08T00:00:00Z'));
    expect(insight.cadence.toMs).toBe(Date.parse('2026-09-08T12:00:00Z'));
    expect(insight.cadence.buckets.length).toBe(APP_CONFIG.admin.cadenceBuckets);
    expect(insight.cadence.buckets[0]).toBe(2);
    expect(insight.cadence.buckets.at(-1)).toBe(1);
    expect(insight.cadence.peakCount).toBe(2);
  });

  it('draws no line below the minimum row count — the summary stands alone', () => {
    const rows = Array.from({ length: APP_CONFIG.admin.cadenceMinRows - 1 }, (_, i) =>
      at(`2026-09-0${i + 1}T00:00:00Z`),
    );
    const insight = view(rows);

    expect(insight.cadence.counted).toBe(rows.length);
    expect(insight.cadence.buckets).toEqual([]);
  });

  it('draws no line when every row landed on the same instant (a zero-width window)', () => {
    const insight = view([at('2026-09-08T06:00:00Z'), at('2026-09-08T06:00:00Z'), at('2026-09-08T06:00:00Z')]);

    expect(insight.cadence.counted).toBe(3);
    expect(insight.cadence.buckets).toEqual([]);
    expect(insight.cadence.fromMs).toBe(insight.cadence.toMs);
  });

  it('reports no window at all when nothing has a parseable timestamp', () => {
    const insight = view([at('not a date')]);

    expect(insight.cadence.counted).toBe(0);
    expect(insight.cadence.fromMs).toBeNull();
    expect(insight.cadence.buckets).toEqual([]);
  });
});

describe('SLA runway', () => {
  it('bands each row against the "now" it was handed, once', () => {
    const insight = view([
      row({ slaDueAt: '2026-09-08T11:00:00Z' }), //   an hour ago  → overdue
      row({ slaDueAt: '2026-09-08T12:30:00Z' }), //   in 30 min    → due soon
      row({ slaDueAt: '2026-09-09T12:00:00Z' }), //   tomorrow     → on time
      row({ slaDueAt: 'never' }), //                  unparseable  → unknown
    ]);

    expect(insight.sla).toEqual({
      overdue: 1,
      dueSoon: 1,
      onTime: 1,
      unknown: 1,
      asOfMs: NOW,
    });
  });

  it('treats the due-soon boundary as inclusive and does not slide it', () => {
    const insight = view([
      row({ slaDueAt: new Date(NOW + HOUR).toISOString() }),
      row({ slaDueAt: new Date(NOW + HOUR + 1).toISOString() }),
    ]);

    expect(insight.sla.dueSoon).toBe(1);
    expect(insight.sla.onTime).toBe(1);
  });
});

describe('queue composition', () => {
  it('keeps every state and mode in the union, zeroes included', () => {
    const insight = view([
      row({ state: 'PENDING', analysisMode: 'REPLAY' }),
      row({ state: 'CLAIMED', analysisMode: 'REPLAY' }),
    ]);

    expect(insight.states).toEqual([
      { key: 'PENDING', count: 1 },
      { key: 'CLAIMED', count: 1 },
      { key: 'DONE', count: 0 },
      { key: 'REJECTED', count: 0 },
    ]);
    expect(insight.modes).toEqual([
      { key: 'LIVE', count: 0 },
      { key: 'REPLAY', count: 2 },
    ]);
  });

  it('ignores a row whose analysis mode the server did not send', () => {
    const insight = view([row({})]);

    expect(insight.modes.reduce((sum, slice) => sum + slice.count, 0)).toBe(0);
  });
});
