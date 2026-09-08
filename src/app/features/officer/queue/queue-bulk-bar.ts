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
import { ErrorPanel } from '../../../shared/ui/error-panel/error-panel';
import { Icon } from '../../../shared/ui/icon/icon';
import { ColleaguePicker } from '../colleague-picker';
import { officerErrorKey, officerProblemKey } from '../officer-error-codes';
import {
  failedIn,
  OfficerFacade,
  succeededIn,
  type QueueApproval,
  type RejectionReason,
} from '../officer-facade';
import { QueueRejectFields, rejectReady } from './queue-reject-fields';
import { POPOVER_APPROVE, POPOVER_TRANSFER, type QueuePopoverKind } from './queue-row-actions';

/**
 * The bulk action bar — visible only while something is selected.
 *
 * **This posts to the real bulk endpoints** (`REVIEW-FR-098`): `bulk-transfer`, `bulk-approve`
 * and `bulk-reject`, one request each. An earlier build of this bar looped the single-task
 * endpoints because no bulk endpoint existed; that loop is gone. There is deliberately no bulk
 * REVISE — revising a published advisory is a per-case judgement, and the contract offers no
 * bulk form of it.
 *
 * **A `200` here is not a pass.** All three endpoints answer `200` with `{succeeded, failed,
 * results[]}`, and a partial failure is the NORMAL outcome — another officer reaching one of
 * the selected rows first is a `FAILED` item, not a failed run. So the report below names every
 * task the officer selected, by farmer, with its own verdict, and one red line never turns the
 * whole run red. A request the server refuses OUTRIGHT (a `400`, a `403`, a dropped connection)
 * is a different thing and gets the panel at the bottom instead.
 *
 * **The selection is capped before it is sent.** `foshol.review.bulk.max-size` is what the
 * server enforces with `400 ERR_BULK_TOO_LARGE`; the page stops the officer at the same number
 * and this bar says so, because spending a round trip to be told a limit we already know is not
 * an error message, it is a delay.
 *
 * Bulk approve is subject to the same rule as the single-row one: nothing is published that the
 * officer was not shown. Opening the confirm panel reads every selected task's approval and
 * lists the diagnosis and remedy count it would publish, per row, before the button is live.
 */
const NONE = 0;

