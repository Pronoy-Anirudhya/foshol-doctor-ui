import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { LanguageStore } from '../../../core/i18n/language-store';
import type { QueueRowView } from '../../../core/stores/queue-store';
import { pickContent } from '../../../shared/pipes/content-locale';
import { ErrorPanel } from '../../../shared/ui/error-panel/error-panel';
import { OfficerFacade, type QueueApproval, type RejectionReason } from '../officer-facade';
import { QueueRejectFields, rejectReady } from './queue-reject-fields';
import { POPOVER_APPROVE, type QueuePopoverKind } from './queue-row-actions';

/**
 * The confirm step for one row's inline approve or reject.
 *
 * **Approve is never one click, and this panel is why.** `POST .../approve` needs a
 * `diseaseId` and a `remedyIds` list, so before the officer confirms they are told exactly what
 * the advisory will contain: the server's own suggested diagnosis, by name, and how many
 * remedies ride with it. The disease name comes off the queue row verbatim
 * (`COMMON-CON-003` — the console never writes agronomic text), and the count comes from the
 * same `QueueApproval` that the publish request is then built from, so what is shown and what
 * is sent cannot drift apart.
 *
 * A row whose task carries no suggested diagnosis never reaches this panel — the page does not
 * offer approve for it at all — but the read can still come back empty (the task changed since
 * the queue page loaded), and then the panel says so instead of publishing an empty advisory.
 *
 * `WEB-FR-233` — reject needs a reason AND a Bangla message, both, via `QueueRejectFields`.
 * `WEB-FR-244` — a failure is shown and stays shown. Nothing here retries.
 */
@Component({
  selector: 'foshol-queue-action-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ErrorPanel, QueueRejectFields, TranslatePipe],
  host: { class: 'block' },
  template: `
    <div
      #panel
      class="rounded-2xl border border-surface-3 bg-surface-1 p-4 shadow-card"
      role="group"
      tabindex="-1"
      [attr.id]="panelId()"
      [attr.aria-label]="titleKey() | translate"
      data-testid="queue-action-panel"
    >
      <h3 class="text-sm font-bold text-console">{{ titleKey() | translate }}</h3>

      @if (kind() === 'approve') {
        @if (loading()) {
          <p class="mt-2 text-sm text-ink-muted">
            {{ 'officer.queue.action.approve.reading' | translate }}
          </p>
        } @else if (approval(); as ready) {
          <!-- Exactly what will be published, before it is published. -->
          <p class="mt-2 text-sm text-ink">
            {{
              'officer.queue.action.approve.summary'
                | translate: { disease: diseaseName(), count: ready.remedyIds.length }
            }}
          </p>
          <p class="mt-1 text-xs text-ink-muted">
            {{ 'officer.queue.action.approve.note' | translate }}
          </p>
        } @else {
          <p class="mt-2 text-sm text-ink" data-testid="queue-approve-unavailable">
            {{ 'officer.queue.action.approve.unavailable' | translate }}
          </p>
        }
      } @else {
        <foshol-queue-reject-fields
          class="mt-2"
          [idPrefix]="panelId()"
          [(reason)]="reason"
          [(message)]="message"
          [attempted]="attempted()"
          [disabled]="pending()"
        />
      }

      @if (facade.rowActionProblem(); as problem) {
        <foshol-error-panel class="mt-3 block" [problem]="problem" />
      }

      <div class="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          [class]="confirmClass()"
          data-testid="queue-action-confirm"
          [disabled]="!confirmEnabled()"
          (click)="confirm()"
        >
          {{ confirmKey() | translate }}
        </button>
        <button
          type="button"
          [class]="cancelClass"
          data-testid="queue-action-cancel"
          [disabled]="pending()"
          (click)="close()"
        >
          {{ 'officer.queue.action.cancel' | translate }}
        </button>
      </div>
    </div>
  `,
})
export class QueueActionPanel {
  readonly view = input.required<QueueRowView>();
  readonly kind = input.required<QueuePopoverKind>();
  /**
   * `WEB-UX-032` renders the queue as cards AND as a table, both present in the DOM, so this
   * panel is mounted twice for one row. The scope keeps their `id`s — and therefore every
   * `for` / `aria-errormessage` target inside them — distinct.
   */
  readonly scope = input('row');
  readonly dismiss = output<void>();

