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

@Component({
  selector: 'foshol-case-history-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    TranslatePipe,
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

  private readonly casesResource = resource({
    params: () => ({ page: this._page(), size: APP_CONFIG.page.defaultSize }),
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
  protected readonly listClass = computed(() =>
    this.detailOpen()
      ? 'm-0 grid list-none gap-3 p-0'
      : 'm-0 grid list-none gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3',
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

  protected reload(): void {
    this.casesResource.reload();
  }

  protected setDetailOpen(open: boolean): void {
    this._detailOpen.set(open);
  }
}
