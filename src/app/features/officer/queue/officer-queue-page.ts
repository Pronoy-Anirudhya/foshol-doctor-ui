import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { SseStore } from '../../../core/sse/sse-store';
import type { QueueRowView } from '../../../core/stores/queue-store';
import type { OfficerQueueRow } from '../../../generated/models/officer-queue-row';
import { DhakaTimePipe } from '../../../shared/pipes/dhaka-time.pipe';
import { Percent1Pipe } from '../../../shared/pipes/percent1.pipe';
import { AnalysisModeBadge } from '../../../shared/ui/analysis-mode-badge/analysis-mode-badge';
import { DecisionPathBadge } from '../../../shared/ui/decision-path-badge/decision-path-badge';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { ErrorPanel } from '../../../shared/ui/error-panel/error-panel';
import { Icon } from '../../../shared/ui/icon/icon';
import { PageHeading } from '../../../shared/ui/page-heading/page-heading';
import { RegionChip } from '../../../shared/ui/region-chip/region-chip';
import { Paginator } from '../../../shared/ui/paginator/paginator';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { OfficerFacade } from '../officer-facade';
import { taskPath } from '../officer-paths';

/**
 * The officer queue — and, at `xl`, the left pane of the two-pane console.
 *
 * **`WEB-FR-200` is the requirement this screen exists to protect.** Rows render in exactly
 * the order the server returned them, and **no column header is interactive**: there is no
 * sort control, no clickable `<th>`, no comparator anywhere in this feature. `REVIEW-FR-030`
 * fixes the order to least-confident-first, and that ordering *is* the triage argument the
 * console demonstrates. A sortable header lets an officer — or a judge — destroy it in one
 * click, so the affordance does not exist. `QueueStore` exposes no comparator either; between
 * the two, the requirement cannot be violated by a later edit.
 *
 * `WEB-FR-202` — the sentence explaining the order sits next to the table, at the top, in the
 * reading path. It is the point of the screen, not a footnote.
 *
 * `WEB-FR-205` / `WEB-FR-356` — a manual refresh control at all times, and no polling timer.
 * The live path is SSE (`WEB-FR-204`, handled in `SseDispatcher` → `QueueStore.patchRow`);
 * this button is the degraded path when the stream is down.
 *
 * `WEB-UX-032` — stacked cards below `md`, a table at and above. A ten-column table at 360 px
 * is unreadable, and this console is used on a phone in the field as well as at a desk.
 */
const FIRST_PAGE = 0;

/** `officer.queue.state.*` already carries a label per value; this is just the value set. */
const STATE_FILTER_OPTIONS: readonly OfficerQueueRow['state'][] = [
  'PENDING',
  'CLAIMED',
  'DONE',
  'REJECTED',
];

@Component({
  selector: 'foshol-officer-queue-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AnalysisModeBadge,
    DecisionPathBadge,
    DhakaTimePipe,
    EmptyState,
    ErrorPanel,
    Icon,
    PageHeading,
    RegionChip,
    Paginator,
    Percent1Pipe,
    RouterLink,
    RouterOutlet,
    Skeleton,
    TranslatePipe,
  ],
  templateUrl: './officer-queue-page.html',
  styleUrl: './officer-queue-page.css',
  host: { class: 'block' },
})
export class OfficerQueuePage {
  protected readonly facade = inject(OfficerFacade);
  private readonly sse = inject(SseStore);

  /**
   * Set from the outlet's own `activate` / `deactivate` outputs rather than by reading the
   * URL. The router already knows whether a child is on screen; parsing `router.url` to
   * rediscover it would be a second, lagging source of truth.
   */
  protected readonly detailOpen = signal(false);

  protected readonly rows = computed<readonly QueueRowView[]>(() => this.facade.queue.view());

