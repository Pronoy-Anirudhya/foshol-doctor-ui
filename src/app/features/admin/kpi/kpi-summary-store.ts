import { computed, Injectable, signal } from '@angular/core';
import type { AdminKpiSummary } from '../../../generated/models/admin-kpi-summary';

/**
 * `GET /api/v1/admin/kpis`, held the way `core/stores/stats-store.ts` holds the stats strip.
 *
 * `WEB-FR-305` is the whole shape of this store: a failed load sets `error` and **never**
 * clears `summary`, so the last values that really loaded stay on screen under a stale marker
 * instead of the screen going blank. That is not a theoretical path — the running backend is an
 * older build and both KPI endpoints answer 500 today, so the stale path is the *only* path a
 * demo would see if this store nulled its values.
 *
 * Not `providedIn: 'root'`: the KPI pages provide it themselves. A root-scoped store would
 * outlive sign-out unless `StoreTeardown` (in `core/`, and not this feature's to edit) also knew
 * about it, and a component-scoped store cannot leak one administrator's district into the next
 * session because it dies with the route.
 *
 * The fetch is passed in rather than injected, which keeps the store free of any dependency on
 * the generated client and leaves the API call at the page boundary (`WEB-API-001`).
 */
@Injectable()
export class KpiSummaryStore {
  private readonly _summary = signal<AdminKpiSummary | null>(null);
  private readonly _loadedAt = signal<number | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<unknown>(null);

  readonly summary = this._summary.asReadonly();
  readonly loadedAt = this._loadedAt.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  /** Values are on screen, but the last attempt to confirm them failed (`WEB-FR-305`). */
  readonly stale = computed(() => this._error() !== null && this._summary() !== null);

  async load(fetcher: () => Promise<AdminKpiSummary>, at: () => number = Date.now): Promise<void> {
    this._loading.set(true);
    try {
      const summary = await fetcher();
      this._summary.set(summary);
      this._loadedAt.set(at());
      this._error.set(null);
    } catch (error: unknown) {
      // WEB-FR-305 — deliberately does NOT clear `_summary`: stale-but-labelled beats blank.
      this._error.set(error);
    } finally {
      this._loading.set(false);
    }
  }
}
