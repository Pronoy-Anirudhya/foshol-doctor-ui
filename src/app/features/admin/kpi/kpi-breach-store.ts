import { computed, Injectable, signal } from '@angular/core';
import type { PageOfKpiBreach } from '../../../generated/models/page-of-kpi-breach';

/**
 * One page of `GET /api/v1/admin/kpis/breaches`, held under the same `WEB-FR-305` contract as
 * `KpiSummaryStore`: a failure keeps the last page that loaded and marks it stale rather than
 * emptying the table. An emptied table and an empty district read identically on screen, and
 * only one of them is true.
 *
 * `hasPage()` is the difference between "the server said there are none" and "we have never
 * asked" — the breach list is allowed to be legitimately empty, so the two states must not
 * share a rendering.
 */
@Injectable()
export class KpiBreachStore {
  private readonly _page = signal<PageOfKpiBreach | null>(null);
  private readonly _loadedAt = signal<number | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<unknown>(null);

  readonly page = this._page.asReadonly();
  readonly loadedAt = this._loadedAt.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  readonly hasPage = computed(() => this._page() !== null);
  readonly stale = computed(() => this._error() !== null && this._page() !== null);

  async load(fetcher: () => Promise<PageOfKpiBreach>, at: () => number = Date.now): Promise<void> {
    this._loading.set(true);
    try {
      const page = await fetcher();
      this._page.set(page);
      this._loadedAt.set(at());
      this._error.set(null);
    } catch (error: unknown) {
      // WEB-FR-305 — the previous page survives the failure; the marker says it is not current.
      this._error.set(error);
    } finally {
      this._loading.set(false);
    }
  }
}
