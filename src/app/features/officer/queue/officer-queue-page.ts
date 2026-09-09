import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { SessionStore } from '../../../core/auth/session-store';
import { APP_CONFIG } from '../../../core/config/app-config';
import { LiveAnnouncer } from '../../../core/stores/live-announcer';
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
import { Paginator } from '../../../shared/ui/paginator/paginator';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { KpiClock } from '../kpi-clock';
import { KPI_ASSIGNMENT_KEY, KPI_RESOLUTION_KEY, OfficerFacade } from '../officer-facade';
import { QueueActionPanel } from './queue-action-panel';
import { QueueBulkBar } from './queue-bulk-bar';
import { QueueRowActions, type QueuePopoverKind } from './queue-row-actions';

/**
 * The officer queue — and, at `xl`, the left pane of the two-pane console.
 *
 * **`WEB-FR-200` is the requirement this screen exists to protect.** Rows render in exactly
 * the order the server returned them, and **no column header is interactive**: there is no
 * sort control, no clickable `<th>`, no comparator anywhere in this feature. The order is the
 * server's alone — **newest submission first**, as `officer.queue.orderNote` now says — and
 * this client neither reproduces it nor second-guesses it. A sortable header lets an officer —
 * or a judge — destroy it in one click, so the affordance does not exist. `QueueStore` exposes
 * no comparator either; between the two, the requirement cannot be violated by a later edit.
 *
 * That the rule itself is server-owned is why the strings could move ahead of the backend: the
 * UI never encoded the old least-confident-first rule in code, only in prose, so changing the
 * prose is the whole change. `DEVIATIONS.md` D-24.
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
const NONE = 0;

/** `officer.queue.state.*` already carries a label per value; this is just the value set. */
const STATE_FILTER_OPTIONS: readonly OfficerQueueRow['state'][] = [
  'PENDING',
  'CLAIMED',
  'DONE',
  'REJECTED',
];

/** The two review-task states from which nothing can be actioned — the case is already decided. */
const TERMINAL_STATES: readonly OfficerQueueRow['state'][] = ['DONE', 'REJECTED'];
const CLAIMED: OfficerQueueRow['state'] = 'CLAIMED';
const PENDING: OfficerQueueRow['state'] = 'PENDING';

/** `REVIEW-FR-098` — mirrors `foshol.review.bulk.max-size`; the server refuses more. */
const BULK_MAX = APP_CONFIG.review.bulkMaxSize;

/** The bulk bar's panels ride the same one-open-at-a-time channel as the rows' own. */
const BULK_ANCHOR = 'bulk';

/**
 * `<th>` count in the table below — select, farmer, crop, candidate, confidence, path, media,
 * submitted, farmer-wait SLA, officer KPI, state, actions. Only the confirm row's `colspan`
 * reads it.
 */
const COLUMN_COUNT = 12;

interface OpenPanel {
  /** A `reviewTaskId`, or `BULK_ANCHOR` for the bulk bar. */
  readonly anchor: string;
  readonly kind: QueuePopoverKind;
}

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
    KpiClock,
    PageHeading,
    Paginator,
    Percent1Pipe,
    QueueActionPanel,
    QueueBulkBar,
    QueueRowActions,
    RouterOutlet,
    Skeleton,
    TranslatePipe,
  ],
  templateUrl: './officer-queue-page.html',
  styleUrl: './officer-queue-page.css',
  host: {
    class: 'block',
    // One listener pair for the whole screen rather than one per row: every confirm panel
    // closes on Escape and on a click that lands outside any panel or its trigger.
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'closePanel()',
  },
})
export class OfficerQueuePage {
  protected readonly facade = inject(OfficerFacade);
  private readonly sse = inject(SseStore);
  private readonly session = inject(SessionStore);
  private readonly announcer = inject(LiveAnnouncer);

  /**
   * The instant every KPI clock on this screen is judged against.
   *
   * `WEB-FR-356` — deliberately NOT a ticking clock. `QueueStore.loadedAt` moves whenever the
   * page is (re)loaded — the manual refresh, an SSE-driven refetch, a finished bulk run — which
   * is exactly when the rows themselves change, and a second-by-second timer here would be a
   * poll of nothing wearing a countdown's clothes. The workspace, where the officer is actually
   * working a single case, has the claim timer's tick and gets a live one.
   */
  protected readonly now = computed(() => this.facade.queue.loadedAt() ?? Date.now());

  /**
   * `REVIEW-FR-090` / `REVIEW-FR-091` — which of the two operational clocks this row is on.
   * `PENDING` counts down to `assignmentDueAt`, `CLAIMED` to `resolutionDueAt`, and a decided
   * row counts down to nothing. Both fields are nullable and the running server omits them, so
   * `null` is the ordinary answer and renders no clock at all.
   */
  protected kpiDueAt(view: QueueRowView): string | null {
    if (view.row.state === PENDING) return view.row.assignmentDueAt ?? null;
    if (view.row.state === CLAIMED) return view.row.resolutionDueAt ?? null;
    return null;
  }

