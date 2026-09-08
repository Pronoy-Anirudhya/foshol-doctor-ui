import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { APP_CONFIG } from '../../../core/config/app-config';
import { toProblemView } from '../../../core/errors/problem';
import type { KpiBreach } from '../../../generated/models/kpi-breach';
import { AdminService } from '../../../generated/services/admin.service';
import { DhakaDateTimePipe } from '../../../shared/pipes/dhaka-date-time.pipe';
import { BackLink } from '../../../shared/ui/back-link/back-link';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { ErrorPanel } from '../../../shared/ui/error-panel/error-panel';
import { PageHeading } from '../../../shared/ui/page-heading/page-heading';
import { Paginator } from '../../../shared/ui/paginator/paginator';
import { RegionChip } from '../../../shared/ui/region-chip/region-chip';
import { Spinner } from '../../../shared/ui/spinner/spinner';
import { taskPath } from '../../officer/officer-paths';
import { ADMIN_PATHS } from './admin-paths';
import { KpiBreachStore } from './kpi-breach-store';
import type { BreachKind } from './kpi-count-tile';

/**
 * The KPI breach drill-down — `GET /api/v1/admin/kpis/breaches`, paginated, read-only.
 *
 * **The attribution rule, on a list.** The rows are split into two tables that do not share a
 * column set:
 *
 *  - *Assignment breaches* are district failures. The case sat in the shared pool and nobody had
 *    claimed it, so the server sends `officerId` and `officerName` as `null` **by design**. That
 *    table therefore has **no officer column at all** — not a name, not an empty cell, not an
 *    "unassigned" placeholder. Every one of those reads as a person, and naming a person for a
 *    pool failure is a false accusation. The heading names the district instead, which is what
 *    actually failed.
 *  - *Resolution breaches* are the officer's, because that officer held the live claim. Only
 *    that table carries a name.
 *
 * `kind` and `officerId` are real query parameters and are filtered on. **A district is never
 * sent** — the server scopes the list from the JWT — and there is no district control, because
 * offering one would imply a national admin exists.
 *
 * An `officerId` filter forces `kind=RESOLUTION`: an officer filter over assignment breaches asks
 * for rows that cannot exist, and an empty table would read as "this officer has none" rather
 * than "this question has no meaning". Choosing the assignment filter clears the officer filter
 * for the same reason, and the page says so on screen.
 *
 * **Click-through is a plain link.** A task that is gone, or that belongs to another district,
 * answers **404 — never 403** — so the console shows its ordinary "not found", and this page says
 * nothing about districts. Inventing a "wrong district" message would tell the reader something
 * the server did not say.
 *
 * `WEB-FR-356` — the URL is the state: every control writes a query parameter and one effect
 * turns that into one request. No timer, no SSE, no toast.
 * `WEB-FR-305` — a failure keeps the last page under a stale marker instead of emptying the table.
 * `WEB-FR-303` — every control is a `GET` or a link; nothing here writes.
 */

/** Zero-based on the wire (`00-common` §8.2), like every other list in this application. */
const FIRST_PAGE = 0;
/** The length of an empty list. Not a tunable — it is what "none" is spelled as. */
const NONE = 0;

interface BreachRow {
  /** `track` key only. */
  readonly id: string;
  readonly kind: BreachKind | null;
  readonly farmerName: string;
  /** Server content, verbatim: `cropNameBn` when sent, else the code. Never translated. */
  readonly crop: string;
  readonly dueAt: string | null;
  readonly breachedAt: string | null;
  /** `null` when the server sent no task id — then there is nothing to click through to. */
  readonly taskLink: string | null;
  /** Resolution rows only. `null` means the server named nobody; the id stands in. */
  readonly officerName: string | null;
  readonly officerId: string | null;
}

@Component({
  selector: 'foshol-kpi-breaches-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [KpiBreachStore],
  templateUrl: './kpi-breaches-page.html',
  styleUrl: './kpi-breaches-page.css',
  host: { class: 'block' },
  imports: [
    RouterLink,
    TranslatePipe,
    DhakaDateTimePipe,
    BackLink,
    PageHeading,
    RegionChip,
    ErrorPanel,
    EmptyState,
    Spinner,
    Paginator,
  ],
})
export class KpiBreachesPage {
  private readonly admin = inject(AdminService);
  private readonly router = inject(Router);
  protected readonly store = inject(KpiBreachStore);

  /** Query parameters, delivered as signal inputs by `withComponentInputBinding()`. */
  readonly kind = input<string | undefined>();
  readonly officerId = input<string | undefined>();
  readonly page = input<string | undefined>();

