import { computed, Injectable, signal, untracked } from '@angular/core';
import { APP_CONFIG } from '../../core/config/app-config';
import type { ProblemView } from '../../core/errors/problem';
import { newUuid } from '../../core/util/uuid';
import type { FarmerImportResult } from '../../generated/models/farmer-import-result';
import type { FarmerRecord } from '../../generated/models/farmer-record';
import type { PageOfFarmerRecord } from '../../generated/models/page-of-farmer-record';

const FIRST_PAGE = 0;
const NONE = 0;

export type SubmitState = 'idle' | 'submitting' | 'succeeded' | 'failed';

/**
 * The directory's server-side filters.
 *
 * `q` and `phone` are typed as they are — two nullable fields rather than a union — because the
 * request has two optional parameters. The invariant that only ONE of them is ever set is
 * enforced by the mutators below, not by this type.
 */
export interface FarmerFilters {
  readonly q: string | null;
  readonly phone: string | null;
  readonly page: number;
}

const NO_FILTERS: FarmerFilters = { q: null, phone: null, page: FIRST_PAGE };

/** The outcome of one register attempt, as the confirmation panel needs to read it. */
export interface RegisterOutcome {
  readonly record: FarmerRecord;
  /** `Idempotency-Replayed: true` — the same key and body arrived twice. Still a success. */
  readonly replayed: boolean;
}

/**
 * Staff farmer provision (`WEB-FR-310`…`314`), for both the officer console and the admin
 * surface — one store, because they are one screen mounted twice.
 *
 * Component-scoped (`@Injectable()` with no `providedIn`, listed in `FarmersPage.providers`), so
 * a district's farmer list and a half-typed registration die with the route rather than
 * surviving into the next user's session. That also means it needs no entry in
 * `StoreTeardown` — the router already does the clearing.
 *
 * **The invariant this store exists to protect** (`WEB-FR-312`): `q` and `phone` are never sent
 * together. There is deliberately no `setFilters` and no mutator that takes both — `setQuery`
 * clears `phone` and `setPhoneLookup` clears `q`, so the `400 ERR_BAD_REQUEST` that a combined
 * request would earn is not merely guarded against, it is *unreachable through this API*. That
 * is the same enforcement-by-absence `QueueStore` uses to make a client sort impossible.
 *
 * **Server order is adopted whole.** `created_at DESC` is the server's rule and there is no
 * comparator in this file, not even a private one (`WEB-NFR-001`). The contract offers no sort
 * parameter, so there is nothing to offer the user either — see `DEVIATIONS.md` D-26.
 *
 * The store never injects a generated service. Every method that needs the network takes a
 * `fetcher`, exactly as `AdminCasesStore` does, which is what keeps it testable without HTTP.
 */
@Injectable()
export class FarmerDirectoryStore {
  // ── Directory ────────────────────────────────────────────────────────────────────────────
  private readonly _filters = signal<FarmerFilters>(NO_FILTERS);
  private readonly _page = signal<PageOfFarmerRecord | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<unknown>(null);
  private readonly _loadedAt = signal<number | null>(null);

  readonly filters = this._filters.asReadonly();
  readonly page = this._page.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly loadedAt = this._loadedAt.asReadonly();

  readonly hasPage = computed(() => this._page() !== null);
  /** A failed refresh over a page we still hold: the table stays, flagged as out of date. */
  readonly stale = computed(() => this._error() !== null && this._page() !== null);
  /** The rows as the server ordered them — a read of `content`, never a sort of it. */
  readonly rows = computed<readonly FarmerRecord[]>(() => this._page()?.content ?? []);
  readonly countedEmpty = computed(() => this.hasPage() && this.rows().length === NONE);
  readonly searchActive = computed(() => {
    const { q, phone } = this._filters();
    return q !== null || phone !== null;
  });

  readonly totalElements = computed(() => this._page()?.totalElements ?? NONE);
  readonly totalPages = computed(() => this._page()?.totalPages ?? NONE);
  readonly size = computed(() => this._page()?.size ?? APP_CONFIG.page.defaultSize);

  // ── Register one ─────────────────────────────────────────────────────────────────────────
  private readonly _submitState = signal<SubmitState>('idle');
  private readonly _outcome = signal<RegisterOutcome | null>(null);
  private readonly _registerProblem = signal<ProblemView | null>(null);
  private readonly _idempotencyKey = signal<string | null>(null);

  readonly submitState = this._submitState.asReadonly();
  readonly outcome = this._outcome.asReadonly();
  readonly registerProblem = this._registerProblem.asReadonly();
  readonly submitting = computed(() => this._submitState() === 'submitting');

  // ── Bulk import ──────────────────────────────────────────────────────────────────────────
  private readonly _importState = signal<SubmitState>('idle');
  private readonly _importResults = signal<FarmerImportResult | null>(null);
  private readonly _importProblem = signal<ProblemView | null>(null);