  /**
   * The state filter (`stateFilter`) is the server's own `GetReviewQueue$Params.state` doing
   * the filtering — see `OfficerFacade.loadQueue`. Free-text search has no server parameter to
   * ride on, so it runs client-side over whichever page is currently loaded, the same trade-off
   * `CaseHistoryPage` makes for the farmer's case list.
   */
  protected readonly searchText = signal('');
  protected readonly stateFilterOptions = STATE_FILTER_OPTIONS;
  protected readonly stateFilter = computed(() => this.facade.queue.stateFilter());

  protected readonly filteredRows = computed<readonly QueueRowView[]>(() => {
    const term = this.searchText().trim().toLowerCase();
    if (term === '') return this.rows();
    return this.rows().filter((view) => {
      const farmer = (view.row.farmerName ?? '').toLowerCase();
      const crop = (view.row.cropNameBn ?? '').toLowerCase();
      const disease = (view.row.topDiseaseNameBn ?? '').toLowerCase();
      return farmer.includes(term) || crop.includes(term) || disease.includes(term);
    });
  });

  protected readonly noMatches = computed(
    () => !this.facade.queue.isEmpty() && this.filteredRows().length === 0,
  );

  /**
   * Utility classes, not component CSS, so this screen's stylesheet stays inside the 4 kB
   * per-component budget the production build enforces. Tailwind scans TypeScript, so a class
   * string declared here is emitted exactly as one written in the template would be.
   */
  protected readonly refreshClass =
    'touch-target inline-flex items-center gap-2 rounded-xl bg-slate-800 px-4 text-sm font-semibold text-ink-invert shadow-stamp transition-colors duration-1 ease-settle hover:bg-slate-900 disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-ink-muted disabled:shadow-none';

  /**
   * At `xl` the console is two panes — queue left, case detail right (`WEB-UX-030`). With no
   * case open the queue takes the full width, which is what lets the full column set fit.
   */
  protected readonly gridClass = computed(() =>
    this.detailOpen()
      ? 'grid gap-5 xl:grid-cols-[minmax(0,33rem)_minmax(0,1fr)] xl:items-start'
      : 'grid gap-5',
  );

  private lastResyncTick = this.sse.resyncTick();

  constructor() {
    void this.facade.loadQueue(FIRST_PAGE);

    /**
     * `WEB-FR-358` — the stream reopened after a gap, so events were missed and the visible
     * view must not stay wrong. This is a refetch triggered by a connection event, not a
     * timer: nothing here fires while the stream is healthy (`WEB-FR-356`).
     */
    effect(() => {
      const tick = this.sse.resyncTick();
      if (tick === this.lastResyncTick) return;
      this.lastResyncTick = tick;
      void this.facade.loadQueue();
    });

    /**
     * `WEB-FR-204` — an event that would move a row re-fetches the CURRENT page, because the
     * only correct order is the one the server produces and this client owns no comparator.
     * `QueueStore.patchRow` already decided that: it returns false and marks the page stale
     * whenever the case left the queue or was never on this page.
     *
     * Marking stale is not enough on its own. Until this effect existed the console showed a
     * stale badge and waited for the officer to press refresh, which is a manual refresh
     * wearing a live update's clothes. Still not a timer: nothing fires while the stream is
     * healthy and no case changes state (`WEB-FR-356`).
     */
    effect(() => {
      if (!this.facade.queue.needsReload()) return;
      void this.facade.loadQueue();
    });
  }

  protected taskLink(row: QueueRowView): string {
    return taskPath(row.row.reviewTaskId);
  }

  protected refresh(): void {
    void this.facade.loadQueue();
  }

  protected goToPage(page: number): void {
    void this.facade.loadQueue(page);
  }

  protected setSearchText(value: string): void {
    this.searchText.set(value);
  }

  protected setStateFilter(value: string): void {
    void this.facade.setStateFilter(value === '' ? null : (value as OfficerQueueRow['state']));
  }

  /** Dynamic key rather than a switch: the four states come from the generated union. */
  protected stateKey(row: QueueRowView): string {
    return `officer.queue.state.${row.row.state}`;
  }

  protected statusKey(row: QueueRowView): string {
    return `badge.status.${row.liveStatus}`;
  }
}
