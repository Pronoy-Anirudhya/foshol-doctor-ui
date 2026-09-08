import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ErrorPanel } from '../../../shared/ui/error-panel/error-panel';
import { ColleaguePicker } from '../colleague-picker';
import { officerProblemKey } from '../officer-error-codes';
import { OfficerFacade } from '../officer-facade';

/**
 * `REVIEW-FR-096` — hand a live claim to a colleague in the same district.
 *
 * **This panel exists only while the officer holds the claim.** The workspace renders it behind
 * a control that is disabled otherwise, because the three things this transfer is NOT are worth
 * being unable to express: `PENDING` stays a shared pool (there is no "assign from pool"), no
 * target outside the district is ever offered, and a decided task has nothing to transfer.
 *
 * **`resolutionDueAt` does not move.** `REVIEW-FR-091` keeps the resolution clock across a
 * transfer, so the panel says so: the officer receiving the case inherits the deadline rather
 * than starting a fresh one, and an officer who transfers to dodge a KPI should find that out
 * here rather than afterwards.
 *
 * `WEB-FR-244` — a failure is shown and stays shown; nothing retries. The four codes this
 * endpoint has that the generic panel cannot explain get a sentence each
 * (`officer-error-codes.ts`); anything else falls back to the problem document.
 */
@Component({
  selector: 'foshol-transfer-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ColleaguePicker, ErrorPanel, TranslatePipe],
  host: { class: 'block' },
  template: `
    <div
      class="mt-4 rounded-2xl border border-surface-3 bg-surface-1 p-4"
      role="group"
      data-testid="transfer-panel"
      [attr.aria-label]="'officer.transfer.title' | translate"
    >
      <h4 class="font-bold text-console">{{ 'officer.transfer.title' | translate }}</h4>
      <p class="mt-0.5 max-w-[68ch] text-sm text-ink-muted">
        {{ 'officer.transfer.hint' | translate }}
      </p>
      <p class="mt-0.5 max-w-[68ch] text-sm text-ink-muted" data-testid="transfer-clock-note">
        {{ 'officer.transfer.clockNote' | translate }}
      </p>

      <foshol-colleague-picker
        class="mt-3"
        idPrefix="transfer"
        [(target)]="target"
        [disabled]="facade.actionPending()"
      />

      @if (facade.transferProblem(); as problem) {
        @if (namedProblemKey(); as key) {
          <p class="mt-3 text-sm font-bold text-clay-700" role="status" data-testid="transfer-error">
            {{ key | translate }}
          </p>
        } @else {
          <foshol-error-panel class="mt-3 block" [problem]="problem" [retryable]="false" />
        }
      }

      <div class="mt-3.5 flex flex-wrap gap-2">
        <button
          type="button"
          [class]="confirmClass"
          data-testid="transfer-confirm"
          [disabled]="!canConfirm()"
          (click)="confirm()"
        >
          {{
            (facade.actionPending() ? 'officer.action.submitting' : 'officer.transfer.confirm')
              | translate
          }}
        </button>
        <button
          type="button"
          [class]="cancelClass"
          data-testid="transfer-cancel"
          [disabled]="facade.actionPending()"
          (click)="close.emit()"
        >
          {{ 'officer.transfer.cancel' | translate }}
        </button>
      </div>
    </div>
  `,
})
export class TransferPanel {
  readonly close = output<void>();

  protected readonly facade = inject(OfficerFacade);
  protected readonly target = signal<string | null>(null);

  private readonly buttonBase =
    'touch-target inline-flex items-center justify-center rounded-xl px-4 text-sm font-bold transition-colors duration-1 ease-settle disabled:cursor-not-allowed disabled:border-surface-3 disabled:bg-surface-2 disabled:text-ink-faint';

  protected readonly confirmClass = `${this.buttonBase} bg-slate-800 text-ink-invert shadow-stamp hover:bg-slate-900`;
  protected readonly cancelClass = `${this.buttonBase} border border-surface-3 bg-surface-0 text-ink hover:bg-surface-1`;

  protected readonly namedProblemKey = computed(() =>
    officerProblemKey(this.facade.transferProblem()),
  );

  protected readonly canConfirm = computed(
    () => this.target() !== null && !this.facade.actionPending(),
  );

  protected confirm(): void {
    const target = this.target();
    if (target === null) return;
    void this.facade.transfer(target);
  }
}