  protected readonly facade = inject(OfficerFacade);
  private readonly language = inject(LanguageStore);

  protected readonly approval = signal<QueueApproval | null>(null);
  protected readonly loading = signal(false);
  protected readonly reason = signal<RejectionReason | null>(null);
  protected readonly message = signal('');
  protected readonly attempted = signal(false);

  private readonly panelRef = viewChild<ElementRef<HTMLElement>>('panel');

  protected readonly panelId = computed(
    () => `queue-panel-${this.scope()}-${this.view().row.reviewTaskId}-${this.kind()}`,
  );
  /** The row carries both locales, so the name the officer is asked to confirm follows the toggle. */
  protected readonly diseaseName = computed(
    () =>
      pickContent(
        this.view().row.topDiseaseNameBn,
        this.view().row.topDiseaseNameEn,
        this.view().row.topDiseaseNameEnFallback,
        this.language.current(),
      ).text,
  );
  protected readonly pending = computed(
    () => this.facade.rowActionTaskId() === this.view().row.reviewTaskId,
  );

  protected readonly titleKey = computed(() =>
    this.kind() === POPOVER_APPROVE
      ? 'officer.queue.action.approve.title'
      : 'officer.queue.action.reject.title',
  );

  protected readonly confirmKey = computed(() => {
    if (this.pending()) return 'officer.action.submitting';
    return this.kind() === POPOVER_APPROVE
      ? 'officer.queue.action.approve.confirm'
      : 'officer.queue.action.reject.confirm';
  });

  protected readonly confirmEnabled = computed(() => {
    if (this.pending()) return false;
    return this.kind() === POPOVER_APPROVE ? this.approval() !== null && !this.loading() : true;
  });

  private readonly buttonBase =
    'touch-target inline-flex items-center justify-center rounded-xl px-4 text-sm font-bold transition-colors duration-1 ease-settle disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-faint';

  protected readonly cancelClass = `${this.buttonBase} border border-surface-3 bg-surface-0 text-ink hover:bg-surface-1`;

  protected readonly confirmClass = computed(() =>
    this.kind() === POPOVER_APPROVE
      ? `${this.buttonBase} bg-paddy-600 text-ink-invert shadow-stamp hover:bg-paddy-700`
      : `${this.buttonBase} border border-clay-300 bg-clay-100 text-clay-700 hover:bg-clay-300 hover:text-ink`,
  );

  constructor() {
    // Opening the panel is the whole dependency: the read is a plain GET that neither claims
    // the task nor writes anything, so it is safe to run the moment the officer asks to see
    // what an approval would contain.
    effect(() => {
      if (this.kind() !== POPOVER_APPROVE) return;
      const taskId = this.view().row.reviewTaskId;
      void this.readApproval(taskId);
    });

    // The panel appears below the row that spawned it; moving focus into it is what keeps a
    // keyboard user with the control they just activated (WEB-UX-040).
    effect(() => {
      this.panelRef()?.nativeElement.focus();
    });
  }

  private async readApproval(taskId: string): Promise<void> {
    this.loading.set(true);
    this.approval.set(null);
    try {
      this.approval.set(await this.facade.readApproval(taskId));
    } finally {
      this.loading.set(false);
    }
  }

  protected close(): void {
    this.facade.clearRowActionProblem();
    this.dismiss.emit();
  }

  protected confirm(): void {
    void (this.kind() === POPOVER_APPROVE ? this.confirmApprove() : this.confirmReject());
  }

  private async confirmApprove(): Promise<void> {
    const approval = this.approval();
    if (approval === null) return;
    if (await this.facade.approveFromQueue(approval)) this.dismiss.emit();
  }

  private async confirmReject(): Promise<void> {
    this.attempted.set(true);
    const reason = this.reason();
    if (reason === null || !rejectReady(reason, this.message())) return;
    const taskId = this.view().row.reviewTaskId;
    if (await this.facade.rejectFromQueue(taskId, reason, this.message().trim())) {
      this.dismiss.emit();
    }
  }
}
