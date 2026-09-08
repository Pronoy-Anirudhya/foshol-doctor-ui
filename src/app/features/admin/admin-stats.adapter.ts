import { APP_CONFIG } from '../../core/config/app-config';
import type { AdminStats } from '../../generated/models/admin-stats';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  THE ONE PLACE THE LIVE `/admin/stats` BODY IS RECONCILED WITH THE CONTRACT
 *  See DEVIATIONS.md **D-06** and LIVE-API-NOTES.md "Divergence 2".
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The frozen schema still lists a handful of names the live server never sends
 *   (`medianReviewSeconds`, `modelOfficerAgreementRate`, `advisoriesPublished`, `casesRejected`,
 *   `pathCounts`, `thresholds:{high,low}`), while the running server's `AdminStatsView` sends
 *   exactly `{casesToday, casesThisMonth, casesThisYear, casesLifetime, approvalRate,
 *   medianReviewMinutes, agreementRate, agreementSampleSize, rejectionRate, confidenceHigh,
 *   confidenceLow}` (11 fields, frontend-demo-api.md §9). This adapter binds to that wire shape.
 *
 * Three differences matter and are handled here rather than in the page:
 *   1. **`medianReviewMinutes` is a different UNIT from `medianReviewSeconds`.** Reading the
 *      contract's name off the live body would render minutes as seconds — a 60× error stated
 *      with a straight face. Both are accepted; seconds are converted once, here.
 *   2. `agreementRate` / `modelOfficerAgreementRate` are the same quantity under two names.
 *   3. The thresholds arrive flat (`confidenceLow`/`confidenceHigh`) rather than nested. Both
 *      shapes are read, so the page keeps working if the backend is later reconciled with the
 *      contract — which is the whole reason this is an adapter and not a rename.
 *
 * `advisoriesPublished`, `casesRejected` and `pathCounts` are absent from the live body and are
 * deliberately NOT modelled: a field the server never sends must not appear on screen at all.
 * Showing `0` for a number nobody measured is a lie about the system (`WEB-NFR-001`).
 *
 * Every field is nullable in the view, because `null` is the NORMAL state of this endpoint
 * before there is data — not an error. The page renders "not enough data yet" for a `null`
 * and never a zero.
 *
 * The single `unknown` cast below is the seam. It is contained to this file, and it is what
 * `DEVIATIONS.md` D-06 promises to delete once server and schema agree.
 */

export interface AdminThresholdsView {
  /** `foshol.analysis.confidence.low`, over 0…1 (`WEB-FR-302`). */
  readonly low: number;
  /** `foshol.analysis.confidence.high`, over 0…1 (`WEB-FR-302`). */
  readonly high: number;
}

export interface AdminStatsView {
  readonly casesToday: number | null;
  readonly casesThisMonth: number | null;
  readonly casesThisYear: number | null;
  readonly casesLifetime: number | null;
  readonly approvalRate: number | null;
  /** Share of terminal review tasks in the district whose state is REJECTED. */
  readonly rejectionRate: number | null;
  /** Minutes, whichever unit the server used to say it. */
  readonly medianReviewMinutes: number | null;
  readonly agreementRate: number | null;
  /**
   * How many published advisories the agreement rate was computed from. A rate over two cases
   * is not a rate, so the page always states this count beside the number it qualifies.
   */
  readonly agreementSampleSize: number | null;
  /** `null` only if the server sent neither shape — never a hard-coded fallback pair. */
  readonly thresholds: AdminThresholdsView | null;
}

/** The live body, named as the server actually names it. */
interface LiveAdminStatsBody {
  readonly casesToday?: unknown;
  readonly casesThisMonth?: unknown;
  readonly casesThisYear?: unknown;
  readonly casesLifetime?: unknown;
  readonly approvalRate?: unknown;
  readonly rejectionRate?: unknown;
  readonly medianReviewMinutes?: unknown;
  readonly medianReviewSeconds?: unknown;
  readonly agreementRate?: unknown;
  readonly modelOfficerAgreementRate?: unknown;
  readonly agreementSampleSize?: unknown;
  readonly confidenceHigh?: unknown;
  readonly confidenceLow?: unknown;
  readonly thresholds?: unknown;
}

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * Flat `confidenceLow`/`confidenceHigh` first, because that is what the server sends today;
 * the contract's nested `thresholds` object second. A pair is only returned when BOTH values
 * are present — half a threshold pair cannot draw the routing story, and a bar carrying one
 * real line and one invented one is worse than no bar at all (`WEB-NFR-011`).
 */
function thresholdsOf(body: LiveAdminStatsBody): AdminThresholdsView | null {
  const nested = record(body.thresholds);
  const low = num(body.confidenceLow) ?? num(nested?.['low']);
  const high = num(body.confidenceHigh) ?? num(nested?.['high']);
  return low === null || high === null ? null : { low, high };
}

/** Minutes as sent, else the contract's seconds converted once. */
function medianMinutesOf(body: LiveAdminStatsBody): number | null {
  const minutes = num(body.medianReviewMinutes);
  if (minutes !== null) return minutes;
  const seconds = num(body.medianReviewSeconds);
  return seconds === null ? null : seconds / APP_CONFIG.ui.secondsPerMinute;
}

export function toAdminStatsView(stats: AdminStats): AdminStatsView {
  // The seam (DEVIATIONS.md D-06): the generated type describes the contract, not the wire.
  const body = stats as unknown as LiveAdminStatsBody;
  return {
    casesToday: num(body.casesToday),
    casesThisMonth: num(body.casesThisMonth),
    casesThisYear: num(body.casesThisYear),
    casesLifetime: num(body.casesLifetime),
    approvalRate: num(body.approvalRate),
    rejectionRate: num(body.rejectionRate),
    medianReviewMinutes: medianMinutesOf(body),
    agreementRate: num(body.agreementRate) ?? num(body.modelOfficerAgreementRate),
    agreementSampleSize: num(body.agreementSampleSize),
    thresholds: thresholdsOf(body),
  };
}
