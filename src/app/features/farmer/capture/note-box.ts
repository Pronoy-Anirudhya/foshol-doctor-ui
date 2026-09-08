import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { APP_CONFIG } from '../../../core/config/app-config';

/**
 * The always-available text path.
 *
 * WEB-FR-140 — a free-text Bangla description box on the capture screen **at all times**,
 * regardless of microphone availability, recording state or network state, submitted as
 * `noteBn`.
 * WEB-FR-141 — it is NOT behind a disclosure control, an accordion or a secondary screen. It
 * is rendered unconditionally by the capture page's own template, at full width, with its
 * label visible. A degraded path that must be found is not a degraded path — this is the
 * mitigation for every way the ASR can fail, and it costs nothing and always works.
 */
const PERCENT_FULL = 100;
const WARN_AT_PERCENT = 90;

@Component({
  selector: 'foshol-note-box',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  host: { class: 'block' },
  template: `
    <label class="note-label" for="note-bn">{{ 'farmer.capture.note.label' | translate }}</label>
    <p id="note-hint" class="note-hint">{{ 'farmer.capture.note.hint' | translate }}</p>
    <textarea
      id="note-bn"
      class="note-field"
      data-testid="note-box"
      rows="4"
      aria-describedby="note-hint note-count"
      [attr.maxlength]="maxLength"
      [attr.placeholder]="'farmer.capture.note.placeholder' | translate"
      [value]="value()"
      (input)="onInput($event)"
    ></textarea>
    <p id="note-count" class="note-count" [attr.data-warn]="nearLimit() ? true : null">
      <span class="tabular font-latin">{{ value().length }}</span>
      <span aria-hidden="true">&nbsp;/&nbsp;</span>
      <span class="tabular font-latin">{{ maxLength }}</span>
      <span class="sr-only">{{ 'farmer.capture.note.remaining' | translate }}</span>
    </p>
  `,
  styles: `
    .note-label {
      display: block;
      font-weight: 700;
      color: var(--color-ink);
    }

    .note-hint {
      margin-block-start: 0.15rem;
      font-size: 0.875rem;
      color: var(--color-ink-muted);
    }

    .note-field {
      margin-block-start: 0.5rem;
      inline-size: 100%;
      padding: 0.75rem 0.9rem;
      border: 1px solid var(--color-surface-3);
      border-radius: 0.9rem;
      background: var(--color-surface-0);
      resize: vertical;
      transition: border-color var(--duration-1) var(--ease-settle);
    }

    .note-field:hover {
      border-color: var(--color-paddy-300);
    }

    .note-count {
      margin-block-start: 0.3rem;
      text-align: end;
      font-size: 0.8125rem;
      color: var(--color-ink-faint);
    }

    .note-count[data-warn] {
      color: var(--color-dawn-700);
      font-weight: 600;
    }
  `,
})
export class NoteBox {
  readonly value = input('');
  readonly changed = output<string>();

  protected readonly maxLength = APP_CONFIG.intake.noteMaxLength;

  protected readonly nearLimit = computed(
    () => (this.value().length / this.maxLength) * PERCENT_FULL >= WARN_AT_PERCENT,
  );

  protected onInput(event: Event): void {
    this.changed.emit((event.target as HTMLTextAreaElement).value);
  }
}
