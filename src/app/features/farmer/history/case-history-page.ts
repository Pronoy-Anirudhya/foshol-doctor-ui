import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  resource,
  signal,
} from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { APP_CONFIG } from '../../../core/config/app-config';
import { toProblemView } from '../../../core/errors/problem';
import { SseStore } from '../../../core/sse/sse-store';
import { CaseStatusStore } from '../../../core/stores/case-status-store';
import type { CaseStatus } from '../../../generated/models/case-status';
import type { FarmerCaseRow } from '../../../generated/models/farmer-case-row';
import { CasesService } from '../../../generated/services/cases.service';
import { DhakaDateTimePipe } from '../../../shared/pipes/dhaka-date-time.pipe';
import { BackLink } from '../../../shared/ui/back-link/back-link';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { ErrorPanel } from '../../../shared/ui/error-panel/error-panel';
import { Paginator } from '../../../shared/ui/paginator/paginator';
import { SecureImage } from '../../../shared/ui/secure-image/secure-image';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { FARMER_PATHS } from '../capture/farmer-paths';

/**
 * `WEB-FR-153` — the farmer's own cases, with crop name, status, submitted time and a
 * thumbnail where one exists.
 *
 * **Nothing here sorts.** "Newest first" is a property of the server's projection
 * (handover §7.2) and the rows are rendered in the order they arrived (`WEB-NFR-001`).
 *
 * This page is also the layout parent of the case status view: at `xl` the list sits beside
 * the open case, and below `xl` it steps aside so a 360 px screen shows one column
 * (`WEB-UX-030`…`032`).
 *
 * A row's status is patched from `CaseStatusStore` when an SSE frame is newer than the page
 * this client is holding — patched, never refetched, because a status frame must not cost a
 * request (`WEB-FR-353`, `WEB-FR-356`).
 */
const FIRST_PAGE = 0;

interface HistoryRow {
  readonly row: FarmerCaseRow;
  /** The row's status, or the newer one an SSE frame carried. */
  readonly status: CaseStatus;
}

/** `WEB-FR-153`'s statuses, in the order the status stepper already uses them elsewhere. */
const STATUS_FILTER_OPTIONS: readonly CaseStatus[] = [
  'SUBMITTED',
  'ANALYSING',
  'ANALYSED',
  'IN_REVIEW',
  'ADVISED',
  'REJECTED',
  'FAILED',
];

@Component({
  selector: 'foshol-case-history-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    TranslatePipe,
    BackLink,
    DhakaDateTimePipe,
    EmptyState,
    ErrorPanel,
    Paginator,
    SecureImage,
    Skeleton,
  ],
  host: { class: 'block' },
  templateUrl: './case-history-page.html',
})
export class CaseHistoryPage {
  private readonly cases = inject(CasesService);
  private readonly caseStatus = inject(CaseStatusStore);
  private readonly sse = inject(SseStore);

  private readonly _page = signal(FIRST_PAGE);
  private readonly _loadedAt = signal(0);
  private readonly _detailOpen = signal(false);

  protected readonly detailOpen = this._detailOpen.asReadonly();

  /** The capture surface owns its own URLs; this page links to them rather than re-typing. */
  protected readonly newCasePath = FARMER_PATHS.newCase;

  /**
   * Filtering and search happen client-side, over whatever page is loaded: `listMyCases` takes
   * only `page`/`size` (the OpenAPI contract is frozen — `WEB-API-001` forbids inventing a
   * `q=` or `status=` parameter it does not define). A filter widens the fetch to the server's
   * own maximum page size instead, so a search covers far more than the default 20 rows
   * without asking the server for anything it does not already support.
   */
  protected readonly searchText = signal('');
  protected readonly statusFilter = signal<CaseStatus | ''>('');
  protected readonly statusFilterOptions = STATUS_FILTER_OPTIONS;

  protected readonly filterActive = computed(
    () => this.searchText().trim().length > 0 || this.statusFilter() !== '',
  );

  private readonly casesResource = resource({
    params: () => ({
      page: this._page(),
      size: this.filterActive() ? APP_CONFIG.page.maxSize : APP_CONFIG.page.defaultSize,
    }),
    loader: async ({ params }) => {
      const page = await this.cases.listMyCases({ page: params.page, size: params.size });
      this._loadedAt.set(Date.now());
      return page;
    },
  });

  protected readonly loading = computed(() => this.casesResource.isLoading());
  protected readonly problem = computed(() => {
    const error = this.casesResource.error();
    return error === undefined ? null : toProblemView(error);
  });

  private readonly pageValue = computed(() =>
    this.casesResource.hasValue() ? this.casesResource.value() : null,
  );

  protected readonly rows = computed<readonly HistoryRow[]>(() => {
    const page = this.pageValue();
    if (page === null) return [];
    const loadedAt = this._loadedAt();
    return page.content.map((row) => {
      const entry = this.caseStatus.entryOf(row.caseId);
      return {
        row,
        status: entry !== null && entry.at >= loadedAt ? entry.status : row.status,
      };
    });
  });

