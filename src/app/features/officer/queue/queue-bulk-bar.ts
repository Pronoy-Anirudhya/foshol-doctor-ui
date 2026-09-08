import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { QueueRowView } from '../../../core/stores/queue-store';
import { Icon } from '../../../shared/ui/icon/icon';
import {
  failedIn,
  OfficerFacade,
  succeededIn,
  type QueueApproval,
  type RejectionReason,
} from '../officer-facade';
import { QueueRejectFields, rejectReady } from './queue-reject-fields';
import { POPOVER_APPROVE, type QueuePopoverKind } from './queue-row-actions';

/**
 * The bulk action bar — visible only while something is selected.
 *
 * **There is no bulk endpoint** (checked against both the frozen contract and the running
 * server: only `POST /review/tasks/{taskId}/approve` and `.../reject` exist). This bar is
 * therefore wired to the per-task endpoints, executed one at a time by `OfficerFacade.runBulk`.
 * The alternative — shipping the buttons disabled, or shipping them inert until a bulk endpoint
 * lands — is exactly what `DEVIATIONS.md` D-12 argues against: a control that does nothing is
 * worse than no control, and the sequential loop is a truthful implementation of the same
 * intent. When a single endpoint arrives, `runBulk` is the only thing that changes.
 *
 * Because the work is sequential and each row is claimed independently, a **partial** failure
 * is the normal outcome rather than the exceptional one: another officer holding one of the
 * selected tasks returns `409` for that row and nothing else. So progress is reported per row
 * while it runs, and the finished state names how many landed, how many did not, and which.
 *
 * Bulk approve is subject to the same rule as the single-row one: nothing is published that the
 * officer was not shown. Opening the confirm panel reads every selected task's approval and
 * lists the diagnosis and remedy count it would publish, per row, before the button is live.
 */
const NONE = 0;

