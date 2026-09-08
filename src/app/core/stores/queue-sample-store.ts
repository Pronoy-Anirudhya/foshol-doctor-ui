import { computed, Injectable, signal } from '@angular/core';
import type { PageOfOfficerQueueRow } from '../../generated/models/page-of-officer-queue-row';

/**
 * ONE page of `/review/queue`, held for the admin dashboard's widgets.
 *
 * This is deliberately **not** `QueueStore`. That store is the officer's console: it carries a
 * `stateFilter`, a paginator and a `needsReload` flag, and the SSE dispatcher patches rows in it
 * as cases move. Reusing it would mean the admin page could change what an officer is looking
 * at — and an SSE frame arriving mid-demo would silently redraw a histogram whose caption says
 * it describes the rows loaded at a stated time.
 *
 * Two independent stores also mean the two endpoints fail independently: `/admin/stats` 500ing
 * (which it does today — `LIVE-API-NOTES.md` Divergence 2) must not take the queue-derived
 * widgets down with it, and vice versa.
 *
 * Shaped exactly like `StatsStore`, down to the stale semantics of `WEB-FR-305`: a failed
 * refresh keeps the last good page on screen under a marker rather than blanking it. The fetch
 * is passed in rather than injected, so `core/stores` stays free of the generated client
 * (`WEB-API-001`).
 */
@Injectable({ providedIn: 'root' })
export class QueueSampleStore {
  private readonly _page = signal<PageOfOfficerQueueRow | null>(null);
  private readonly _loadedAt = signal<number | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<unknown>(null);

  readonly page = this._page.asReadonly();
  readonly loadedAt = this._loadedAt.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  /** Rows are on screen, but the last attempt to confirm them failed (WEB-FR-305). */
  readonly stale = computed(() => this._error() !== null && this._page() !== null);
  readonly hasPage = computed(() => this._page() !== null);

  /**
   * How many rows this sample actually holds, and how many exist. The widgets state BOTH,
   * because every number they draw describes the sample and not the system (`WEB-NFR-001`).
   */
  readonly rowsLoaded = computed(() => this._page()?.content.length ?? 0);
  readonly totalElements = computed(() => this._page()?.totalElements ?? 0);

  /** The only mutator that can introduce rows, and it can only get them from the server. */
  async load(
    fetcher: () => Promise<PageOfOfficerQueueRow>,
    at: () => number = Date.now,
  ): Promise<void> {
    this._loading.set(true);
    try {
      const page = await fetcher();
      this._page.set(page);
      this._loadedAt.set(at());
      this._error.set(null);
    } catch (error: unknown) {
      // WEB-FR-305 — deliberately does NOT clear `_page`: stale-but-labelled beats blank.
      this._error.set(error);
    } finally {
      this._loading.set(false);
    }
  }

  clearSession(): void {
    this._page.set(null);
    this._loadedAt.set(null);
    this._loading.set(false);
    this._error.set(null);
  }
}
