import { computed, Injectable, signal } from '@angular/core';
import type { CaseStatus } from '../../generated/models/case-status';
import type { OfficerQueueRow } from '../../generated/models/officer-queue-row';
import type { PageOfOfficerQueueRow } from '../../generated/models/page-of-officer-queue-row';
import { APP_CONFIG } from '../config/app-config';

/**
 * The officer queue.
 *
 * **The invariant this store exists to protect** (`REVIEW-FR-030`, `WEB-FR-200`): rows are held
 * in exactly the order the server returned them and are NEVER re-sorted client-side. The server
 * orders by state, then least confident, then oldest — that ordering *is* the triage argument
 * the console is built to demonstrate. So there is no `sort` method on this class at all, not
 * even a private one; the absence is the enforcement.
 *
 * WEB-FR-204 — an SSE frame patches the affected row in place. A change that would move a row
 * (or add or remove one) sets `needsReload` instead, because the only correct new order is the
 * one the server would produce, and asking it is cheaper than being wrong.
 */
export interface QueueRowView {
  readonly row: OfficerQueueRow;
  /**
   * The latest case status seen over SSE, held ALONGSIDE the server row rather than merged
   * into it: `OfficerQueueRow.state` is the review-task state, and mapping a `CaseStatus` onto
   * it here would be re-implementing a backend rule (WEB-NFR-001).
   */
  readonly liveStatus: CaseStatus | null;
}

/** Handover §11 — a case in one of these no longer belongs in the pending queue. */
const LEAVES_QUEUE: readonly CaseStatus[] = ['ADVISED', 'REJECTED', 'FAILED'];

@Injectable({ providedIn: 'root' })
export class QueueStore {
  private readonly _rows = signal<readonly OfficerQueueRow[]>([]);
  private readonly _liveStatus = signal<ReadonlyMap<string, CaseStatus>>(new Map());
  private readonly _page = signal(0);
  private readonly _size = signal<number>(APP_CONFIG.page.defaultSize);
  private readonly _totalElements = signal(0);
  private readonly _totalPages = signal(0);
  private readonly _loading = signal(false);
  private readonly _error = signal<unknown>(null);
  private readonly _loadedAt = signal<number | null>(null);
  /** Epoch millis at which this page became known to be out of date; `null` while fresh. */
  private readonly _staleSince = signal<number | null>(null);

  readonly rows = this._rows.asReadonly();
  readonly page = this._page.asReadonly();
  readonly size = this._size.asReadonly();
  readonly totalElements = this._totalElements.asReadonly();
  readonly totalPages = this._totalPages.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly loadedAt = this._loadedAt.asReadonly();
  readonly staleSince = this._staleSince.asReadonly();

  readonly needsReload = computed(() => this._staleSince() !== null);
  readonly isEmpty = computed(() => this._rows().length === 0);
  readonly hasPrevious = computed(() => this._page() > 0);
  readonly hasNext = computed(() => this._page() + 1 < this._totalPages());

  /**
   * The rows as the console renders them — a `map` over the server array, which preserves the
   * server order by construction. There is no comparator anywhere in this file.
   */
  readonly view = computed<readonly QueueRowView[]>(() => {
    const live = this._liveStatus();
    return this._rows().map((row) => ({ row, liveStatus: live.get(row.caseId) ?? null }));
  });

  beginLoad(): void {
    this._loading.set(true);
    this._error.set(null);
  }

  /** The server's page, adopted whole. Order in, order out. */
  applyPage(page: PageOfOfficerQueueRow, at: number = Date.now()): void {
    this._rows.set([...page.content]);
    this._page.set(page.page);
    this._size.set(page.size);
    this._totalElements.set(page.totalElements);
    this._totalPages.set(page.totalPages);
    this._liveStatus.set(new Map());
    this._loading.set(false);
    this._error.set(null);
    this._loadedAt.set(at);
    this._staleSince.set(null);
  }

  failLoad(error: unknown): void {
    this._loading.set(false);
    this._error.set(error);
  }

  /**
   * WEB-FR-204 — patch one row in place from a `queue` frame.
   *
   * Returns `true` when the row was patched, `false` when the change is one this client cannot
   * represent without re-ordering and a refetch was requested instead. Two cases force a
   * refetch: a case that is not on this page at all (it may belong above the fold), and a case
   * that has reached a status which removes it from the queue.
   */
  patchRow(caseId: string, toStatus: CaseStatus, at: number = Date.now()): boolean {
    const present = this._rows().some((row) => row.caseId === caseId);
    if (!present || LEAVES_QUEUE.includes(toStatus)) {
      this.markNeedsReload(at);
      return false;
    }
    this._liveStatus.update((current) => {
      const copy = new Map(current);
      copy.set(caseId, toStatus);
      return copy;
    });
    return true;
  }

  /** WEB-FR-205 — the console offers a manual refresh; this is what lights it up. */
  markNeedsReload(at: number = Date.now()): void {
    if (this._staleSince() !== null) return;
    this._staleSince.set(at);
  }

  /** WEB-SEC-004 — an officer's queue does not survive into the next session. */
  clearSession(): void {
    this._rows.set([]);
    this._liveStatus.set(new Map());
    this._page.set(0);
    this._size.set(APP_CONFIG.page.defaultSize);
    this._totalElements.set(0);
    this._totalPages.set(0);
    this._loading.set(false);
    this._error.set(null);
    this._loadedAt.set(null);
    this._staleSince.set(null);
  }
}
