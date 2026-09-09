import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { CropQuantityUnit, FieldAreaUnit } from '../../../core/stores/case-draft-store';
import type { Crop } from '../../../generated/models/crop';
import { BnValue } from '../../../shared/ui/bn-value/bn-value';
import { Icon } from '../../../shared/ui/icon/icon';

/**
 * The last card in the deck: what is about to be sent, and the control that sends it.
 *
 * Purely presentational — it is handed the draft's values and hands back a `send`. Anything a
 * farmer wants to change is one press away on the step rail, which is why no row here is
 * editable: two places to edit the same number is two places for them to disagree.
 *
 * `WEB-UX-044` — a missing required answer is a word and a glyph, never a red row.
 * `COMMON-CON-003` — the crop name is server content and renders verbatim through `BnValue`.
 */
const NONE = 0;
const QUANTITY_UNIT_PREFIX = 'shared.unit.quantity.';

@Component({
  selector: 'foshol-review-summary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BnValue, Icon, TranslatePipe],
  host: { class: 'block' },
  template: `
    <dl class="rows">
      <div class="row">
        <dt>{{ 'farmer.capture.review.crop' | translate }}</dt>
        <dd>
          @if (crop(); as chosen) {
            <foshol-bn-value [value]="chosen.nameBn" />
          } @else {
            <span class="missing">
              <foshol-icon name="warning" size="sm" />
              {{ 'farmer.capture.review.missing' | translate }}
            </span>
          }
        </dd>
      </div>

      <div class="row">
        <dt>{{ 'farmer.capture.review.photos' | translate }}</dt>
        <dd>
          @if (hasPhotos()) {
            <span class="tabular font-latin">{{ imageCount() }}</span>
          } @else {
            <span class="missing">
              <foshol-icon name="warning" size="sm" />
              {{ 'farmer.capture.review.missing' | translate }}
            </span>
          }
        </dd>
      </div>

      <div class="row">
        <dt>{{ 'farmer.capture.review.area' | translate }}</dt>
        <dd>
          @if (fieldArea(); as area) {
            <span class="tabular font-latin">{{ area }}</span>
            <span>&nbsp;{{ 'shared.unit.area.' + fieldAreaUnit() | translate }}</span>
          } @else {
            <span class="missing">
              <foshol-icon name="warning" size="sm" />
              {{ 'farmer.capture.review.missing' | translate }}
            </span>
          }
        </dd>
      </div>

      <div class="row">
        <dt>{{ 'farmer.capture.review.quantity' | translate }}</dt>
        <dd>
          @if (quantityRow(); as quantity) {
            <span class="tabular font-latin">{{ quantity.value }}</span>
            <span>&nbsp;{{ quantity.unitKey | translate }}</span>
          } @else {
            <span class="absent">{{ 'farmer.capture.review.none' | translate }}</span>
          }
        </dd>
      </div>

      <div class="row">
        <dt>{{ 'farmer.capture.review.voice' | translate }}</dt>
        <dd>
          @if (hasAudio()) {
            <span>{{ 'farmer.capture.review.present' | translate }}</span>
          } @else {
            <span class="absent">{{ 'farmer.capture.review.none' | translate }}</span>
          }
        </dd>
      </div>

      <div class="row">
        <dt>{{ 'farmer.capture.review.note' | translate }}</dt>
        <dd>
          @if (hasNote()) {
            <span>{{ 'farmer.capture.review.present' | translate }}</span>
          } @else {
            <span class="absent">{{ 'farmer.capture.review.none' | translate }}</span>
          }
        </dd>
      </div>
    </dl>

    <button
      type="button"
      class="send touch-target"
      data-testid="capture-review-submit"
      [disabled]="!canSubmit()"
      (click)="send.emit()"
    >
      @if (submitting()) {
        {{ 'farmer.capture.submit.sending' | translate }}
      } @else if (retryable()) {
        {{ 'farmer.capture.submit.retry' | translate }}
      } @else {
        {{ 'farmer.capture.submit.send' | translate }}
      }
    </button>
  `,
  styles: `
    .rows {
      border: 1px solid var(--color-surface-3);
      border-radius: var(--radius-panel);
      background: var(--color-surface-0);
      overflow: hidden;
    }

    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.7rem 0.9rem;
      border-block-start: 1px solid var(--color-surface-2);
    }

    .row:first-child {
      border-block-start: none;
    }

    dt {
      color: var(--color-ink-muted);
      font-size: 0.9375rem;
    }

    dd {
      margin: 0;
      font-weight: 700;
      color: var(--color-ink);
      text-align: end;
    }

    .missing {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      color: var(--color-clay-700);
    }

    .absent {
      color: var(--color-ink-faint);
      font-weight: 600;
    }

    .send {
      display: block;
      inline-size: 100%;
      margin-block-start: 1rem;
      padding: 0.85rem 1.6rem;
      border-radius: var(--radius-card);
      background: var(--color-paddy-600);
      color: var(--color-ink-invert);
      font-size: 1.0625rem;
      font-weight: 700;
      box-shadow: var(--shadow-card);
      transition:
        background-color var(--duration-1) var(--ease-settle),
        box-shadow var(--duration-2) var(--ease-settle),
        transform var(--duration-1) var(--ease-settle);
    }

    .send:hover:not(:disabled) {
      background: var(--color-paddy-700);
      box-shadow: var(--shadow-lift);
    }

    .send:active:not(:disabled) {
      transform: scale(0.99);
    }

    .send:disabled {
      background: var(--color-surface-3);
      color: var(--color-ink-muted);
      box-shadow: none;
      cursor: not-allowed;
    }
  `,
})
export class ReviewSummary {
  readonly crop = input<Crop | null>(null);
  readonly imageCount = input(NONE);
  readonly fieldArea = input<number | null>(null);
  readonly fieldAreaUnit = input.required<FieldAreaUnit>();
  readonly cropQuantity = input<number | null>(null);
  readonly cropQuantityUnit = input<CropQuantityUnit | null>(null);
  readonly hasAudio = input(false);
  readonly hasNote = input(false);
  readonly canSubmit = input(false);
  readonly submitting = input(false);
  readonly retryable = input(false);

  readonly send = output<void>();

  protected readonly hasPhotos = computed(() => this.imageCount() > NONE);
  /** A number with no unit is not a quantity the server can use, so neither half is shown. */
  protected readonly quantityRow = computed(() => {
    const unit = this.cropQuantityUnit();
    const value = this.cropQuantity();
    if (unit === null || value === null) return null;
    return { value, unitKey: `${QUANTITY_UNIT_PREFIX}${unit}` };
  });
}
