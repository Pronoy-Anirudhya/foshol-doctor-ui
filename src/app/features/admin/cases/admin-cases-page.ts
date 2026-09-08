import { ChangeDetectionStrategy, Component, effect, inject, input } from '@angular/core';
import { BackLink } from '../../../shared/ui/back-link/back-link';
import { PageHeading } from '../../../shared/ui/page-heading/page-heading';
import { ADMIN_PATHS } from '../kpi/admin-paths';
import { AdminCasesSection } from './admin-cases-section';
import { AdminCasesStore, type AdminCasesPeriod } from './admin-cases-store';

const VALID_PERIODS: ReadonlySet<string> = new Set(['TODAY', 'MONTH', 'YEAR', 'LIFETIME']);

/**
 * The case list's own route — moved out of the dashboard (`WEB-FR-300`) so a dense filterable
 * table and a stat-tile grid stop competing for the same screen. Reachable from the left nav.
 *
 * `period` arrives as a query param (`?period=TODAY`, set by the dashboard's volume tiles as a
 * plain `routerLink`) and seeds the store's initial filter — after that, every further filter
 * change is this page's own business, exactly as before the move.
 */
@Component({
  selector: 'foshol-admin-cases-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [AdminCasesStore],
  imports: [BackLink, PageHeading, AdminCasesSection],
  host: { class: 'block' },
  template: `
    <foshol-back-link class="mb-3" variant="console" [to]="statsPath" labelKey="admin.cases.backToDashboard" />

    <foshol-page-heading
      eyebrowKey="admin.stats.eyebrow"
      titleKey="admin.cases.title"
      subtitleKey="admin.cases.subtitle"
    />

    <foshol-admin-cases-section class="mt-6 block" />
  `,
})
export class AdminCasesPage {
  private readonly store = inject(AdminCasesStore);

  readonly period = input<string | undefined>();

  protected readonly statsPath = ADMIN_PATHS.stats;

  constructor() {
    effect(() => {
      const value = this.period();
      if (value !== undefined && VALID_PERIODS.has(value)) {
        this.store.setPeriod(value as AdminCasesPeriod);
      }
    });
  }
}
