import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { APP_CONFIG } from '../../../core/config/app-config';
import { toProblemView } from '../../../core/errors/problem';
import { QueueSampleStore } from '../../../core/stores/queue-sample-store';
import { StatsStore } from '../../../core/stores/stats-store';
import { AdminService } from '../../../generated/services/admin.service';
import { ReviewService } from '../../../generated/services/review.service';
import { DhakaDateTimePipe } from '../../../shared/pipes/dhaka-date-time.pipe';
import { Percent1Pipe } from '../../../shared/pipes/percent1.pipe';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { ErrorPanel } from '../../../shared/ui/error-panel/error-panel';
import { PageHeading } from '../../../shared/ui/page-heading/page-heading';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { Spinner } from '../../../shared/ui/spinner/spinner';
import { toAdminStatsView } from '../admin-stats.adapter';
import { toQueueInsightView } from '../queue-insight.adapter';
import { ConfidenceLandscape } from './confidence-landscape';
import { QueueComposition } from './queue-composition';
import { SlaRunway } from './sla-runway';
import { StatTile } from './stat-tile';
import { SubmissionCadence } from './submission-cadence';

/**
 * `WEB-FR-300` — the entire admin surface: one read-only stats page.
 *
 * `WEB-FR-303` — **nothing on this page writes to the server.** There is no form, no input and
 * no control that sends anything but the two `GET`s behind the refresh. That is enforced by
 * shape rather than by care: the only injected APIs are `AdminService.getAdminStats` and
 * `ReviewService.getReviewQueue`, and the page's spec asserts that every request the page can
 * provoke is a `GET` (AC-24).
 *
 * `WEB-FR-304` — the timestamp of the data on screen is displayed in Asia/Dhaka, and the
 * refresh is a button the administrator presses. There is deliberately **no timer**: polling an
 * endpoint is forbidden (`WEB-FR-356`), and a page that silently refetches makes the timestamp
 * beside it meaningless. The SLA runway's "now" is the same one-shot sample, for the same
 * reason.
 *
 * `WEB-FR-305` — a failed load never blanks the page. Both stores keep their last successful
 * values and mark them stale, so a failure is shown *with* the numbers rather than instead of
 * them. This is the live path today, not a theoretical one: `/admin/stats` currently 500s with a
 * `ClassCastException` as soon as any rate is non-null (reported as a backend blocker).
 *
 * **Why two stores and two endpoints.** `/admin/stats` returns six scalars and the frozen
 * contract has no time-series endpoint at all, so everything with shape in it is derived from
 * ONE page of `/review/queue` (which an ADMIN token may read). They are held in two independent
 * stores so that either endpoint failing leaves the other's widgets standing — and every number
 * derived from the queue states the size of the sample it came from, because a page is not a
 * census (`WEB-NFR-001`).
 *
 * Nulls are the normal state of the stats endpoint, not a failure — see `StatTile`.
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
    ConfidenceLandscape,
    SubmissionCadence,
    SlaRunway,
    QueueComposition,
  ],
  host: { class: 'block' },
  template: `
    <!-- A quiet echo of the console chrome below (the confidence landscape), so the page opens
         with one deliberate mark rather than heading straight into body text. -->
    <div class="mb-4 h-1.5 w-16 rounded-pill bg-console" aria-hidden="true"></div>

    <foshol-page-heading
      eyebrowKey="admin.stats.eyebrow"
      titleKey="admin.stats.title"
      subtitleKey="admin.stats.subtitle"
    >
      <span
        class="rounded-pill border border-surface-3 bg-surface-0 px-3 py-1 text-xs font-semibold tracking-wide text-ink-muted uppercase"
        data-testid="read-only-chip"
        >{{ 'admin.stats.readOnly' | translate }}</span
      >

      <!-- WEB-FR-304 — the manual refresh. Two GETs, on a press, and nothing else. -->
      <button
        type="button"
        class="touch-target inline-flex items-center gap-2 rounded-control bg-console px-4 font-semibold text-on-console shadow-stamp transition-colors duration-1 ease-settle hover:bg-slate-700"
        data-testid="refresh"
        [attr.aria-label]="'admin.stats.refreshAria' | translate"
        [disabled]="loading()"
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
      <foshol-spinner [active]="loading()" size="sm" />
    </p>

    @if (problem(); as failure) {
      @if (store.stale()) {
        <!-- WEB-FR-305 — the values below are real, but they are not current. Saying so is the
             requirement; blanking them, or leaving them looking fresh, are both worse. -->
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

    @if (queueUnavailable()) {
      <!-- One line, once: the queue-derived widgets below say what they could not draw, and
           this says why. The stats above are unaffected — that is what two stores buy. -->
      <p
        class="mt-4 rounded-panel border border-surface-3 bg-surface-1 px-4 py-3 text-sm text-ink-muted"
        role="status"
        data-testid="queue-unavailable"
      >
        {{ 'admin.queue.unavailable' | translate }}
      </p>
    }

    <!-- WEB-FR-302 — the routing thresholds, read-only, drawn over the confidences they routed. -->
    <section class="mt-4 rounded-panel bg-console-deep p-5 shadow-card md:p-6">
      @if (thresholds(); as pair) {
        <foshol-confidence-landscape
          [low]="pair.low"
          [high]="pair.high"
          [landscape]="insight()?.confidence ?? null"
          [tallies]="insight()?.bands ?? null"
          [unrouted]="insight()?.bandUnrouted ?? 0"
          [rowsLoaded]="sample.rowsLoaded()"
          [totalElements]="sample.totalElements()"
        />
      } @else {
        <h2 class="text-lg font-semibold text-on-console">
          {{ 'admin.stats.thresholds.title' | translate }}
        </h2>
        <p class="mt-1 max-w-prose text-sm text-on-console-muted">
          {{ 'admin.stats.thresholds.subtitle' | translate }}
        </p>
        <!-- Without both values there is no scale to draw on, and one real line beside one
             invented one is worse than no line at all (WEB-NFR-011). -->
        <p class="mt-4 text-sm text-on-console" data-testid="thresholds-unavailable">
          {{ 'admin.stats.thresholds.unavailable' | translate }}
        </p>
        <p class="mt-4 text-sm text-on-console-muted">
          {{ 'admin.stats.thresholds.low' | translate }} ·
          {{ 'admin.stats.thresholds.high' | translate }}
        </p>
      }
    </section>

    <div class="mt-4 grid gap-4 xl:grid-cols-2">
      <foshol-sla-runway class="card p-5" [sla]="insight()?.sla ?? null" />
      <foshol-submission-cadence
        class="card p-5"
        [cadence]="insight()?.cadence ?? null"
        [rowsLoaded]="sample.rowsLoaded()"
        [totalElements]="sample.totalElements()"
      />
    </div>

    <foshol-queue-composition
      class="card mt-4 p-5"
      [states]="insight()?.states ?? []"
      [modes]="insight()?.modes ?? []"
      [rowsLoaded]="sample.rowsLoaded()"
    />

    <p class="mt-4 text-xs text-ink-faint">{{ 'admin.stats.omitted' | translate }}</p>
  `,
})
export class AdminStatsPage {
  private readonly admin = inject(AdminService);
  private readonly review = inject(ReviewService);
  protected readonly store = inject(StatsStore);
  protected readonly sample = inject(QueueSampleStore);

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

  protected readonly thresholds = computed(() => this.view()?.thresholds ?? null);

  /**
   * The queue-derived widgets. `loadedAt` is the "now" the SLA banding is measured against, so
   * the banding is a property of the sample rather than of when the reader happens to look — and
   * the widget states that time on screen (`WEB-FR-356`: no timer, so say when).
   */
  protected readonly insight = computed(() => {
    const page = this.sample.page();
    if (page === null) return null;
    return toQueueInsightView(page, this.sample.loadedAt() ?? Date.now());
  });

  protected readonly problem = computed(() => {
    const error = this.store.error();
    return error === null ? null : toProblemView(error);
  });

  /** The queue failed AND has nothing to fall back on; a stale sample still draws. */
  protected readonly queueUnavailable = computed(
    () => this.sample.error() !== null && !this.sample.hasPage(),
  );

  protected readonly loading = computed(() => this.store.loading() || this.sample.loading());

  /** The older of the two stamps, so "data as of" is never newer than the oldest thing shown. */
  protected readonly loadedAt = computed(() => {
    const stamps = [this.store.loadedAt(), this.sample.loadedAt()].filter(
      (at): at is number => at !== null,
    );
    return stamps.length === 0 ? null : new Date(Math.min(...stamps));
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
   * WEB-FR-304 — the manual refresh, and the only network calls this page makes. Both are
   * fired, neither is awaited by the other: the two stores absorb their own failures, so one
   * endpoint being down cannot stop the other's widgets from drawing (`WEB-FR-305`).
   */
  protected refresh(): void {
    void this.store.load(() => this.admin.getAdminStats());
    void this.sample.load(() =>
      this.review.getReviewQueue({
        page: APP_CONFIG.admin.samplePage,
        size: APP_CONFIG.admin.sampleSize,
      }),
    );
  }
}
