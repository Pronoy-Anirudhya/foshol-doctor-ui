import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { toProblemView } from '../../../core/errors/problem';
import { AdminService } from '../../../generated/services/admin.service';
import { DhakaDateTimePipe } from '../../../shared/pipes/dhaka-date-time.pipe';
import { BackLink } from '../../../shared/ui/back-link/back-link';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { ErrorPanel } from '../../../shared/ui/error-panel/error-panel';
import { PageHeading } from '../../../shared/ui/page-heading/page-heading';
import { RegionChip } from '../../../shared/ui/region-chip/region-chip';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { Spinner } from '../../../shared/ui/spinner/spinner';
import { ADMIN_PATHS } from './admin-paths';
import { KpiCountTile } from './kpi-count-tile';
import { toKpiSummaryView } from './kpi-summary.adapter';
import { KpiSummaryStore } from './kpi-summary-store';
import { OfficerFailureChart } from './officer-failure-chart';

/**
 * The KPI dashboard — `GET /api/v1/admin/kpis`, read-only, on its own route.
 *
 * **Two halves, and the line between them is the whole design.**
 *
 *  1. *The district.* Assignment breaches happened while the case was still in the shared pool:
 *     no officer had claimed it, so no officer failed it. They appear under a district heading,
 *     as a district total, with the district named by `RegionChip` — a place, not a person.
 *     There is no name column, no blank name cell and no "unassigned officer" row anywhere near
 *     them, because each of those reads as an accusation against whoever was on shift.
 *  2. *The officers.* Resolution breaches belong to whoever held the live claim, and only those
 *     appear in a personal breakdown.
 *
 * **The district comes from the JWT.** The server scopes every figure here from the token, so
 * nothing on this page sends a district and there is no district control — a filter would imply
 * a national view exists, and none does.
 *
 * `WEB-FR-356` — query-based with a manual refresh, exactly like the stats page. No timer, no
 * SSE, no toast: the architecture lint forbids `setInterval` outright, and a dashboard that
 * silently refetched would make the "data as of" line beside it a lie.
 *
 * `WEB-FR-305` — a failed load keeps the last good values under a stale marker rather than
 * blanking the screen. The running backend is an older build whose KPI endpoints answer 500, so
 * this is the live path, not a theoretical one.
 *
 * `WEB-FR-303` — nothing here writes. Every control is a `GET` or a link.
 */
