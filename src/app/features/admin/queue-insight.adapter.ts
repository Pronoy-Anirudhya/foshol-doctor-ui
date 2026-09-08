import { APP_CONFIG } from '../../core/config/app-config';
import type { AnalysisMode } from '../../generated/models/analysis-mode';
import type { DecisionPath } from '../../generated/models/decision-path';
import type { OfficerQueueRow } from '../../generated/models/officer-queue-row';
import type { PageOfOfficerQueueRow } from '../../generated/models/page-of-officer-queue-row';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  ONE PAGE OF `/review/queue`, TURNED INTO THE FOUR ADMIN WIDGETS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `/admin/stats` returns six scalars and the frozen contract has no time-series endpoint at
 * all, so everything with shape in it is derived from a single queue page. That imposes two
 * rules on this file, both of which the types below enforce:
 *
 *  1. **Every number describes the ROWS LOADED, never the system.** `rowsLoaded` and
 *     `totalElements` travel with the view precisely so no widget can present a sample as a
 *     census (`WEB-NFR-001`).
 *  2. **Nothing here re-derives a backend decision.** The band tallies count the server's
 *     `decisionPath` field. They are NOT produced by bucketing `topConfidence` against the two
 *     thresholds — that would be re-implementing the routing rule the page exists to display,
 *     which `WEB-NFR-001` forbids outright, and it would silently paper over any case the
 *     server routed by a rule the UI does not know about.
 *
 * A **separate** type from `AdminStatsView` on purpose: that one's exact key set is asserted by
 * `admin-stats.adapter.spec.ts`, and the two views come from two endpoints that fail
 * independently.
 *
 * Pure functions only — no injection, no clock. `nowMs` is passed in, because the SLA banding
 * is sampled ONCE at load and stated as "as of {time}" rather than ticking (`WEB-FR-356`).
 */

export type QueueState = OfficerQueueRow['state'];

/** The routing bands, in ascending-confidence order. Fixed by the contract, not configurable. */
const BAND_ORDER: readonly DecisionPath[] = ['UNDETERMINED', 'SECONDARY', 'PRIMARY'];

/** Queue states, in workflow order. `OfficerQueueRow['state']` is a closed union. */
const STATE_ORDER: readonly QueueState[] = ['PENDING', 'CLAIMED', 'DONE', 'REJECTED'];

/** `AnalysisMode`, live first: a fixture must never be able to read as live inference. */
const MODE_ORDER: readonly AnalysisMode[] = ['LIVE', 'REPLAY'];

export interface ConfidenceLandscapeView {
  /** Counts per bin, always `APP_CONFIG.admin.confidenceBins` long. */
  readonly bins: readonly number[];
  /** Index of the fullest bin, or `-1` when nothing is scored. Highlighted AND named in text. */
  readonly peakBin: number;
  readonly peakCount: number;
  /** One `topConfidence` per scored row, in server order — the rug plot's x positions. */
  readonly ticks: readonly number[];
  readonly scored: number;
  /** Rows the server has no confidence for. Counted as text, never drawn as a zero-height bar. */
  readonly unscored: number;
}

export interface BandTally {
  readonly path: DecisionPath;
  /** From the server's own `decisionPath`. Never re-derived from `topConfidence`. */
  readonly count: number;
}

export interface CadenceView {
  /** Timestamps that parsed. Below `cadenceMinRows`, `buckets` is empty by construction. */
  readonly counted: number;
  readonly fromMs: number | null;
  readonly toMs: number | null;
  /**
   * Counts across the OBSERVED window. **Empty means no line may be drawn** — too few
   * timestamps, or a window of zero width. A polyline through two points invents a trend.
   */
  readonly buckets: readonly number[];
  readonly peakCount: number;
}

export interface SlaRunwayView {
  readonly overdue: number;
  readonly dueSoon: number;
  readonly onTime: number;
  /** No parseable `slaDueAt`. Shown as its own segment rather than folded into "on time". */
  readonly unknown: number;
  /** Sampled once, at load. Displayed as "as of {time}" — there is no timer (`WEB-FR-356`). */
  readonly asOfMs: number;
}

export interface CompositionSlice<T extends string> {
  readonly key: T;
  readonly count: number;
}

