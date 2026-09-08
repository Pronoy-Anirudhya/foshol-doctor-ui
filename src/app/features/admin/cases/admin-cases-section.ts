import { ChangeDetectionStrategy, Component, computed, effect, inject, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { APP_CONFIG } from '../../../core/config/app-config';
import { toProblemView, type ProblemView } from '../../../core/errors/problem';
import type { BulkOperationResult } from '../../../generated/models/bulk-operation-result';
import type { ColleagueOfficer } from '../../../generated/models/colleague-officer';
import type { Crop } from '../../../generated/models/crop';
import type { OfficerQueueRow } from '../../../generated/models/officer-queue-row';
import { AdminService } from '../../../generated/services/admin.service';
import { KnowledgeService } from '../../../generated/services/knowledge.service';
import { ReviewService } from '../../../generated/services/review.service';
import { DhakaDateTimePipe } from '../../../shared/pipes/dhaka-date-time.pipe';
import { Percent1Pipe } from '../../../shared/pipes/percent1.pipe';
import { DecisionPathBadge } from '../../../shared/ui/decision-path-badge/decision-path-badge';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { ErrorPanel } from '../../../shared/ui/error-panel/error-panel';
import { Icon } from '../../../shared/ui/icon/icon';
import { Paginator } from '../../../shared/ui/paginator/paginator';
import { taskPath } from '../../officer/officer-paths';
import type { RejectionReason } from '../../officer/officer-facade';
import { QueueRejectFields, rejectReady } from '../../officer/queue/queue-reject-fields';
import {
  AdminCasesStore,
  type AdminCasesDecisionPath,
  type AdminCasesKpi,
  type AdminCasesState,
} from './admin-cases-store';

const NONE = 0;

/**
 * The dashboard's main stage: the district's cases (`GET /api/v1/admin/cases`), filterable, with
 * a bulk reject that shares one reason and one Bangla message across the whole selection
 * (`POST /api/v1/review/tasks/bulk-reject`).
 *
 * **This is not the officer queue.** The officer console claims-then-acts, one case at a time or
 * through its own bulk bar; this table never claims anything — the server claims each task on
 * the caller's behalf as part of the bulk-reject request itself, so an administrator never has
 * to touch Claim before Reject (`frontend-demo-api.md` §9). A row already `CLAIMED` by another
 * officer can therefore still fail with `ERR_CLAIM_CONFLICT` when the reject runs, which is why
 * a claimed row is selectable but flagged.
 *
 * `WEB-FR-308` — the server's `submittedAt DESC` order is displayed exactly as received, never
 * re-sorted. `WEB-FR-303` — the one write on this whole surface is the bulk reject; the filters,
 * the officer/crop pickers and the pagination are all `GET`s.
 */
@Component({
  selector: 'foshol-admin-cases-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    TranslatePipe,
    DhakaDateTimePipe,
    Percent1Pipe,
    DecisionPathBadge,
    EmptyState,
    ErrorPanel,
    Icon,
    Paginator,
    QueueRejectFields,
  ],
  templateUrl: './admin-cases-section.html',
  styleUrl: './admin-cases-section.css',
  host: { class: 'block' },
})
export class AdminCasesSection {
  private readonly admin = inject(AdminService);
  private readonly review = inject(ReviewService);
  private readonly knowledge = inject(KnowledgeService);
  protected readonly store = inject(AdminCasesStore);

  /** Fired after a bulk reject completes (even partially) — the dashboard also refreshes stats. */
  readonly rejected = output<void>();

  protected readonly NONE = NONE;
  protected readonly maxSize = APP_CONFIG.review.bulkMaxSize;
  protected readonly kpiChoices: readonly AdminCasesKpi[] = ['ASSIGNMENT', 'RESOLUTION'];
  protected readonly stateChoices: readonly AdminCasesState[] = ['PENDING', 'CLAIMED', 'DONE', 'REJECTED'];
  protected readonly decisionPathChoices: readonly AdminCasesDecisionPath[] = [
    'PRIMARY',
    'SECONDARY',
    'UNDETERMINED',
  ];

  protected readonly filters = this.store.filters;
  protected readonly rows = this.store.rows;

  protected readonly officers = signal<readonly ColleagueOfficer[]>([]);
  protected readonly crops = signal<readonly Crop[]>([]);

  private readonly officerNames = computed(
    () => new Map(this.officers().map((officer) => [officer.officerId, officer.name])),
  );

  protected readonly problem = computed(() => {
    const error = this.store.error();
    return error === null ? null : toProblemView(error);
  });

  protected readonly countedEmpty = computed(() => this.store.hasPage() && this.rows().length === NONE);

  protected readonly totalElements = computed(() => this.store.page()?.totalElements ?? NONE);
  protected readonly totalPages = computed(() => this.store.page()?.totalPages ?? NONE);
  protected readonly size = computed(() => this.store.page()?.size ?? APP_CONFIG.page.defaultSize);

  protected readonly resubmissionValue = computed(() => {
    const value = this.filters().resubmission;
    return value === null ? '' : String(value);
  });

