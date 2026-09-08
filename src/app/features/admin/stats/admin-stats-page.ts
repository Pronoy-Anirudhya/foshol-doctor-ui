import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { toProblemView } from '../../../core/errors/problem';
import { StatsStore } from '../../../core/stores/stats-store';
import { AdminService } from '../../../generated/services/admin.service';
import { DhakaDateTimePipe } from '../../../shared/pipes/dhaka-date-time.pipe';
import { Percent1Pipe } from '../../../shared/pipes/percent1.pipe';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { ErrorPanel } from '../../../shared/ui/error-panel/error-panel';
import { PageHeading } from '../../../shared/ui/page-heading/page-heading';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { Spinner } from '../../../shared/ui/spinner/spinner';
import { toAdminStatsView } from '../admin-stats.adapter';
import { StatTile } from './stat-tile';
import { ThresholdTrack } from './threshold-track';

/**
 * `WEB-FR-300` — the entire admin surface: one read-only stats page.
 *
 * `WEB-FR-303` — **nothing on this page writes to the server.** There is no form, no input and
 * no control that sends anything but the `GET` behind the refresh. That is enforced by shape
 * rather than by care: the only injected API is `AdminService`, whose sole operation is
 * `getAdminStats`, and the page's spec asserts that every request the page can provoke is a
 * `GET` (AC-24).
 *
 * `WEB-FR-304` — the timestamp of the data on screen is displayed in Asia/Dhaka, and the
 * refresh is a button the administrator presses. There is deliberately **no timer**: polling an
 * endpoint is forbidden (`WEB-FR-356`), and a page that silently refetches makes the timestamp
 * beside it meaningless.
 *
 * `WEB-FR-305` — a failed load never blanks the page. `StatsStore` keeps the last successful
 * values and marks them stale, so the failure is shown *with* the numbers rather than instead
 * of them. This is the live path today, not a theoretical one: `/admin/stats` currently 500s
 * with a `ClassCastException` as soon as any rate is non-null (reported as a backend blocker).
 *
 * Nulls are the normal state of this endpoint, not a failure — see `StatTile`.
 */

/**
 * Presentation precision for the median, not a tunable threshold — cf.
 * `shared/pipes/percent1.pipe.ts`, which makes the same choice for percentages. There is no
 * server property behind it, so `WEB-NFR-009` has nothing to point it at.
 */
const MINUTE_DECIMALS = 1;
const MINUTE_FACTOR = 10 ** MINUTE_DECIMALS;