  protected kpiLabelKey(view: QueueRowView): string {
    return view.row.state === CLAIMED ? KPI_RESOLUTION_KEY : KPI_ASSIGNMENT_KEY;
  }

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
    () => !this.facade.queue.isEmpty() && this.filteredRows().length === NONE,
  );

  // ── Inline actions and selection ─────────────────────────────────────────────────────────

  /** Which confirm panel is open, anywhere on the screen. At most one, by construction. */
  protected readonly openPanel = signal<OpenPanel | null>(null);

  /** The expansion row spans the table; kept beside the header list it has to match. */
  protected readonly COLUMN_COUNT = COLUMN_COUNT;

  /** Selected `reviewTaskId`s. A Set, not an array: membership is the only question asked. */
  private readonly selectedIds = signal<ReadonlySet<string>>(new Set());

  /**
   * A row can be actioned when the case is not already decided and no OTHER officer holds the
   * claim. `WEB-NFR-001` — this reads the server's `state` and `officerId`; it does not model
   * claim expiry, which is the server's to decide and is re-checked by the claim call anyway.
   */
  protected canAction(view: QueueRowView): boolean {
    const row = view.row;
    if (TERMINAL_STATES.includes(row.state)) return false;
    if (row.state === CLAIMED) return (row.officerId ?? null) === this.session.subjectId();
    return true;
  }

  /**
   * Approve is offered only where there is a diagnosis to publish AND a name to show for it.
   * An `UNDETERMINED` case reaches the queue with no top disease at all, and an approve button
   * there would either send an empty advisory or publish something the officer never saw.
   */
  protected canApprove(view: QueueRowView): boolean {
    return this.canAction(view) && (view.row.topDiseaseNameBn ?? '') !== '';
  }

  protected lockedKey(view: QueueRowView): string {
    if (TERMINAL_STATES.includes(view.row.state)) return 'officer.queue.action.locked.decided';
    return 'officer.queue.action.locked.claimed';
  }

  protected readonly actionableRows = computed(() =>
    this.filteredRows().filter((view) => this.canAction(view)),
  );

  /** In the server's order, because it is a filter of the server's list (`WEB-FR-200`). */
  protected readonly selectedRows = computed(() =>
    this.actionableRows().filter((view) => this.selectedIds().has(view.row.reviewTaskId)),
  );

  /**
   * `REVIEW-FR-096` — bulk transfer moves LIVE claims, so the batch is exactly the selected
   * rows this officer already holds. A `PENDING` row is in the shared pool and is not something
   * to hand anybody; a row somebody else holds is not ours to move.
   */
  protected readonly transferableRows = computed(() =>
    this.selectedRows().filter(
      (view) =>
        view.row.state === CLAIMED && (view.row.officerId ?? null) === this.session.subjectId(),
    ),
  );

  /**
   * `REVIEW-FR-098` — the server refuses a batch over `foshol.review.bulk.max-size` with
   * `400 ERR_BULK_TOO_LARGE`, so the selection stops there and says why, rather than letting an
   * officer tick fifty-one boxes and then composing a request we know will be thrown away.
   */
  protected readonly bulkMax = BULK_MAX;
  protected readonly atBulkCap = computed(() => this.selectedRows().length >= BULK_MAX);

  protected readonly noneActionable = computed(() => this.actionableRows().length === NONE);
  protected readonly anySelected = computed(() => this.selectedRows().length > NONE);
  /** "All" means every row one request may carry, which is the cap when the page holds more. */
  protected readonly allSelected = computed(() => {
    const selectable = Math.min(this.actionableRows().length, BULK_MAX);
    return selectable > NONE && this.selectedRows().length === selectable;
  });
  protected readonly someSelected = computed(() => this.anySelected() && !this.allSelected());

  /** The bar survives the selection being cleared, so a finished run's report can be read. */
  protected readonly showBulkBar = computed(
    () => this.anySelected() || this.facade.bulk().total > NONE,
  );

  protected readonly bulkPanelKind = computed(() => {
    const open = this.openPanel();
    return open !== null && open.anchor === BULK_ANCHOR ? open.kind : null;
  });

  protected isSelected(view: QueueRowView): boolean {
    return this.selectedIds().has(view.row.reviewTaskId);
  }

  protected panelKind(view: QueueRowView): QueuePopoverKind | null {
    const open = this.openPanel();
    return open !== null && open.anchor === view.row.reviewTaskId ? open.kind : null;
  }

  protected togglePanel(anchor: string, kind: QueuePopoverKind): void {
    const open = this.openPanel();
    const same = open !== null && open.anchor === anchor && open.kind === kind;
    this.facade.clearRowActionProblem();
    this.openPanel.set(same ? null : { anchor, kind });
  }

  protected closePanel(): void {
    if (this.openPanel() === null) return;
    this.facade.clearRowActionProblem();
    this.openPanel.set(null);
  }

  protected onDocumentClick(event: Event): void {
    if (this.openPanel() === null) return;
    const target = event.target;
    // A click inside ANY panel or trigger is a click in the popover system; only a click that
    // lands outside all of them dismisses.
    if (target instanceof Element && target.closest('[data-popover-root]') !== null) return;
    this.closePanel();
  }

  protected toggleRow(view: QueueRowView): void {
    const taskId = view.row.reviewTaskId;
    if (!this.isSelected(view) && this.atBulkCap()) {
      // The box stays unticked, so the announcement is the only thing that explains why.
      this.announcer.announce('officer.queue.bulk.capReached', { max: BULK_MAX });
      return;
    }
    this.selectedIds.update((current) => {
      const next = new Set(current);
      if (!next.delete(taskId)) next.add(taskId);
      return next;
    });
  }

  /** `WEB-FR-201` — the loaded page only. Never the rows the server has not sent, and never
      more of them than one bulk request may carry (`REVIEW-FR-098`). */
  protected toggleAll(): void {
    if (this.allSelected()) {
      this.clearSelection();
      return;
    }
    const rows = this.actionableRows();
    // `slice` preserves the server's order; it is a cap on how many, never on which
    // (`WEB-FR-200` — nothing here compares two rows).
    this.selectedIds.set(new Set(rows.slice(NONE, BULK_MAX).map((view) => view.row.reviewTaskId)));
    if (rows.length > BULK_MAX) {
      this.announcer.announce('officer.queue.bulk.capReached', { max: BULK_MAX });
    }
  }

  protected clearSelection(): void {
    this.selectedIds.set(new Set());
  }

  /**
   * Utility classes, not component CSS, so this screen's stylesheet stays inside the 4 kB
   * per-component budget the production build enforces. Tailwind scans TypeScript, so a class
   * string declared here is emitted exactly as one written in the template would be.
   */
  protected readonly refreshClass =
    'touch-target inline-flex items-center gap-2 rounded-xl bg-slate-800 px-4 text-sm font-semibold text-ink-invert shadow-stamp transition-colors duration-1 ease-settle hover:bg-slate-900 disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-ink-muted disabled:shadow-none';

  /**
   * `WEB-UX-030` — the queue list and an open case's detail pane are never shown side by side;
   * whichever is active takes the full width of the console.
   */
  protected readonly gridClass = 'grid gap-5';

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

    /**
     * A selection that outlives the rows it was made from would submit cases the officer can no
     * longer see. Every fresh page is therefore intersected with what is now on screen — which
     * also drops the rows a bulk run has just taken out of an actionable state. The explicit
     * clears in the filter and paging handlers below cover the same ground earlier, before the
     * response arrives, so the bulk bar never sits there counting rows that are on their way out.
     */
    effect(() => {
      this.facade.queue.loadedAt();
      const present = new Set(untracked(this.rows).map((view) => view.row.reviewTaskId));
      this.selectedIds.update(
        (current) => new Set([...current].filter((taskId) => present.has(taskId))),
      );
      // A failed inline action reloads the queue (WEB-FR-243), and its problem is displayed
      // INSIDE the confirm panel — so closing the panel here would close the only place the
      // officer can read why it failed. The panel stays until they dismiss it themselves.
      if (untracked(this.facade.rowActionProblem) === null) this.openPanel.set(null);
    });
  }

  protected refresh(): void {
    void this.facade.loadQueue();
  }

  protected goToPage(page: number): void {
    this.startOver();
    void this.facade.loadQueue(page);
  }

  protected setSearchText(value: string): void {
    this.startOver();
    this.searchText.set(value);
  }

  protected setStateFilter(value: string): void {
    this.startOver();
    void this.facade.setStateFilter(value === '' ? null : (value as OfficerQueueRow['state']));
  }

  /** Any change to WHICH rows are on screen resets the selection and closes any open panel. */
  private startOver(): void {
    this.clearSelection();
    this.closePanel();
    this.facade.clearBulk();
  }

  /** Dynamic key rather than a switch: the four states come from the generated union. */
  protected stateKey(row: QueueRowView): string {
    return `officer.queue.state.${row.row.state}`;
  }

  protected statusKey(row: QueueRowView): string {
    return `badge.status.${row.liveStatus}`;
  }
}
