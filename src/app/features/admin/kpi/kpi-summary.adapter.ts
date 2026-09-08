import type { AdminKpiSummary } from '../../../generated/models/admin-kpi-summary';

/**
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *  THE ATTRIBUTION RULE, IN ONE PLACE
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `AdminKpiSummary` carries two totals and a list, and the difference between them is the whole
 * point of the dashboard:
 *
 *   • **`assignmentFailures` is a DISTRICT figure with no person attached.** An assignment
 *     breach happened while the case was still in the shared pool, so nobody had claimed it and
 *     nobody failed it individually. This adapter therefore exposes it as a district total and
 *     offers **no** way to divide it by officer — not a share, not a rate, not a placeholder
 *     row. Splitting a pool failure across the people who happened to be on shift that day is a
 *     false accusation, and this dashboard is about real staff.
 *
 *   • **`resolutionFailures` belongs to whoever held the live claim**, which is why `officers[]`
 *     carries resolution counts and nothing else. Those are the only figures that may appear in
 *     a personal breakdown.
 *
 * So `officers[]` is never derived, weighted or completed here — it is the server's list,
 * ordered for reading and nothing more (`WEB-NFR-001`).
 *
 * `unattributedResolutionFailures` is the one derived number, and it exists to stop the bar
 * chart from implying it is the whole story: when the district's `resolutionFailures` exceeds
 * the sum of `officers[]`, the remainder is resolution breaches the server did not attach a name
 * to. It is shown as its own line, never folded into someone's bar. A negative difference is
 * impossible under the contract and is clamped to zero rather than rendered, because a negative
 * count on screen is a bug report, not a figure.
 */

export interface OfficerFailureView {
  readonly officerId: string;
  /** `null` when the server named nobody — rendered as the id, never as an invented name. */
  readonly officerName: string | null;
  /** Resolution failures only. There is no assignment figure per officer, by design. */
  readonly resolutionFailures: number;
  /** 0…1 against the busiest officer's count, for bar length only. Never shown as a rate. */
  readonly share: number;
}

export interface KpiSummaryView {
  /** District-level. Never divided among people. */
  readonly assignmentFailures: number;
  /** The district's own resolution total, as the server reports it. */
  readonly resolutionFailures: number;
  /** Descending by count; the server's numbers, ordered for reading. */
  readonly officers: readonly OfficerFailureView[];
  /** The sum of `officers[]` — stated so the bars can be checked against the district total. */
  readonly attributedResolutionFailures: number;
  /** District resolution failures the server attached no officer to. */
  readonly unattributedResolutionFailures: number;
  /** Every count is zero. A *measured* zero, which is not the same as "no data" — see the page. */
  readonly allClear: boolean;
}



const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

const name = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

export function toKpiSummaryView(summary: AdminKpiSummary): KpiSummaryView {
  const assignmentFailures = count(summary.assignmentFailures);
  const resolutionFailures = count(summary.resolutionFailures);

  const rows = Array.isArray(summary.officers) ? summary.officers : [];
  const officers = rows
    .filter((row) => name(row?.officerId) !== null)
    .map((row) => ({
      officerId: String(row.officerId),
      officerName: name(row.officerName),
      resolutionFailures: count(row.resolutionFailures),
    }));

  const attributed = officers.reduce((total, row) => total + row.resolutionFailures, 0);
  const busiest = officers.reduce((max, row) => Math.max(max, row.resolutionFailures), 0);

  const ordered = [...officers]
    // Busiest first; ties fall back to the label so the order is stable between refreshes.
    .sort(
      (a, b) =>
        b.resolutionFailures - a.resolutionFailures ||
        (a.officerName ?? a.officerId).localeCompare(b.officerName ?? b.officerId),
    )
    .map((row) => ({
      ...row,
      share: busiest === 0 ? 0 : row.resolutionFailures / busiest,
    }));

  return {
    assignmentFailures,
    resolutionFailures,
    officers: ordered,
    attributedResolutionFailures: attributed,
    unattributedResolutionFailures: Math.max(0, resolutionFailures - attributed),
    allClear: assignmentFailures === 0 && resolutionFailures === 0,
  };
}