@Component({
  selector: 'foshol-queue-bulk-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, QueueRejectFields, TranslatePipe],
  host: { class: 'block' },
  template: `
    <section
      class="rounded-2xl border border-slate-700 bg-console p-3 shadow-card"
      data-testid="queue-bulk-bar"
      [attr.aria-label]="'officer.queue.bulk.label' | translate"
    >
      <!-- styles.css: the default focus ring is 2.69:1 on slate-800, below the UI floor. This
           attribute is what swaps in the inverted ring for everything focusable on the dark
           bar; it is deliberately NOT on the light confirm panel below. -->
      <div class="flex flex-wrap items-center gap-2" data-chrome="console">
        <p class="mr-auto text-sm font-bold text-on-console">
          {{ 'officer.queue.bulk.selected' | translate: { count: rows().length } }}
        </p>

        @if (rows().length > NONE) {
        <button
          type="button"
          [class]="approveClass"
          data-testid="queue-bulk-approve"
          [attr.aria-expanded]="open() === 'approve'"
          [disabled]="bulk().running"
          (click)="toggle.emit('approve')"
        >
          <foshol-icon class="mr-1.5 shrink-0" name="approve" size="sm" />
          {{ 'officer.queue.bulk.approve' | translate }}
        </button>

        <button
          type="button"
          [class]="rejectClass"
          data-testid="queue-bulk-reject"
          [attr.aria-expanded]="open() === 'reject'"
          [disabled]="bulk().running"
          (click)="toggle.emit('reject')"
        >
          <foshol-icon class="mr-1.5 shrink-0" name="reject" size="sm" />
          {{ 'officer.queue.bulk.reject' | translate }}
        </button>

        <button
          type="button"
          [class]="quietClass"
          data-testid="queue-bulk-clear"
          [disabled]="bulk().running"
          (click)="clearSelection.emit()"
        >
          {{ 'officer.queue.bulk.clear' | translate }}
        </button>
        }
      </div>

      @if (open(); as kind) {
        <div
          class="mt-3 rounded-xl border border-surface-3 bg-surface-0 p-3"
          role="group"
          data-testid="queue-bulk-panel"
          [attr.aria-label]="
            (kind === 'approve' ? 'officer.queue.bulk.approve' : 'officer.queue.bulk.reject')
              | translate
          "
        >
          @if (kind === 'approve') {
            @if (loading()) {
              <p class="text-sm text-ink-muted">
                {{ 'officer.queue.action.approve.reading' | translate }}
              </p>
            } @else {
              <p class="text-sm font-bold text-ink">
                {{
                  'officer.queue.bulk.approveSummary' | translate: { count: approvals().length }
                }}
              </p>
              <!-- Every advisory this button would publish, named, before it publishes any. -->
              <ul class="mt-2 max-h-56 list-none overflow-y-auto p-0 text-sm">
                @for (line of approvalLines(); track line.taskId) {
                  <li class="flex flex-wrap gap-x-2 border-b border-surface-2 py-1 last:border-0">
                    <span class="font-bold text-ink">{{ line.farmer }}</span>
                    <span class="text-ink">{{ line.disease }}</span>
                    <span class="ml-auto text-ink-muted">
                      {{ 'officer.queue.action.remedyCount' | translate: { count: line.count } }}
                    </span>
                  </li>
                }
              </ul>
              @if (skipped() > NONE) {
                <p class="mt-2 text-sm font-bold text-dawn-700" data-testid="queue-bulk-skipped">
                  {{ 'officer.queue.bulk.skipped' | translate: { count: skipped() } }}
                </p>
              }
            }
          } @else {
            <p class="text-sm text-ink-muted">
              {{ 'officer.queue.bulk.rejectSummary' | translate: { count: rows().length } }}
            </p>
            <foshol-queue-reject-fields
              class="mt-2"
              idPrefix="queue-bulk"
              [(reason)]="reason"
              [(message)]="message"
              [attempted]="attempted()"
              [disabled]="bulk().running"
            />
          }

          <div class="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              [class]="kind === 'approve' ? confirmApproveClass : confirmRejectClass"
              data-testid="queue-bulk-confirm"
              [disabled]="!confirmEnabled()"
              (click)="confirm(kind)"
            >
              {{
                (bulk().running ? 'officer.action.submitting' : 'officer.queue.bulk.confirm')
                  | translate
              }}
            </button>
            <button
              type="button"
              [class]="quietDarkClass"
              data-testid="queue-bulk-cancel"
              [disabled]="bulk().running"
              (click)="cancel()"
            >
              {{ 'officer.queue.action.cancel' | translate }}
            </button>
          </div>
        </div>
      }

      <!-- Progress lives OUTSIDE the confirm panel: closing the panel (Escape, an outside
           click) must never hide a run that is still going. -->
      @if (bulk().total > NONE) {
        <div class="mt-3 rounded-xl bg-slate-900 p-3" data-testid="queue-bulk-progress">
          @if (bulk().running) {
            <p class="text-sm font-bold text-on-console">
              {{
                'officer.queue.bulk.progress'
                  | translate: { done: bulk().outcomes.length, total: bulk().total }
              }}
            </p>
          } @else {
            <p class="text-sm font-bold text-on-console">
              {{
                'officer.queue.bulk.finished'
                  | translate: { succeeded: succeeded(), failed: failed().length }
              }}
            </p>
            @if (failed().length > NONE) {
              <ul class="mt-2 list-none p-0 text-sm text-on-console-muted">
                @for (outcome of failed(); track outcome.taskId) {
                  <li class="py-0.5">
                    {{ farmerFor(outcome.taskId) }} —
                    @if (outcome.problem?.title; as title) {
                      {{ title }}
                    } @else {
                      {{ (outcome.problem?.titleKey ?? 'errors.generic.title') | translate }}
                    }
                  </li>
                }
              </ul>
            }
            <button
              type="button"
              [class]="quietDarkClass + ' mt-2'"
              data-testid="queue-bulk-dismiss"
              (click)="dismissReport()"
            >
              {{ 'officer.queue.bulk.dismiss' | translate }}
            </button>
          }
        </div>
      }
    </section>
  `,
})
export class QueueBulkBar {
  /** The selected rows, in the server's order — this component introduces no comparator. */
  readonly rows = input.required<readonly QueueRowView[]>();
  readonly open = input<QueuePopoverKind | null>(null);