  // ── Bulk reject ──────────────────────────────────────────────────────────────────────────────
  protected readonly bulkOpen = signal(false);
  protected readonly reason = signal<RejectionReason | null>(null);
  protected readonly message = signal('');
  protected readonly attempted = signal(false);
  protected readonly submitting = signal(false);
  protected readonly result = signal<BulkOperationResult | null>(null);
  protected readonly requestProblem = signal<ProblemView | null>(null);
  private readonly reportRows = signal<readonly OfficerQueueRow[]>([]);

  constructor() {
    // WEB-FR-303/308 — the only place a request starts. Every filter writes the store, and this
    // reacts, exactly like `KpiBreachesPage`'s single load effect.
    effect(() => {
      const filters = this.store.filters();
      void this.store.load(() =>
        this.admin.listAdminCases({
          period: filters.period,
          state: filters.state,
          kpi: filters.kpi ?? undefined,
          officerId: filters.officerId ?? undefined,
          cropCode: filters.cropCode ?? undefined,
          decisionPath: filters.decisionPath ?? undefined,
          resubmission: filters.resubmission ?? undefined,
          page: filters.page,
          size: APP_CONFIG.page.defaultSize,
        }),
      );
    });

    void this.loadOfficers();
    void this.loadCrops();
  }

  private async loadOfficers(): Promise<void> {
    try {
      this.officers.set(await this.review.listDistrictOfficers());
    } catch {
      // The officer filter degrades to "not offered"; the case list itself is unaffected.
    }
  }

  private async loadCrops(): Promise<void> {
    try {
      this.crops.set(await this.knowledge.listCrops());
    } catch {
      // The crop filter degrades to "not offered"; the case list itself is unaffected.
    }
  }

  protected officerName(id: string | null | undefined): string | null {
    return id ? (this.officerNames().get(id) ?? null) : null;
  }

  protected taskLink(row: OfficerQueueRow): string {
    return taskPath(row.reviewTaskId);
  }

  protected dueAt(row: OfficerQueueRow): string | null {
    return row.assignmentDueAt ?? row.resolutionDueAt ?? null;
  }

  protected reload(): void {
    const filters = this.filters();
    void this.store.load(() =>
      this.admin.listAdminCases({
        period: filters.period,
        state: filters.state,
        kpi: filters.kpi ?? undefined,
        officerId: filters.officerId ?? undefined,
        cropCode: filters.cropCode ?? undefined,
        decisionPath: filters.decisionPath ?? undefined,
        resubmission: filters.resubmission ?? undefined,
        page: filters.page,
        size: APP_CONFIG.page.defaultSize,
      }),
    );
  }

  protected onState(event: Event): void {
    this.store.setState((event.target as HTMLSelectElement).value as AdminCasesState);
  }

  protected onKpi(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.store.setKpi(value === '' ? null : (value as AdminCasesKpi));
  }

  protected onOfficer(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.store.setOfficer(value === '' ? null : value);
  }

  protected onCrop(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.store.setCrop(value === '' ? null : value);
  }

  protected onDecisionPath(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.store.setDecisionPath(value === '' ? null : (value as AdminCasesDecisionPath));
  }

  protected onResubmission(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.store.setResubmission(value === '' ? null : value === 'true');
  }

  protected goToPage(page: number): void {
    this.store.goToPage(page);
  }

  protected toggleRow(id: string): void {
    this.store.toggleRow(id);
  }

  protected toggleAll(): void {
    this.store.toggleAll();
  }

  protected openBulkReject(): void {
    this.bulkOpen.set(true);
    this.attempted.set(false);
  }

  protected cancelBulkReject(): void {
    this.bulkOpen.set(false);
    this.reason.set(null);
    this.message.set('');
    this.attempted.set(false);
  }

  protected farmerFor(taskId: string): string {
    return this.reportRows().find((row) => row.reviewTaskId === taskId)?.farmerName ?? '';
  }

  protected dismissResult(): void {
    this.result.set(null);
    this.requestProblem.set(null);
  }

  protected async submitBulkReject(): Promise<void> {
    this.attempted.set(true);
    const reason = this.reason();
    if (reason === null || !rejectReady(reason, this.message())) return;

    const selected = this.store.selectedRows();
    const ids = selected.map((row) => row.reviewTaskId);
    if (ids.length === NONE) return;

    this.reportRows.set(selected);
    this.submitting.set(true);
    this.result.set(null);
    this.requestProblem.set(null);
    try {
      const outcome = await this.review.bulkRejectReviewTasks({
        body: {
          reasonCode: reason,
          messageBn: this.message().trim(),
          items: ids.map((taskId) => ({ taskId })),
        },
      });
      this.result.set(outcome);
      this.cancelBulkReject();
      this.store.clearSelection();
      this.rejected.emit();
      this.reload();
    } catch (error: unknown) {
      this.requestProblem.set(toProblemView(error));
    } finally {
      this.submitting.set(false);
    }
  }
}