  protected readonly isEmpty = computed(
    () => this.pageValue() !== null && this.rows().length === 0,
  );

  /**
   * `WEB-NFR-001` — filtering only ever hides rows, never reorders them: `rows()` above still
   * maps the server array in place, and this is a plain `.filter` over that same order.
   */
  protected readonly filteredRows = computed<readonly HistoryRow[]>(() => {
    const term = this.searchText().trim().toLowerCase();
    const status = this.statusFilter();
    return this.rows().filter((entry) => {
      if (status !== '' && entry.status !== status) return false;
      if (term === '') return true;
      const crop = entry.row.cropNameBn.toLowerCase();
      const disease = (entry.row.diseaseNameBn ?? '').toLowerCase();
      return crop.includes(term) || disease.includes(term);
    });
  });

  /** Cases exist, but none of them satisfy the current search/filter — distinct from "no cases
      submitted yet", which `isEmpty` above already covers with its own empty state. */
  protected readonly noMatches = computed(
    () => !this.isEmpty() && this.filterActive() && this.filteredRows().length === 0,
  );
  protected readonly pageIndex = computed(() => this.pageValue()?.page ?? FIRST_PAGE);
  protected readonly pageSize = computed(
    () => this.pageValue()?.size ?? APP_CONFIG.page.defaultSize,
  );
  protected readonly totalElements = computed(() => this.pageValue()?.totalElements ?? FIRST_PAGE);
  protected readonly totalPages = computed(() => this.pageValue()?.totalPages ?? FIRST_PAGE);

  /**
   * With no case open, the list gets the whole page to itself and grows into a card grid; the
   * instant a case opens, both computeds swap to a narrow list beside the detail pane, because
   * a 3-up grid squeezed into a 26rem column would be nonsensical (`WEB-UX-030`).
   */
  protected readonly gridClass = computed(() =>
    this.detailOpen()
      ? 'grid gap-6 xl:grid-cols-[26rem_minmax(0,1fr)] xl:items-start xl:gap-8'
      : 'grid gap-6',
  );
  /**
   * Beside an open case the list is capped and scrolls in its own right, so the column stops
   * growing to the height of the detail pane and a farmer can still scan cases without first
   * scrolling past the whole advisory (`WEB-UX-030`, `WEB-UX-032`).
   *
   * The `14rem` reserve assumes the chrome above and below the list at `xl`: the sticky app
   * header (~3.75rem), `main`'s `md:py-10` band (2.5rem top and bottom), the paginator pinned
   * beneath the scroll area (~3.75rem with its rule and margin) and a little breathing room.
   * Change that assumption — a taller header, say — and this is the one number to retune.
   *
   * The padding is not decoration: `overflow-y-auto` clips on every axis, so without it the
   * 3px focus ring (plus its 2px offset, `styles.css`) on the first, last and left edge of a
   * row would be sliced off exactly when a keyboard user needs to see it (`WEB-UX-041`).
   */
  protected readonly listClass = computed(() =>
    this.detailOpen()
      ? 'm-0 grid list-none gap-3 p-0 xl:max-h-[calc(100dvh-14rem)] xl:overflow-y-auto xl:overscroll-contain xl:py-1.5 xl:pl-1.5 xl:pr-2'
      : 'm-0 grid list-none gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3',
  );

  /**
   * The paginator stays *outside* the scrolling list on purpose: page controls that scroll away
   * with their own rows are unreachable exactly when someone has read to the bottom and wants
   * the next page. Beside an open case it gains a hairline so it reads as pinned beneath the
   * scroll area rather than as one more row inside it (`WEB-API-003` supplies the numbers).
   */
  protected readonly paginatorClass = computed(() =>
    this.detailOpen()
      ? 'mt-4 block xl:mt-3 xl:border-t xl:border-surface-3 xl:pt-3'
      : 'mt-4 block',
  );

  /** WEB-UX-044 — colour is never the only carrier of meaning; the status text stays in the pill. */
  protected statusPillClass(status: CaseStatus): string {
    if (status === 'ADVISED') return 'bg-paddy-100 text-paddy-700';
    if (status === 'REJECTED' || status === 'FAILED') return 'bg-clay-100 text-clay-700';
    return 'bg-dawn-100 text-dawn-700';
  }

  #seenResyncTick = this.sse.resyncTick();

  constructor() {
    // WEB-FR-358 — the stream reopened after a gap, so this list may have missed a transition.
    effect(() => {
      const tick = this.sse.resyncTick();
      if (tick === this.#seenResyncTick) return;
      this.#seenResyncTick = tick;
      this.casesResource.reload();
    });
  }

  protected goToPage(page: number): void {
    this._page.set(page);
  }

  protected setSearchText(value: string): void {
    this.searchText.set(value);
    this._page.set(FIRST_PAGE);
  }

  protected setStatusFilter(value: string): void {
    this.statusFilter.set(value as CaseStatus | '');
    this._page.set(FIRST_PAGE);
  }

  protected reload(): void {
    this.casesResource.reload();
  }

  protected setDetailOpen(open: boolean): void {
    this._detailOpen.set(open);
  }
}