@Component({
  selector: 'foshol-admin-stats-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslatePipe,
    DhakaDateTimePipe,
    Percent1Pipe,
    PageHeading,
    ErrorPanel,
    EmptyState,
    Spinner,
    Skeleton,
    StatTile,
    ThresholdTrack,
  ],
  host: { class: 'block' },
  template: `
    <!-- A quiet echo of the slate console chrome below (the thresholds section), so the page
         opens with one deliberate mark rather than heading straight into body text. Kept as a
         thin accent rather than a full dark band behind the heading: PageHeading's own text
         colours assume the light surface and are shared by every routed page, so recolouring
         them for one dark wrapper here would mean forking the component for a purely
         decorative touch. -->
    <div class="mb-4 h-1.5 w-16 rounded-full bg-slate-800" aria-hidden="true"></div>

    <foshol-page-heading
      eyebrowKey="admin.stats.eyebrow"
      titleKey="admin.stats.title"
      subtitleKey="admin.stats.subtitle"
    >
      <span
        class="rounded-full border border-surface-3 bg-surface-0 px-3 py-1 text-xs font-semibold tracking-wide text-ink-muted uppercase"
        data-testid="read-only-chip"
        >{{ 'admin.stats.readOnly' | translate }}</span
      >

      <!-- WEB-FR-304 — the manual refresh. A GET, on a press, and nothing else. -->
      <button
        type="button"
        class="touch-target inline-flex items-center gap-2 rounded-xl bg-slate-800 px-4 font-semibold text-ink-invert shadow-stamp transition-colors duration-1 ease-settle hover:bg-slate-700"
        data-testid="refresh"
        [attr.aria-label]="'admin.stats.refreshAria' | translate"
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
        <!-- WEB-FR-305 — the values below are real, but they are not current. Saying so is the
             requirement; blanking them, or leaving them looking fresh, are both worse. -->
        <div
          class="mt-4 rounded-2xl border border-dawn-600 bg-dawn-100 p-4"
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

    @if (view(); as stats) {
      <div
        class="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4"
        [attr.data-stale]="store.stale() || null"
        data-testid="stat-grid"
      >
        <foshol-stat-tile
          kind="volume"
          labelKey="admin.stats.casesToday.label"
          hintKey="admin.stats.casesToday.hint"
          [stale]="store.stale()"
          [value]="stats.casesToday === null ? null : stats.casesToday.toString()"
        />
        <foshol-stat-tile
          kind="rate"
          labelKey="admin.stats.approvalRate.label"
          hintKey="admin.stats.approvalRate.hint"
          [stale]="store.stale()"
          [value]="
            stats.approvalRate === null
              ? null
              : ('admin.stats.percentValue' | translate: { value: stats.approvalRate | percent1 })
          "
        />
        <foshol-stat-tile
          kind="time"
          labelKey="admin.stats.medianReview.label"
          hintKey="admin.stats.medianReview.hint"
          [stale]="store.stale()"
          [value]="
            medianMinutes() === null
              ? null
              : ('admin.stats.minutesValue' | translate: { value: medianMinutes() })
          "
        />
        <!-- The sample size always travels with the agreement rate: a rate computed from two
             advisories is not a rate, and the count is the only honest way to say so. -->
        <foshol-stat-tile
          kind="agreement"
          labelKey="admin.stats.agreement.label"
          hintKey="admin.stats.agreement.hint"
          [stale]="store.stale()"
          [captionKey]="agreementCaptionKey()"
          [captionParams]="agreementCaptionParams()"
          [value]="
            stats.agreementRate === null
              ? null
              : ('admin.stats.percentValue' | translate: { value: stats.agreementRate | percent1 })
          "
        />
      </div>

      <!-- WEB-FR-302 — the routing thresholds, read-only, in the console chrome. -->
      <section class="mt-4 rounded-2xl bg-slate-800 p-5 shadow-card md:p-6">
        <div class="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
          <div class="min-w-0">
            <h2 class="text-lg font-semibold text-ink-invert">
              {{ 'admin.stats.thresholds.title' | translate }}
            </h2>
            <p class="mt-1 max-w-prose text-sm text-surface-3">
              {{ 'admin.stats.thresholds.subtitle' | translate }}
            </p>
          </div>
          <span
            class="rounded-full border border-surface-3 px-3 py-1 text-xs font-semibold tracking-wide text-ink-invert uppercase"
            >{{ 'admin.stats.readOnly' | translate }}</span
          >
        </div>

        <div class="mt-6">
          @if (stats.thresholds; as thresholds) {
            <foshol-threshold-track [low]="thresholds.low" [high]="thresholds.high" />
          } @else {
            <p class="text-sm text-ink-invert" data-testid="thresholds-unavailable">
              {{ 'admin.stats.thresholds.unavailable' | translate }}
            </p>
          }
        </div>

        <p class="mt-6 border-t border-slate-600 pt-4 text-sm text-surface-3">
          {{ 'admin.stats.thresholds.humanGate' | translate }}
        </p>
      </section>

      <p class="mt-4 text-xs text-ink-faint">{{ 'admin.stats.omitted' | translate }}</p>
    } @else if (store.loading()) {
      <div class="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        @for (placeholder of placeholders; track placeholder) {
          <foshol-skeleton class="card p-5" variant="text" [count]="3" />
        }
      </div>
    } @else if (problem() === null) {
      <foshol-empty-state
        class="mt-6"
        titleKey="admin.stats.empty.title"
        detailKey="admin.stats.empty.detail"
      />
    }
  `,
})
export class AdminStatsPage {
  private readonly admin = inject(AdminService);
  protected readonly store = inject(StatsStore);

  /** One per tile, so the loading state holds the shape the values will land in. */
  protected readonly placeholders = ['casesToday', 'approvalRate', 'medianReview', 'agreement'];

  /**
   * DEVIATIONS.md D-06 — the store holds the body the server sent, which is not the body the
   * frozen schema describes. Everything on screen reads the adapted view instead, so the
   * mismatch is resolved in exactly one place.
   */
  protected readonly view = computed(() => {
    const stats = this.store.stats();
    return stats === null ? null : toAdminStatsView(stats);
  });

  protected readonly problem = computed(() => {
    const error = this.store.error();
    return error === null ? null : toProblemView(error);
  });

  /** `StatsStore` records epoch milliseconds; the pipe renders the instant in Asia/Dhaka. */
  protected readonly loadedAt = computed(() => {
    const at = this.store.loadedAt();
    return at === null ? null : new Date(at);
  });

  protected readonly medianMinutes = computed(() => {
    const minutes = this.view()?.medianReviewMinutes ?? null;
    return minutes === null ? null : Math.round(minutes * MINUTE_FACTOR) / MINUTE_FACTOR;
  });

  private readonly agreementSample = computed(() => this.view()?.agreementSampleSize ?? null);

  protected readonly agreementCaptionKey = computed(() => {
    const sample = this.agreementSample();
    if (sample === null) return '';
    return sample > 0 ? 'admin.stats.agreement.sample' : 'admin.stats.agreement.noSample';
  });

  protected readonly agreementCaptionParams = computed(() => ({
    count: this.agreementSample(),
  }));

  constructor() {
    this.refresh();
  }

  /**
   * WEB-FR-304 — the manual refresh, and the only network call this page makes. `void` because
   * the store absorbs the failure into its own signals; nothing here has to decide what a
   * rejected promise means.
   */
  protected refresh(): void {
    void this.store.load(() => this.admin.getAdminStats());
  }
}
