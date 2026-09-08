import { computed, Injectable, signal } from '@angular/core';
import type { CaseStatus } from '../../generated/models/case-status';

/**
 * WEB-FR-353 — the farmer's stepper advances from an SSE frame with **no network round trip**.
 *
 * The invariant that matters: `status` only ever holds a value the server sent. There is no
 * optimistic advance, no local transition table, and no inference of a status from anything
 * other than a payload that carried it. A client that guesses the next status will eventually
 * show a farmer a stage the backend never reached (WEB-NFR-001).
 *
 * "Needs refresh" is therefore kept in a SEPARATE set rather than as a field on the entry: an
 * advisory event for a case whose status this client has never seen must be able to mark that
 * case dirty **without** conjuring a status for it.
 */
export interface CaseStatusEntry {
  readonly caseId: string;
  readonly status: CaseStatus;
  readonly fromStatus: CaseStatus | null;
  /** Epoch millis of the event that set this entry. */
  readonly at: number;
}

/** Handover §11 — the statuses after which no further transition arrives. */
const TERMINAL: readonly CaseStatus[] = ['ADVISED', 'REJECTED', 'FAILED'];

@Injectable({ providedIn: 'root' })
export class CaseStatusStore {
  private readonly _byCaseId = signal<ReadonlyMap<string, CaseStatusEntry>>(new Map());
  private readonly _needsRefresh = signal<ReadonlySet<string>>(new Set());
  private readonly _lastEventAt = signal<number | null>(null);

  readonly byCaseId = this._byCaseId.asReadonly();
  readonly needsRefreshIds = this._needsRefresh.asReadonly();
  readonly lastEventAt = this._lastEventAt.asReadonly();
  readonly trackedCount = computed(() => this._byCaseId().size);

  statusOf(caseId: string): CaseStatus | null {
    return this._byCaseId().get(caseId)?.status ?? null;
  }

  entryOf(caseId: string): CaseStatusEntry | null {
    return this._byCaseId().get(caseId) ?? null;
  }

  needsRefresh(caseId: string): boolean {
    return this._needsRefresh().has(caseId);
  }

  isTerminal(caseId: string): boolean {
    const current = this.statusOf(caseId);
    return current !== null && TERMINAL.includes(current);
  }

  /**
   * The ONLY way a status enters this store. Named for what it is — the server said so —
   * rather than `setStatus`, so a future reader cannot mistake it for a local guess.
   */
  applyServerStatus(
    caseId: string,
    toStatus: CaseStatus,
    fromStatus: CaseStatus | null = null,
    at: number = Date.now(),
  ): void {
    this._byCaseId.update((current) => {
      const copy = new Map(current);
      copy.set(caseId, { caseId, status: toStatus, fromStatus, at });
      return copy;
    });
    this._lastEventAt.set(at);
  }

  /** WEB-FR-354 — the case's server-side detail has moved on; the visible view should re-read. */
  markNeedsRefresh(caseId: string, at: number = Date.now()): void {
    this._needsRefresh.update((current) => {
      if (current.has(caseId)) return current;
      const copy = new Set(current);
      copy.add(caseId);
      return copy;
    });
    this._lastEventAt.set(at);
  }

  /** Called by the view once it has actually re-read the case. */
  clearRefresh(caseId: string): void {
    this._needsRefresh.update((current) => {
      if (!current.has(caseId)) return current;
      const copy = new Set(current);
      copy.delete(caseId);
      return copy;
    });
  }

  /** WEB-SEC-004 / WEB-DATA-023 — no trace of one session's cases survives into the next. */
  clearSession(): void {
    this._byCaseId.set(new Map());
    this._needsRefresh.set(new Set());
    this._lastEventAt.set(null);
  }
}
