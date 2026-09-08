import { computed, Injectable, signal } from '@angular/core';
import type { AdminStats } from '../../generated/models/admin-stats';

/**
 * WEB-FR-300…305 — the read-only admin stats page.
 *
 * WEB-FR-305 is the shape of this store: when a load fails, the last successfully loaded values
 * stay on screen under a stale marker. So a failure sets `error` and leaves `stats` alone — it
 * never nulls it — and `stale` is derived rather than set, so no caller can claim freshness.
 *
 * The fetch itself is passed in rather than injected, which keeps `core/stores` free of any
 * dependency on the generated client and leaves the API call where WEB-API-001 wants it.
 */
@Injectable({ providedIn: 'root' })
export class StatsStore {
  private readonly _stats = signal<AdminStats | null>(null);
  private readonly _loadedAt = signal<number | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<unknown>(null);

  readonly stats = this._stats.asReadonly();
  readonly loadedAt = this._loadedAt.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  /** Values are on screen, but the last attempt to confirm them failed (WEB-FR-305). */
  readonly stale = computed(() => this._error() !== null && this._stats() !== null);
  readonly hasValues = computed(() => this._stats() !== null);
  /** WEB-FR-302 — both routing thresholds, from the payload rather than a constant. */
  readonly thresholds = computed(() => this._stats()?.thresholds ?? null);

  /** The only mutator that can introduce values, and it can only get them from the server. */
  async load(fetcher: () => Promise<AdminStats>, at: () => number = Date.now): Promise<void> {
    this._loading.set(true);
    try {
      const stats = await fetcher();
      this._stats.set(stats);
      this._loadedAt.set(at());
      this._error.set(null);
    } catch (error: unknown) {
      // WEB-FR-305 — deliberately does NOT clear `_stats`: stale-but-labelled beats blank.
      this._error.set(error);
    } finally {
      this._loading.set(false);
    }
  }

  clearSession(): void {
    this._stats.set(null);
    this._loadedAt.set(null);
    this._loading.set(false);
    this._error.set(null);
  }
}
