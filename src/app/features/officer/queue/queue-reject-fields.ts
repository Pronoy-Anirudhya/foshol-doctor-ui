import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { REJECTION_REASONS, type RejectionReason } from '../officer-facade';

const EMPTY = 0;

/** `WEB-FR-233` in one place — both fields, or no rejection. Read by every caller of this form. */
export const rejectReady = (reason: RejectionReason | null, message: string): boolean =>
  reason !== null && message.trim().length > EMPTY;

/**
 * `WEB-FR-233` — the two fields a rejection cannot be sent without: a `RejectionReason` AND a
 * non-empty Bangla message the farmer will actually read.
 *
 * Extracted because the queue now asks for them in two places — one row's reject popover and
 * the bulk bar's one-reason-for-all panel — and a validation rule copied twice is a validation
 * rule that will diverge. The markup mirrors `case-workspace-page.html` exactly, including the
 * `aria-invalid` / `aria-errormessage` pairing, so the same requirement looks the same wherever
 * an officer meets it.
 *
 * `idPrefix` exists because there may be several of these on one page at once (one per row) and
 * duplicate `id`s would point every label and every `aria-errormessage` at the first one.
 */
@Component({
  selector: 'foshol-queue-reject-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  host: { class: 'block' },
  template: `
    <label class="block text-sm font-bold text-ink" [attr.for]="reasonId()">
      {{ 'officer.reject.reason' | translate }}
    </label>
    <select
      [attr.id]="reasonId()"
      class="touch-target mt-1.5 w-full rounded-xl border border-surface-3 bg-surface-0 px-3 text-sm text-ink disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-muted"
      data-testid="queue-reject-reason"
      [disabled]="disabled()"
      [attr.aria-invalid]="reasonMissing() ? 'true' : null"
      [attr.aria-errormessage]="reasonMissing() ? reasonErrorId() : null"
      (change)="onReason($event)"
    >
      <option value="">{{ 'officer.reject.reasonPlaceholder' | translate }}</option>
      @for (option of reasons; track option) {
        <option [value]="option" [selected]="option === reason()">
          {{ 'officer.reject.reason.' + option | translate }}
        </option>
      }
    </select>
    @if (reasonMissing()) {
      <p [attr.id]="reasonErrorId()" class="mt-1.5 text-sm font-bold text-clay-700">
        {{ 'officer.reject.reasonRequired' | translate }}
      </p>
    }

    <label class="mt-3 block text-sm font-bold text-ink" [attr.for]="messageId()">
      {{ 'officer.reject.message' | translate }}
    </label>
    <p class="mt-0.5 text-xs text-ink-muted" [attr.id]="hintId()">
      {{ 'officer.reject.messageHint' | translate }}
    </p>
    <textarea
      [attr.id]="messageId()"
      class="mt-1.5 w-full rounded-xl border border-surface-3 bg-surface-0 px-3 py-2 text-sm text-ink disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-muted"
      data-testid="queue-reject-message"
      rows="3"
      [attr.aria-describedby]="hintId()"
      [value]="message()"
      [disabled]="disabled()"
      [attr.aria-invalid]="messageMissing() ? 'true' : null"
      [attr.aria-errormessage]="messageMissing() ? messageErrorId() : null"
      (input)="onMessage($event)"
    ></textarea>
    @if (messageMissing()) {
      <p [attr.id]="messageErrorId()" class="mt-1.5 text-sm font-bold text-clay-700">
        {{ 'officer.reject.messageRequired' | translate }}
      </p>
    }
  `,
})
export class QueueRejectFields {
  readonly idPrefix = input.required<string>();
  readonly reason = model<RejectionReason | null>(null);
  readonly message = model('');
  /** Errors appear only once the officer has tried to submit — not while they are still typing. */
  readonly attempted = input(false);
  readonly disabled = input(false);

  protected readonly reasons = REJECTION_REASONS;

  protected readonly reasonId = computed(() => `${this.idPrefix()}-reason`);
  protected readonly messageId = computed(() => `${this.idPrefix()}-message`);
  protected readonly hintId = computed(() => `${this.idPrefix()}-hint`);
  protected readonly reasonErrorId = computed(() => `${this.idPrefix()}-reason-error`);
  protected readonly messageErrorId = computed(() => `${this.idPrefix()}-message-error`);

  protected readonly reasonMissing = computed(() => this.attempted() && this.reason() === null);
  protected readonly messageMissing = computed(
    () => this.attempted() && this.message().trim().length === EMPTY,
  );

  protected onReason(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.reason.set(value === '' ? null : (value as RejectionReason));
  }

  protected onMessage(event: Event): void {
    this.message.set((event.target as HTMLTextAreaElement).value);
  }
}
