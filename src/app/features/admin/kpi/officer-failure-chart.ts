import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, translate } from '@ngx-translate/core';
import { toPercentString } from '../../../core/util/percent';
import { ADMIN_PATHS } from './admin-paths';
import type { OfficerFailureView } from './kpi-summary.adapter';

/**
 * The **personal** half of the dashboard, and the only place a person's name appears beside a
 * failure count.
 *
 * Every bar is a RESOLUTION failure count: breaches on a case the officer had actually claimed.
 * Assignment breaches cannot reach this component — they have no officer, and the page keeps
 * them under a district heading of their own. There is deliberately no "unassigned" bar and no
 * residual bar here: a bar with a person's name on it is an accusation, so it only exists when
 * the server named that person.
 *
 * `WEB-UX-044` — the bar length is decoration. The count is text on every row, the accessible
 * name of the whole graphic states the top figures, and a row with no name shows the officer id
 * rather than an invented label.
 *
 * Hand-rolled CSS bars, not a chart library (`WEB-NFR-007`). Widths are percentage strings
 * computed from signals; nothing here measures layout.
 */
@Component({
  selector: 'foshol-officer-failure-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, RouterLink],
  templateUrl: './officer-failure-chart.html',
  styleUrl: './officer-failure-chart.css',
  host: { class: 'block', 'data-testid': 'officer-failure-chart' },
})
export class OfficerFailureChart {
  readonly officers = input<readonly OfficerFailureView[]>([]);
  /** Resolution breaches the server attached no officer to — a line, never a bar. */
  readonly unattributed = input(0);
  /** `WEB-FR-305` — the counts are the last that loaded, not the current ones. */
  readonly stale = input(false);
  /** The summary has loaded, so a zero row is a measured zero rather than a missing one. */
  readonly counted = input(false);

  /** The drill-down each row links to, filtered to that officer's own resolution breaches. */
  protected readonly breachesPath = ADMIN_PATHS.breaches;

  protected readonly rows = computed(() =>
    this.officers().map((officer) => ({
      ...officer,
      width: toPercentString(officer.share),
      /** The label the row shows: the server's name, or its id when it named nobody. */
      label: officer.officerName ?? officer.officerId,
      named: officer.officerName !== null,
    })),
  );

  protected readonly hasRows = computed(() => this.rows().length > 0);

  private readonly ariaText = translate('admin.kpi.officers.aria', () => {
    const rows = this.rows();
    const top = rows[0];
    return {
      officers: rows.length,
      topOfficer: top?.label ?? '',
      topCount: top?.resolutionFailures ?? 0,
    };
  });

  protected readonly ariaLabel = computed(() => String(this.ariaText()));
}