  readonly importState = this._importState.asReadonly();
  readonly importResults = this._importResults.asReadonly();
  readonly importProblem = this._importProblem.asReadonly();
  readonly importing = computed(() => this._importState() === 'submitting');

  // ── Directory methods ────────────────────────────────────────────────────────────────────

  /**
   * One page of `GET /api/v1/farmers`, district-scoped by the JWT — never by a query parameter
   * this client adds (`WEB-API-001`).
   *
   * A failure keeps the page already on screen and records the error, so a dropped connection
   * during a refresh leaves an officer looking at slightly old data rather than at nothing.
   */
  async load(fetcher: () => Promise<PageOfFarmerRecord>, at: () => number = Date.now): Promise<void> {
    this._loading.set(true);
    try {
      this._page.set(await fetcher());
      this._loadedAt.set(at());
      this._error.set(null);
    } catch (error: unknown) {
      this._error.set(error);
    } finally {
      this._loading.set(false);
    }
  }

  /** Search by name. Clears any phone lookup — the two can never be in flight together. */
  setQuery(q: string | null): void {
    const value = normalise(q);
    this._filters.set({ q: value, phone: null, page: FIRST_PAGE });
  }

  /** Exact phone lookup: the number an officer just collected, checked before they register it. */
  setPhoneLookup(phone: string | null): void {
    const value = normalise(phone);
    this._filters.set({ q: null, phone: value, page: FIRST_PAGE });
  }

  clearSearch(): void {
    this._filters.set(NO_FILTERS);
  }

  goToPage(page: number): void {
    this._filters.update((current) => ({ ...current, page }));
  }

  // ── Register methods ─────────────────────────────────────────────────────────────────────

  /**
   * `WEB-API-004` / `WEB-DATA-005` — one `Idempotency-Key` per ATTEMPT, reused by every retry of
   * that attempt, replaced when the content changes. A retry that carried a fresh key would be
   * a second farmer, which is the precise failure a flaky field connection would otherwise
   * cause.
   */
  keyForAttempt(): string {
    const existing = this._idempotencyKey();
    if (existing !== null) return existing;
    const minted = newUuid();
    this._idempotencyKey.set(minted);
    return minted;
  }

  /**
   * The form's content changed, so the next submit is a NEW attempt and needs a new key.
   *
   * `untracked` is load-bearing here, exactly as it is in `CaseDraftStore`: reading a signal
   * inside a mutator makes every caller's `effect` depend on it, so an effect that calls this
   * would re-run the moment a submit flips the state, land back here, and mint a fresh key in
   * the middle of the attempt already in flight.
   */
  contentChanged(): void {
    this._idempotencyKey.set(null);
    untracked(() => {
      if (this._submitState() !== 'submitting') {
        this._submitState.set('idle');
        this._registerProblem.set(null);
      }
    });
  }

  beginSubmit(): void {
    this._submitState.set('submitting');
    this._registerProblem.set(null);
  }

  /**
   * A `201` — including a replay, which `Idempotency-Replayed: true` marks and which is still a
   * success, not an error. The key is retired so the next registration starts a new attempt.
   */
  submitSucceeded(record: FarmerRecord, replayed: boolean): void {
    this._outcome.set({ record, replayed });
    this._submitState.set('succeeded');
    this._registerProblem.set(null);
    this._idempotencyKey.set(null);
  }

  /** The key is deliberately KEPT: a retry of this same attempt must reuse it. */
  submitFailed(problem: ProblemView): void {
    this._registerProblem.set(problem);
    this._submitState.set('failed');
  }

  /** Clears the register panel back to a blank form — on close, or on "register another". */
  resetRegister(): void {
    this._submitState.set('idle');
    this._outcome.set(null);
    this._registerProblem.set(null);
    this._idempotencyKey.set(null);
  }

  // ── Import methods ───────────────────────────────────────────────────────────────────────

  beginImport(): void {
    this._importState.set('submitting');
    this._importProblem.set(null);
    this._importResults.set(null);
  }

  /**
   * A `200` from the import, which may still describe failed rows. A partial success is a
   * success at the request level and the per-row detail is the screen's real content
   * (`WEB-FR-313`) — so this never inspects `failed` to decide the state.
   */
  importSucceeded(results: FarmerImportResult): void {
    this._importResults.set(results);
    this._importState.set('succeeded');
    this._importProblem.set(null);
  }

  /** A whole-request failure: `400`, `413`, `415`. No row ever landed. */
  importFailed(problem: ProblemView): void {
    this._importProblem.set(problem);
    this._importState.set('failed');
  }

  resetImport(): void {
    this._importState.set('idle');
    this._importResults.set(null);
    this._importProblem.set(null);
  }
}

/** An empty or whitespace-only box is "no filter", not a search for nothing. */
function normalise(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length === NONE ? null : trimmed;
}