@Component({
  selector: 'foshol-queue-bulk-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ColleaguePicker, ErrorPanel, Icon, QueueRejectFields, TranslatePipe],
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

        <!-- REVIEW-FR-096 — offered only when the selection actually contains claims this
             officer holds. Nothing else may be transferred, so nothing else offers the control. -->
        @if (transferable().length > NONE) {
          <button
            type="button"
            [class]="quietClass"
            data-testid="queue-bulk-transfer"
            [attr.aria-expanded]="open() === 'transfer'"
            [disabled]="bulk().running"
            (click)="toggle.emit('transfer')"
          >
            {{ 'officer.queue.bulk.transfer' | translate }}
          </button>
        }

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

      <!-- REVIEW-FR-098 — said before the officer runs into it, not after the server says no. -->
      @if (atCap()) {
        <p class="mt-2 text-sm font-bold text-on-console" data-testid="queue-bulk-cap">
          {{ 'officer.queue.bulk.cap' | translate: { max: maxSize() } }}
        </p>
      }

      @if (open(); as kind) {
        <div
          class="mt-3 rounded-xl border border-surface-3 bg-surface-0 p-3"
          role="group"
          data-testid="queue-bulk-panel"
          [attr.aria-label]="panelLabelKey() | translate"
        >
          @switch (kind) {
            @case ('approve') {
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
            }
            @case ('transfer') {
              <p class="text-sm text-ink">
                {{
                  'officer.queue.bulk.transferSummary'
                    | translate: { count: transferable().length }
                }}
              </p>
              <p class="mt-0.5 text-xs text-ink-muted">
                {{ 'officer.transfer.clockNote' | translate }}
              </p>
              <foshol-colleague-picker
                class="mt-2"
                idPrefix="queue-bulk"
                [(target)]="target"
                [disabled]="bulk().running"
              />
            }
            @default {
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
          }

          <div class="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              [class]="confirmClass()"
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

            <!-- REVIEW-FR-098 — every item the officer selected, by farmer, with its own
                 verdict. WEB-UX-044 — the verdict is a word and a glyph, never a colour alone. -->
            <ul class="mt-2 list-none p-0 text-sm" data-testid="queue-bulk-report">
              @for (line of reportLines(); track line.taskId) {
                <li
                  class="flex flex-wrap items-center gap-x-2 py-0.5 text-on-console-muted"
                  [attr.data-status]="line.ok ? 'OK' : 'FAILED'"
                >
                  <foshol-icon
                    class="shrink-0"
                    [name]="line.ok ? 'approve' : 'warning'"
                    size="xs"
                  />
                  <span class="font-bold text-on-console">{{ line.farmer }}</span>
                  <span>{{ line.verdictKey | translate }}</span>
                  @if (line.reasonKey; as reasonKey) {
                    <span>— {{ reasonKey | translate }}</span>
                  } @else if (line.errorCode; as code) {
                    <span class="font-latin">— {{ code }}</span>
                  }
                </li>
              }
            </ul>

            <!-- The request itself refused. Distinct from the per-item failures above. -->
            @if (bulk().problem; as problem) {
              @if (requestErrorKey(); as key) {
                <p class="mt-2 text-sm font-bold text-dawn-300" data-testid="queue-bulk-error">
                  {{ key | translate }}
                </p>
              } @else {
                <foshol-error-panel class="mt-2 block" [problem]="problem" [retryable]="false" />
              }
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
  /** The subset that may be transferred: live claims held by THIS officer, and nothing else. */
  readonly transferable = input<readonly QueueRowView[]>([]);
  readonly open = input<QueuePopoverKind | null>(null);
  /** The selection has reached `foshol.review.bulk.max-size` and will take no more. */
  readonly atCap = input(false);
  readonly maxSize = input(NONE);

  readonly toggle = output<QueuePopoverKind>();
  readonly clearSelection = output<void>();

  private readonly facade = inject(OfficerFacade);

  protected readonly bulk = this.facade.bulk;
  protected readonly approvals = signal<readonly QueueApproval[]>([]);
  protected readonly loading = signal(false);
  protected readonly reason = signal<RejectionReason | null>(null);
  protected readonly message = signal('');
  protected readonly target = signal<string | null>(null);
  protected readonly attempted = signal(false);
  protected readonly NONE = NONE;

  private readonly buttonBase =
    'touch-target inline-flex items-center justify-center rounded-xl px-3.5 text-sm font-bold transition-colors duration-1 ease-settle disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-faint';

  protected readonly approveClass = `${this.buttonBase} bg-paddy-600 text-ink-invert shadow-stamp hover:bg-paddy-700`;
  protected readonly rejectClass = `${this.buttonBase} border border-clay-300 bg-clay-100 text-clay-700 hover:bg-clay-300 hover:text-ink`;
  protected readonly quietClass = `${this.buttonBase} border border-slate-600 bg-slate-900 text-on-console hover:bg-slate-800`;
  protected readonly quietDarkClass = `${this.buttonBase} border border-surface-3 bg-surface-0 text-ink hover:bg-surface-1`;
  private readonly confirmTransferClass = `${this.buttonBase} bg-slate-800 text-ink-invert shadow-stamp hover:bg-slate-900`;

  protected readonly succeeded = computed(() => succeededIn(this.bulk()).length);
  protected readonly failed = computed(() => failedIn(this.bulk()));

  /** Selected rows whose task carries no suggested diagnosis: approve skips them, and says so. */
  protected readonly skipped = computed(() => this.rows().length - this.approvals().length);

  protected readonly panelLabelKey = computed(() => {
    if (this.open() === POPOVER_APPROVE) return 'officer.queue.bulk.approve';
    return this.open() === POPOVER_TRANSFER
      ? 'officer.queue.bulk.transfer'
      : 'officer.queue.bulk.reject';
  });

  protected readonly confirmClass = computed(() => {
    if (this.open() === POPOVER_APPROVE) return this.approveClass;
    return this.open() === POPOVER_TRANSFER ? this.confirmTransferClass : this.rejectClass;
  });

  protected readonly requestErrorKey = computed(() => officerProblemKey(this.bulk().problem));

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

  /**
   * The finished run, one line per task, against the farmer name the officer selected. Built
   * from `reportRows` rather than `rows()`: a finished run reloads the queue, which prunes the
   * selection, and the report has to outlive it.
   */
  protected readonly reportLines = computed(() =>
    this.bulk().outcomes.map((outcome) => ({
      taskId: outcome.taskId,
      farmer: this.farmerFor(outcome.taskId),
      ok: outcome.ok,
      errorCode: outcome.errorCode,
      verdictKey: outcome.ok ? 'officer.queue.bulk.item.ok' : 'officer.queue.bulk.item.failed',
      reasonKey: officerErrorKey(outcome.errorCode),
    })),
  );

  protected readonly confirmEnabled = computed(() => {
    if (this.bulk().running) return false;
    if (this.open() === POPOVER_APPROVE) return !this.loading() && this.approvals().length > NONE;
    if (this.open() === POPOVER_TRANSFER) {
      return this.target() !== null && this.transferable().length > NONE;
    }
    return this.rows().length > NONE;
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
   * The report outlives the selection. A finished run reloads the queue, which prunes the
   * page's selection — so the names the report needs come from the snapshot taken when the run
   * started, not from `rows()`, which by then is empty.
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
    if (kind === POPOVER_APPROVE) {
      void this.runApprove();
      return;
    }
    void (kind === POPOVER_TRANSFER ? this.runTransfer() : this.runReject());
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

  /** `REVIEW-FR-096` — one target for the batch, and only the claims this officer holds. */
  private async runTransfer(): Promise<void> {
    const target = this.target();
    if (target === null) return;
    const batch = this.transferable();
    if (batch.length === NONE) return;
    this.reportRows.set(batch);
    await this.facade.bulkTransfer(
      batch.map((view) => view.row.reviewTaskId),
      target,
    );
    this.cancel();
  }
}