@Component({
  selector: 'foshol-admin-kpi-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [KpiSummaryStore],
  imports: [
    TranslatePipe,
    DhakaDateTimePipe,
    BackLink,
    PageHeading,
    RegionChip,
    ErrorPanel,
    EmptyState,
    Spinner,
    Skeleton,
    KpiCountTile,
    OfficerFailureChart,
  ],
  host: { class: 'block' },
  template: `
    <foshol-back-link
      class="mb-3"
      variant="console"
      [to]="paths.stats"
      labelKey="admin.kpi.backToStats"
    />

    <foshol-page-heading
      eyebrowKey="admin.stats.eyebrow"
      titleKey="admin.kpi.title"
      subtitleKey="admin.kpi.subtitle"
    >
      <span
        class="rounded-pill border border-surface-3 bg-surface-0 px-3 py-1 text-xs font-semibold tracking-wide text-ink-muted uppercase"
        data-testid="read-only-chip"
        >{{ 'admin.stats.readOnly' | translate }}</span
      >

      <!-- The scope of every number below, named rather than filtered for: the server reads the
           district from the JWT and there is no national admin. -->
      <foshol-region-chip />

      <button
        type="button"
        class="touch-target inline-flex items-center gap-2 rounded-control bg-console px-4 font-semibold text-on-console shadow-stamp transition-colors duration-1 ease-settle hover:bg-slate-700"
        data-testid="refresh"
        [attr.aria-label]="'admin.kpi.refreshAria' | translate"
        [disabled]="store.loading()"
        (click)="refresh()"
      >
        <svg viewBox="0 0 24 24" class="h-5 w-5" aria-hidden="true" fill="none">
          <path
            d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        {{ 'admin.stats.refresh' | translate }}
      </button>
    </foshol-page-heading>

    <p class="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
      <span data-testid="loaded-at">
        @if (loadedAt(); as at) {
          {{ 'admin.stats.updatedAt' | translate: { time: (at | dhakaDateTime) } }}
        } @else {
          {{ 'admin.stats.neverLoaded' | translate }}
        }
      </span>
      <foshol-spinner [active]="store.loading()" size="sm" />
    </p>

    @if (problem(); as failure) {
      @if (store.stale()) {
        <div
          class="mt-4 rounded-panel border border-warning bg-dawn-100 p-4"
          role="status"
          data-testid="stale-marker"
        >
          <p class="text-sm font-semibold text-dawn-700">
            {{ 'admin.stats.stale.title' | translate }}
          </p>
          <p class="mt-1 max-w-prose text-sm text-ink">
            {{ 'admin.stats.stale.detail' | translate }}
          </p>
        </div>
      }
      <foshol-error-panel class="mt-4" [problem]="failure" (retry)="refresh()" />
    }

    @if (view(); as kpis) {
      @if (kpis.allClear) {
        <!-- Both totals are zero AND the server said so. That is a result, not an absence, and
             it is worth saying in words that could not be confused with "we have no data". -->
        <p
          class="mt-4 rounded-panel border border-paddy-300 bg-paddy-50 px-4 py-3 text-sm text-paddy-800"
          role="status"
          data-testid="all-clear"
        >
          {{ 'admin.kpi.allClear' | translate }}
        </p>
      }

      <!-- ── The district half ───────────────────────────────────────────────────────────────
           An assignment breach has no owner, so it is never shown in a column beside a name.
           It gets its own section, headed by the district itself. -->
      <section class="mt-6" data-testid="district-section" aria-labelledby="kpi-district-heading">
        <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h2 id="kpi-district-heading" class="text-lg font-semibold text-ink">
            {{ 'admin.kpi.district.title' | translate }}
          </h2>
          <foshol-region-chip />
        </div>
        <p class="mt-1 max-w-prose text-sm text-ink-muted">
          {{ 'admin.kpi.district.detail' | translate }}
        </p>

        <foshol-kpi-count-tile
          class="mt-3 max-w-xl"
          kind="ASSIGNMENT"
          labelKey="admin.kpi.assignment.label"
          scopeKey="admin.kpi.assignment.scope"
          hintKey="admin.kpi.assignment.hint"
          [count]="kpis.assignmentFailures"
          [stale]="store.stale()"
        />
      </section>

      <!-- ── The personal half ───────────────────────────────────────────────────────────────
           Resolution breaches happened on a case an officer had claimed, so these are the only
           figures that may carry a name. The district total sits above the per-officer bars so
           the bars can be read against it — and any remainder the server named nobody for is
           stated as its own line rather than folded into somebody's bar. -->
      <section class="mt-8" data-testid="officer-section" aria-labelledby="kpi-officer-heading">
        <h2 id="kpi-officer-heading" class="text-lg font-semibold text-ink">
          {{ 'admin.kpi.personal.title' | translate }}
        </h2>
        <p class="mt-1 max-w-prose text-sm text-ink-muted">
          {{ 'admin.kpi.personal.detail' | translate }}
        </p>

        <foshol-kpi-count-tile
          class="mt-3 max-w-xl"
          kind="RESOLUTION"
          labelKey="admin.kpi.resolution.label"
          scopeKey="admin.kpi.resolution.scope"
          hintKey="admin.kpi.resolution.hint"
          [count]="kpis.resolutionFailures"
          [stale]="store.stale()"
        />

        <foshol-officer-failure-chart
          class="card mt-4 p-5"
          [officers]="kpis.officers"
          [unattributed]="kpis.unattributedResolutionFailures"
          [stale]="store.stale()"
          [counted]="true"
        />
      </section>
    } @else if (store.loading()) {
      <div class="mt-6 grid gap-4 md:grid-cols-2">
        @for (placeholder of placeholders; track placeholder) {
          <foshol-skeleton class="card p-5" variant="text" [count]="3" />
        }
      </div>
    } @else if (problem() === null) {
      <foshol-empty-state
        class="mt-6"
        titleKey="admin.kpi.empty.title"
        detailKey="admin.kpi.empty.detail"
      />
    }

    <p class="mt-4 text-xs text-ink-faint">{{ 'admin.kpi.footnote' | translate }}</p>
  `,
})
export class AdminKpiPage {
  private readonly admin = inject(AdminService);
  protected readonly store = inject(KpiSummaryStore);

  protected readonly paths = ADMIN_PATHS;
  /** One per tile, so the loading state holds the shape the values will land in. */
  protected readonly placeholders = ['assignment', 'resolution'];

  protected readonly view = computed(() => {
    const summary = this.store.summary();
    return summary === null ? null : toKpiSummaryView(summary);
  });

  protected readonly problem = computed(() => {
    const error = this.store.error();
    return error === null ? null : toProblemView(error);
  });

  protected readonly loadedAt = computed(() => {
    const at = this.store.loadedAt();
    return at === null ? null : new Date(at);
  });

  constructor() {
    this.refresh();
  }

  /** `WEB-FR-356` — the only network call this page makes, and only when pressed. */
  protected refresh(): void {
    void this.store.load(() => this.admin.getAdminKpis());
  }
}