  readonly toggle = output<QueuePopoverKind>();
  readonly clearSelection = output<void>();

  private readonly facade = inject(OfficerFacade);

  protected readonly bulk = this.facade.bulk;
  protected readonly approvals = signal<readonly QueueApproval[]>([]);
  protected readonly loading = signal(false);
  protected readonly reason = signal<RejectionReason | null>(null);
  protected readonly message = signal('');
  protected readonly attempted = signal(false);
  protected readonly NONE = NONE;

  private readonly buttonBase =
    'touch-target inline-flex items-center justify-center rounded-xl px-3.5 text-sm font-bold transition-colors duration-1 ease-settle disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-faint';

  protected readonly approveClass = `${this.buttonBase} bg-paddy-600 text-ink-invert shadow-stamp hover:bg-paddy-700`;
  protected readonly rejectClass = `${this.buttonBase} border border-clay-300 bg-clay-100 text-clay-700 hover:bg-clay-300 hover:text-ink`;
  protected readonly quietClass = `${this.buttonBase} border border-slate-600 bg-slate-900 text-on-console hover:bg-slate-800`;
  protected readonly quietDarkClass = `${this.buttonBase} border border-surface-3 bg-surface-0 text-ink hover:bg-surface-1`;
  protected readonly confirmApproveClass = this.approveClass;
  protected readonly confirmRejectClass = this.rejectClass;

  protected readonly succeeded = computed(() => succeededIn(this.bulk()).length);
  protected readonly failed = computed(() => failedIn(this.bulk()));

  /** Selected rows whose task carries no suggested diagnosis: approve skips them, and says so. */
  protected readonly skipped = computed(() => this.rows().length - this.approvals().length);

  protected readonly approvalLines = computed(() =>
    this.approvals().map((approval) => {
      const match = this.rows().find((view) => view.row.reviewTaskId === approval.taskId);
      return {
        taskId: approval.taskId,
        farmer: match?.row.farmerName ?? '',
        disease: match?.row.topDiseaseNameBn ?? '',
        count: approval.remedyIds.length,
      };
    }),
  );

  protected readonly confirmEnabled = computed(() => {
    if (this.bulk().running) return false;
    if (this.open() !== POPOVER_APPROVE) return this.rows().length > NONE;
    return !this.loading() && this.approvals().length > NONE;
  });

  constructor() {
    effect(() => {
      if (this.open() !== POPOVER_APPROVE) return;
      const taskIds = this.rows().map((view) => view.row.reviewTaskId);
      void this.readApprovals(taskIds);
    });
  }

  private async readApprovals(taskIds: readonly string[]): Promise<void> {
    this.loading.set(true);
    this.approvals.set([]);
    try {
      this.approvals.set(await this.facade.readApprovals(taskIds));
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * The report outlives the selection. `runBulk` reloads the queue when it finishes, which
   * prunes the page's selection — so the names the failure list needs come from the snapshot
   * taken when the run started, not from `rows()`, which by then is empty.
   */
  private readonly reportRows = signal<readonly QueueRowView[]>([]);

  protected farmerFor(taskId: string): string {
    return (
      this.reportRows().find((view) => view.row.reviewTaskId === taskId)?.row.farmerName ?? ''
    );
  }

  protected cancel(): void {
    const kind = this.open();
    if (kind !== null) this.toggle.emit(kind);
  }

  protected dismissReport(): void {
    this.facade.clearBulk();
  }

  protected confirm(kind: QueuePopoverKind): void {
    void (kind === POPOVER_APPROVE ? this.runApprove() : this.runReject());
  }

  private async runApprove(): Promise<void> {
    this.reportRows.set(this.rows());
    await this.facade.bulkApprove(this.approvals());
    this.cancel();
  }

  private async runReject(): Promise<void> {
    this.attempted.set(true);
    const reason = this.reason();
    if (reason === null || !rejectReady(reason, this.message())) return;
    this.reportRows.set(this.rows());
    await this.facade.bulkReject(
      this.rows().map((view) => view.row.reviewTaskId),
      reason,
      this.message().trim(),
    );
    this.cancel();
  }
}