  protected readonly paths = ADMIN_PATHS;
  protected readonly kindChoices: readonly BreachKind[] = ['ASSIGNMENT', 'RESOLUTION'];

  /** Anything that is not one of the contract's two values is no filter at all. */
  protected readonly activeKind = computed<BreachKind | null>(() => {
    const value = this.kind();
    return value === 'ASSIGNMENT' || value === 'RESOLUTION' ? value : null;
  });

  protected readonly activeOfficerId = computed<string | null>(() => {
    const value = this.officerId()?.trim();
    return value === undefined || value === '' ? null : value;
  });

  /** An officer filter can only mean resolution breaches — see the class comment. */
  protected readonly effectiveKind = computed<BreachKind | null>(() =>
    this.activeOfficerId() === null ? this.activeKind() : 'RESOLUTION',
  );

  protected readonly pageIndex = computed(() => {
    const parsed = Number(this.page());
    return Number.isInteger(parsed) && parsed >= FIRST_PAGE ? parsed : FIRST_PAGE;
  });

  private readonly query = computed(() => ({
    kind: this.effectiveKind() ?? undefined,
    officerId: this.activeOfficerId() ?? undefined,
    page: this.pageIndex(),
    size: APP_CONFIG.page.defaultSize,
  }));

  protected readonly problem = computed(() => {
    const error = this.store.error();
    return error === null ? null : toProblemView(error);
  });

  protected readonly loadedAt = computed(() => {
    const at = this.store.loadedAt();
    return at === null ? null : new Date(at);
  });

  protected readonly rows = computed<readonly BreachRow[]>(() =>
    (this.store.page()?.content ?? []).map(toRow),
  );

  protected readonly assignmentRows = computed(() =>
    this.rows().filter((row) => row.kind === 'ASSIGNMENT'),
  );
  protected readonly resolutionRows = computed(() =>
    this.rows().filter((row) => row.kind === 'RESOLUTION'),
  );

  protected readonly totalElements = computed(() => this.store.page()?.totalElements ?? NONE);
  protected readonly totalPages = computed(() => this.store.page()?.totalPages ?? NONE);
  protected readonly size = computed(() => this.store.page()?.size ?? APP_CONFIG.page.defaultSize);

  /** The server answered and the answer was "none" — different from never having asked. */
  protected readonly countedEmpty = computed(
    () => this.store.hasPage() && this.rows().length === NONE,
  );

  /**
   * The name for the "filtered to one officer" banner, taken from the rows the server sent
   * rather than carried through the URL — a person's name has no business in a query string.
   * When no row names them the id stands in, which is ugly but true.
   */
  protected readonly filteredOfficerLabel = computed(() => {
    const id = this.activeOfficerId();
    if (id === null) return '';
    return this.resolutionRows().find((row) => row.officerName !== null)?.officerName ?? id;
  });

  constructor() {
    // The only place a request starts. Every control writes the URL, the router writes these
    // inputs, and this reacts — so a reload or a shared link reproduces the screen exactly.
    effect(() => {
      const params = this.query();
      void this.store.load(() => this.admin.listAdminKpiBreaches(params));
    });
  }

  /** `WEB-FR-356` — the manual refresh, with the parameters already on screen. */
  protected refresh(): void {
    void this.store.load(() => this.admin.listAdminKpiBreaches(this.query()));
  }

  /**
   * Choosing the assignment filter drops any officer filter: assignment breaches have no
   * officer, so the pair is not a narrower question but a contradictory one.
   */
  protected selectKind(next: BreachKind | null): void {
    void this.router.navigate([], {
      queryParams: {
        kind: next,
        officerId: next === 'ASSIGNMENT' ? null : this.activeOfficerId(),
        page: null,
      },
    });
  }

  protected clearOfficer(): void {
    void this.router.navigate([], { queryParams: { officerId: null, page: null } });
  }

  protected goToPage(target: number): void {
    void this.router.navigate([], {
      queryParams: { page: target === FIRST_PAGE ? null : target },
      queryParamsHandling: 'merge',
    });
  }
}

function toRow(breach: KpiBreach, index: number): BreachRow {
  const taskId = breach.reviewTaskId ?? null;
  return {
    id: breach.id ?? `${index}`,
    kind: breach.kind ?? null,
    farmerName: breach.farmerName ?? '',
    crop: breach.cropNameBn ?? breach.cropCode ?? '',
    dueAt: breach.dueAt ?? null,
    breachedAt: breach.breachedAt ?? null,
    taskLink: taskId === null ? null : taskPath(taskId),
    // Null for every assignment row, by design — the template never asks for it there.
    officerName: breach.officerName ?? null,
    officerId: breach.officerId ?? null,
  };
}
