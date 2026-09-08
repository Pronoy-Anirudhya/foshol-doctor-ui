import { computed, Injectable, signal } from '@angular/core';
import { APP_CONFIG } from '../../../core/config/app-config';
import type { OfficerQueueRow } from '../../../generated/models/officer-queue-row';
import type { PageOfOfficerQueueRow } from '../../../generated/models/page-of-officer-queue-row';

const FIRST_PAGE = 0;
const NONE = 0;

export type AdminCasesPeriod = 'TODAY' | 'MONTH' | 'YEAR' | 'LIFETIME';
export type AdminCasesState = 'PENDING' | 'CLAIMED' | 'DONE' | 'REJECTED' | 'ALL';
export type AdminCasesKpi = 'ASSIGNMENT' | 'RESOLUTION';
export type AdminCasesDecisionPath = 'PRIMARY' | 'SECONDARY' | 'UNDETERMINED';

export interface AdminCasesFilters {
  readonly period: AdminCasesPeriod;
  readonly state: AdminCasesState;
  readonly kpi: AdminCasesKpi | null;
  readonly officerId: string | null;
  readonly cropCode: string | null;
  readonly decisionPath: AdminCasesDecisionPath | null;
  readonly resubmission: boolean | null;
  readonly page: number;
}

const DEFAULT_FILTERS: AdminCasesFilters = {
  period: 'LIFETIME',
  state: 'ALL',
  kpi: null,
  officerId: null,
  cropCode: null,
  decisionPath: null,
  resubmission: null,
  page: FIRST_PAGE,
};

/** Rows a selection may ever contain — a terminal case cannot be bulk-rejected. */
const SELECTABLE_STATES: ReadonlySet<string> = new Set(['PENDING', 'CLAIMED']);

/**
 * `GET /api/v1/admin/cases` — one page of `OfficerQueueRow`, district-scoped by the JWT
 * (`WEB-API-001`: never a `district` query parameter). Component-scoped, like `KpiBreachStore` —
 * an administrator's district and current selection must die with the route, not survive into
 * the next admin's session.
 *
 * Filters live here rather than on the page so a volume tile on the dashboard (a sibling of the
 * component that owns the table) can set `period` and have the table react, without either side
 * knowing about the generated client — the fetch itself is still supplied by the caller
 * (`load()`), never injected, matching every other store in this codebase.
 *
 * `WEB-FR-305` — a failed load keeps the last page and marks it stale rather than emptying the
 * table. `WEB-FR-308` — the server's `submittedAt DESC` order is never re-sorted here.
 */
@Injectable()
export class AdminCasesStore {
  private readonly _filters = signal<AdminCasesFilters>(DEFAULT_FILTERS);
  private readonly _page = signal<PageOfOfficerQueueRow | null>(null);
  private readonly _loadedAt = signal<number | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<unknown>(null);
  private readonly _selectedIds = signal<ReadonlySet<string>>(new Set());

  readonly filters = this._filters.asReadonly();
  readonly page = this._page.asReadonly();
  readonly loadedAt = this._loadedAt.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly selectedIds = this._selectedIds.asReadonly();

  readonly hasPage = computed(() => this._page() !== null);
  readonly stale = computed(() => this._error() !== null && this._page() !== null);

  readonly rows = computed(() => this._page()?.content ?? []);

  /** The rows a bulk reject may ever include — never `DONE`/`REJECTED`. */
  readonly selectableRows = computed(() =>
    this.rows().filter((row) => SELECTABLE_STATES.has(row.state)),
  );

  readonly selectedRows = computed(() =>
    this.rows().filter((row) => this._selectedIds().has(row.reviewTaskId)),
  );

  readonly atCap = computed(
    () => this.selectedRows().length >= APP_CONFIG.review.bulkMaxSize,
  );

  readonly allSelected = computed(() => {
    const selectable = Math.min(this.selectableRows().length, APP_CONFIG.review.bulkMaxSize);
    return selectable > NONE && this.selectedRows().length === selectable;
  });

  readonly someSelected = computed(
    () => this.selectedRows().length > NONE && !this.allSelected(),
  );

  /** A claim held by someone else can fail bulk-reject with `ERR_CLAIM_CONFLICT` — said up front. */
  readonly hasClaimedSelected = computed(() =>
    this.selectedRows().some((row) => row.state === 'CLAIMED'),
  );

  /**
   * Whether a single row could ever join the selection — the same test `selectableRows` filters
   * the page by. The table renders a checkbox for every row (not only the selectable ones) and
   * uses this to decide which are `disabled`, so a terminal `DONE`/`REJECTED` row visibly cannot
   * be picked instead of just silently having no control at all.
   */
  isSelectable(row: OfficerQueueRow): boolean {
    return SELECTABLE_STATES.has(row.state);
  }

  async load(fetcher: () => Promise<PageOfOfficerQueueRow>, at: () => number = Date.now): Promise<void> {
    this._loading.set(true);
    try {
      const page = await fetcher();
      this._page.set(page);
      this._loadedAt.set(at());
      this._error.set(null);
      // A reload prunes the selection to rows that still exist, rather than clearing it outright,
      // so a bulk reject that only partly succeeded leaves the survivors selected.
      this._selectedIds.update((ids) => {
        const present = new Set(page.content?.map((row) => row.reviewTaskId) ?? []);
        const next = new Set([...ids].filter((id) => present.has(id)));
        return next.size === ids.size ? ids : next;
      });
    } catch (error: unknown) {
      this._error.set(error);
    } finally {
      this._loading.set(false);
    }
  }

  private patchFilters(patch: Partial<AdminCasesFilters>): void {
    this._filters.update((current) => ({ ...current, ...patch, page: FIRST_PAGE }));
    this._selectedIds.set(new Set());
  }

  setPeriod(period: AdminCasesPeriod): void {
    this.patchFilters({ period });
  }

  setState(state: AdminCasesState): void {
    this.patchFilters({ state });
  }

  setKpi(kpi: AdminCasesKpi | null): void {
    this.patchFilters({ kpi });
  }

  setOfficer(officerId: string | null): void {
    this.patchFilters({ officerId });
  }

  setCrop(cropCode: string | null): void {
    this.patchFilters({ cropCode });
  }

  setDecisionPath(decisionPath: AdminCasesDecisionPath | null): void {
    this.patchFilters({ decisionPath });
  }

  setResubmission(resubmission: boolean | null): void {
    this.patchFilters({ resubmission });
  }

  goToPage(page: number): void {
    this._filters.update((current) => ({ ...current, page }));
    this._selectedIds.set(new Set());
  }

  toggleRow(taskId: string): void {
    this._selectedIds.update((ids) => {
      const next = new Set(ids);
      if (next.has(taskId)) {
        next.delete(taskId);
        return next;
      }
      if (next.size >= APP_CONFIG.review.bulkMaxSize) return ids;
      next.add(taskId);
      return next;
    });
  }

  toggleAll(): void {
    const selectable = this.selectableRows().slice(0, APP_CONFIG.review.bulkMaxSize);
    this._selectedIds.set(this.allSelected() ? new Set() : new Set(selectable.map((row) => row.reviewTaskId)));
  }

  clearSelection(): void {
    this._selectedIds.set(new Set());
  }
}