export interface QueueInsightView {
  readonly rowsLoaded: number;
  readonly totalElements: number;
  readonly confidence: ConfidenceLandscapeView;
  /** Exactly three, in ascending-confidence order, whatever the sample contains. */
  readonly bands: readonly BandTally[];
  /** Rows the server sent no `decisionPath` for. Reported as text, never as a fourth band. */
  readonly bandUnrouted: number;
  readonly cadence: CadenceView;
  readonly sla: SlaRunwayView;
  readonly states: readonly CompositionSlice<QueueState>[];
  readonly modes: readonly CompositionSlice<AnalysisMode>[];
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Epoch millis, or `null` for anything that does not parse — never a substituted "now". */
function instantOf(value: string | null | undefined): number | null {
  if (value == null) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Which bin a confidence falls in.
 *
 * `APP_CONFIG.admin.confidenceBins` is 20 so that both thresholds land exactly ON a bin edge
 * (0.45 × 20 = 9, 0.75 × 20 = 15), which is what stops a threshold rule from ever bisecting a
 * bar. 1.0 belongs to the last bin rather than to a 21st.
 */
function binOf(confidence: number, bins: number): number {
  const clamped = Math.min(1, Math.max(0, confidence));
  return Math.min(bins - 1, Math.floor(clamped * bins));
}

function landscapeOf(rows: readonly OfficerQueueRow[]): ConfidenceLandscapeView {
  const size = APP_CONFIG.admin.confidenceBins;
  const bins = new Array<number>(size).fill(0);
  const ticks: number[] = [];
  let unscored = 0;

  for (const row of rows) {
    if (!finite(row.topConfidence)) {
      unscored += 1;
      continue;
    }
    ticks.push(row.topConfidence);
    bins[binOf(row.topConfidence, size)] += 1;
  }

  let peakBin = -1;
  let peakCount = 0;
  for (const [index, count] of bins.entries()) {
    if (count > peakCount) {
      peakBin = index;
      peakCount = count;
    }
  }

  return { bins, peakBin, peakCount, ticks, scored: ticks.length, unscored };
}

function bandsOf(rows: readonly OfficerQueueRow[]): {
  bands: readonly BandTally[];
  unrouted: number;
} {
  const counts = new Map<DecisionPath, number>(BAND_ORDER.map((path) => [path, 0]));
  let unrouted = 0;

  for (const row of rows) {
    const path = row.decisionPath;
    // `undefined` is a real answer here: the server did not route this row. It is stated as a
    // count in text; inventing a fourth band for it would put a value on screen nobody sent.
    if (path === undefined || !counts.has(path)) unrouted += 1;
    else counts.set(path, (counts.get(path) ?? 0) + 1);
  }

  return {
    bands: BAND_ORDER.map((path) => ({ path, count: counts.get(path) ?? 0 })),
    unrouted,
  };
}

function cadenceOf(rows: readonly OfficerQueueRow[]): CadenceView {
  const stamps = rows
    .map((row) => instantOf(row.submittedAt))
    .filter((ms): ms is number => ms !== null);

  const counted = stamps.length;
  if (counted === 0) return { counted, fromMs: null, toMs: null, buckets: [], peakCount: 0 };

  const fromMs = Math.min(...stamps);
  const toMs = Math.max(...stamps);
  const span = toMs - fromMs;

  // Two honest refusals to draw: too few points for a shape, and a window with no width. Both
  // return the summary and no line at all, which is the only shape that cannot mislead.
  if (counted < APP_CONFIG.admin.cadenceMinRows || span <= 0) {
    return { counted, fromMs, toMs, buckets: [], peakCount: 0 };
  }

  const size = APP_CONFIG.admin.cadenceBuckets;
  const buckets = new Array<number>(size).fill(0);
  for (const ms of stamps) {
    buckets[Math.min(size - 1, Math.floor(((ms - fromMs) / span) * size))] += 1;
  }

  return { counted, fromMs, toMs, buckets, peakCount: Math.max(...buckets) };
}

function slaOf(rows: readonly OfficerQueueRow[], nowMs: number): SlaRunwayView {
  let overdue = 0;
  let dueSoon = 0;
  let onTime = 0;
  let unknown = 0;

  for (const row of rows) {
    const due = instantOf(row.slaDueAt);
    if (due === null) unknown += 1;
    else if (due < nowMs) overdue += 1;
    else if (due - nowMs <= APP_CONFIG.admin.slaDueSoonMs) dueSoon += 1;
    else onTime += 1;
  }

  return { overdue, dueSoon, onTime, unknown, asOfMs: nowMs };
}

function tally<T extends string>(
  rows: readonly OfficerQueueRow[],
  order: readonly T[],
  pick: (row: OfficerQueueRow) => T | undefined,
): readonly CompositionSlice<T>[] {
  const counts = new Map<T, number>(order.map((key) => [key, 0]));
  for (const row of rows) {
    const key = pick(row);
    if (key !== undefined && counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  // Every key in the union is kept, including the zeroes: a mix with a state missing from it
  // reads as "there are none of those", which is exactly what a zero segment says.
  return order.map((key) => ({ key, count: counts.get(key) ?? 0 }));
}

export function toQueueInsightView(
  page: PageOfOfficerQueueRow,
  nowMs: number,
): QueueInsightView {
  const rows = page.content;
  const { bands, unrouted } = bandsOf(rows);

  return {
    rowsLoaded: rows.length,
    totalElements: page.totalElements,
    confidence: landscapeOf(rows),
    bands,
    bandUnrouted: unrouted,
    cadence: cadenceOf(rows),
    sla: slaOf(rows, nowMs),
    states: tally(rows, STATE_ORDER, (row) => row.state),
    modes: tally(rows, MODE_ORDER, (row) => row.analysisMode),
  };
}
