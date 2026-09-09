import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { toProblemView } from '../../../core/errors/problem';
import { AdminService } from '../../../generated/services/admin.service';
import { DhakaDateTimePipe } from '../../../shared/pipes/dhaka-date-time.pipe';
import { BackLink } from '../../../shared/ui/back-link/back-link';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { ErrorPanel } from '../../../shared/ui/error-panel/error-panel';
import { PageHeading } from '../../../shared/ui/page-heading/page-heading';
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
 *     no officer had claimed it, so no officer failed it. They appear under a district heading —
 *     a district total, a place rather than a person (the district itself is named once, in the
 *     header's account menu, not repeated on every page). There is no name column, no blank name
 *     cell and no "unassigned officer" row anywhere near them, because each of those reads as an
 *     accusation against whoever was on shift.
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

      <!-- ── Overview ─────────────────────────────────────────────────────────────────────────
           A headline strip so the reader never has to add the two halves together themselves.
           Purely a restatement of the figures below in bigger type — every number here is also
           printed, in full, in one of the two sections underneath. WEB-UX-044: the gradients
           are decoration, and the console-dark total card carries no meaning the text doesn't. -->
      <div class="mt-6 grid gap-4 sm:grid-cols-3" data-testid="kpi-hero">
        <div
          class="relative isolate overflow-hidden rounded-panel bg-gradient-to-br from-slate-800 to-slate-900 p-5 shadow-lift"
          data-testid="kpi-hero-total"
        >
          <svg
            viewBox="0 0 20 20"
            class="pointer-events-none absolute -top-4 -right-4 h-28 w-28 text-white/5"
            aria-hidden="true"
            fill="currentColor"
          >
            <path
              d="M10 1a9 9 0 1 0 .001 18.001A9 9 0 0 0 10 1Zm1 13.5H9v-2h2v2Zm0-3.5H9V5.5h2V11Z"
            />
          </svg>
          <p class="relative text-xs font-semibold tracking-wide text-on-console-muted uppercase">
            {{ 'admin.kpi.summary.totalLabel' | translate }}
          </p>
          <p
            class="relative mt-2 text-5xl leading-none font-bold text-on-console tabular-nums"
            data-testid="kpi-hero-total-value"
          >
            {{ kpis.assignmentFailures + kpis.resolutionFailures }}
          </p>
          <p class="relative mt-2 max-w-prose text-sm text-on-console-muted">
            {{ 'admin.kpi.summary.totalHint' | translate }}
          </p>
        </div>

        <div
          class="card flex flex-col gap-1 border-t-4 border-t-dawn-600 bg-gradient-to-br from-dawn-100/70 to-surface-0 p-5"
          data-testid="kpi-hero-district"
        >
          <p class="text-xs font-semibold tracking-wide text-dawn-700 uppercase">
            {{ 'admin.kpi.assignment.label' | translate }}
          </p>
          <p class="mt-2 text-4xl leading-none font-bold text-ink tabular-nums">
            {{ kpis.assignmentFailures }}
          </p>
          <p class="mt-2 text-sm text-ink-muted">{{ 'admin.kpi.district.title' | translate }}</p>
        </div>

        <div
          class="card flex flex-col gap-1 border-t-4 border-t-clay-600 bg-gradient-to-br from-clay-100/70 to-surface-0 p-5"
          data-testid="kpi-hero-officer"
        >
          <p class="text-xs font-semibold tracking-wide text-clay-700 uppercase">
            {{ 'admin.kpi.resolution.label' | translate }}
          </p>
          <p class="mt-2 text-4xl leading-none font-bold text-ink tabular-nums">
            {{ kpis.resolutionFailures }}
          </p>
          <p class="mt-2 text-sm text-ink-muted">{{ 'admin.kpi.personal.title' | translate }}</p>
        </div>
      </div>

      <!-- The two halves, side by side once there is room for it — a narrow district column next
           to the wider officer breakdown, so the page uses the console's full width instead of
           stacking two half-width-looking blocks down a single left-hand column. -->
      <!--
        A row subgrid is what keeps the two halves in step. Each section spans the same three
        rows — heading, intro, figures — so the intro paragraphs share a row and the taller one
        sets its height for both. Before this the sections were independent block flows, and
        because the district intro wraps to more lines in a 24rem column than the officer intro
        does in a wide one, the two tiles started at different heights. A zero row gap at xl
        hands the vertical rhythm back to the margin utilities inside, so spacing is unchanged.
      -->
      <div
        class="mt-8 grid gap-6 xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] xl:grid-rows-[auto_auto_1fr] xl:gap-y-0"
      >
        <!-- ── The district half ─────────────────────────────────────────────────────────────
             An assignment breach has no owner, so it is never shown in a column beside a name.
             It gets its own section, headed by the district itself. -->
        <section
          class="xl:grid xl:grid-rows-subgrid xl:row-span-3"
          data-testid="district-section"
          aria-labelledby="kpi-district-heading"
        >
          <h2 id="kpi-district-heading" class="text-lg font-semibold text-ink">
            {{ 'admin.kpi.district.title' | translate }}
          </h2>
          <p class="mt-1 max-w-prose text-sm text-ink-muted">
            {{ 'admin.kpi.district.detail' | translate }}
          </p>

          <div>
            <foshol-kpi-count-tile
              class="mt-3"
              kind="ASSIGNMENT"
              labelKey="admin.kpi.assignment.label"
              scopeKey="admin.kpi.assignment.scope"
              hintKey="admin.kpi.assignment.hint"
              [count]="kpis.assignmentFailures"
              [stale]="store.stale()"
            />
          </div>
        </section>

        <!-- ── The personal half ─────────────────────────────────────────────────────────────
             Resolution breaches happened on a case an officer had claimed, so these are the only
             figures that may carry a name. The district total sits above the per-officer bars so
             the bars can be read against it — and any remainder the server named nobody for is
             stated as its own line rather than folded into somebody's bar. -->
        <section
          class="xl:grid xl:grid-rows-subgrid xl:row-span-3"
          data-testid="officer-section"
          aria-labelledby="kpi-officer-heading"
        >
          <h2 id="kpi-officer-heading" class="text-lg font-semibold text-ink">
            {{ 'admin.kpi.personal.title' | translate }}
          </h2>
          <p class="mt-1 max-w-prose text-sm text-ink-muted">
            {{ 'admin.kpi.personal.detail' | translate }}
          </p>

          <div>
            <foshol-kpi-count-tile
              class="mt-3"
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
          </div>
        </section>
      </div>
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
