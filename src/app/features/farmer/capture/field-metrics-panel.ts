import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { APP_CONFIG } from '../../../core/config/app-config';
import type {
  CropQuantityUnit,
  FieldAreaUnit,
} from '../../../core/stores/case-draft-store';

/**
 * How much land, and how much crop — the two numbers a remedy dose is reckoned from.
 *
 * `fieldArea` and `fieldAreaUnit` are **required** by the multipart contract, so this panel is
 * not optional decoration: without it every submission is a 400. The quantity pair is optional
 * and framed that way.
 *
 * The farmer may also state either figure in the voice note. The SERVER decides which source it
 * used and reports it back as `CaseDetail.metricsSource` (`WEB-NFR-001`) — this panel never
 * merges, overrides or second-guesses the spoken value, it only offers the typed path so a
 * farmer who would rather not speak still gets a quantified remedy.
 *
 * Deliberately no Angular forms: the whole capture screen is signals plus raw DOM events, and a
 * `ReactiveFormsModule` import here would be the only one on the route.
 */

/** Both unit sets come from the generated schema via the store, so neither can drift. */
const AREA_UNITS: readonly FieldAreaUnit[] = ['DECIMAL', 'SQ_M', 'SQ_FT', 'HECTARE', 'ACRE'];
const QUANTITY_UNITS: readonly CropQuantityUnit[] = ['KG', 'TON', 'PLANTS', 'BIGHAS_EQUIV'];

const FIELD_CLASS =
  'mt-1.5 w-full touch-target rounded-xl border border-surface-3 bg-surface-0 px-3 text-ink tabular font-latin transition-colors duration-1 ease-settle hover:border-paddy-300';
const UNIT_CLASS =
  'mt-1.5 w-full touch-target rounded-xl border border-surface-3 bg-surface-0 px-3 text-sm text-ink transition-colors duration-1 ease-settle hover:border-paddy-300';

@Component({
  selector: 'foshol-field-metrics-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  host: { class: 'block' },
  template: `
    <div class="row">
      <div class="grow">
        <label class="metric-label" for="field-area">
          {{ 'farmer.capture.field.areaLabel' | translate }}
          <span class="required" aria-hidden="true">*</span>
        </label>
        <input
          id="field-area"
          type="number"
          inputmode="decimal"
          data-testid="field-area"
          [class]="fieldClass"
          [attr.min]="areaMin"
          [attr.max]="areaMax"
          [attr.step]="areaStep"
          [attr.required]="true"
          [value]="fieldArea() ?? ''"
          [attr.aria-describedby]="showAreaError() ? 'field-area-error' : null"
          [attr.aria-invalid]="showAreaError() ? 'true' : null"
          [attr.aria-errormessage]="showAreaError() ? 'field-area-error' : null"
          (input)="onArea($event)"
        />
      </div>
      <div class="unit">
        <label class="metric-label" for="field-area-unit">
          {{ 'farmer.capture.field.areaUnitLabel' | translate }}
        </label>
        <select
          id="field-area-unit"
          data-testid="field-area-unit"
          [class]="unitClass"
          (change)="onAreaUnit($event)"
        >
          @for (unit of areaUnits; track unit) {
            <option [value]="unit" [selected]="unit === fieldAreaUnit()">
              {{ 'shared.unit.area.' + unit | translate }}
            </option>
          }
        </select>
      </div>
    </div>

    @if (showAreaError()) {
      <p id="field-area-error" class="metric-error" data-testid="field-area-error">
        {{ 'farmer.capture.field.areaRequired' | translate }}
      </p>
    }

    <p class="optional-legend">{{ 'farmer.capture.field.quantityLegend' | translate }}</p>

    <div class="row">
      <div class="grow">
        <label class="metric-label" for="crop-quantity">
          {{ 'farmer.capture.field.quantityLabel' | translate }}
        </label>
        <input
          id="crop-quantity"
          type="number"
          inputmode="decimal"
          data-testid="crop-quantity"
          [class]="fieldClass"
          [attr.min]="quantityMin"
          [attr.max]="quantityMax"
          [attr.step]="quantityStep"
          [value]="cropQuantity() ?? ''"
          (input)="onQuantity($event)"
        />
      </div>
      <div class="unit">
        <label class="metric-label" for="crop-quantity-unit">
          {{ 'farmer.capture.field.quantityUnitLabel' | translate }}
        </label>
        <select
          id="crop-quantity-unit"
          data-testid="crop-quantity-unit"
          [class]="unitClass"
          (change)="onQuantityUnit($event)"
        >
          <option value="" [selected]="cropQuantityUnit() === null">
            {{ 'farmer.capture.field.quantityUnitNone' | translate }}
          </option>
          @for (unit of quantityUnits; track unit) {
            <option [value]="unit" [selected]="unit === cropQuantityUnit()">
              {{ 'shared.unit.quantity.' + unit | translate }}
            </option>
          }
        </select>
      </div>
    </div>
  `,
  styles: `
    /* WEB-UX-034 — the responsive part is Tailwind's breakpoints in the template; no component
       stylesheet in this application writes a media query of its own. */
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      align-items: flex-start;
    }

    .grow {
      flex: 1 1 9rem;
      min-inline-size: 0;
    }

    .unit {
      flex: 1 1 9rem;
      min-inline-size: 0;
    }

    .metric-label {
      display: block;
      font-weight: 700;
      color: var(--color-ink);
    }

    .required {
      color: var(--color-clay-600);
    }

    .metric-error {
      margin-block-start: 0.4rem;
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--color-clay-700);
    }

    .optional-legend {
      margin-block: 1.1rem 0.15rem;
      font-size: 0.875rem;
      color: var(--color-ink-muted);
    }
  `,
})
export class FieldMetricsPanel {
  readonly fieldArea = input<number | null>(null);
  readonly fieldAreaUnit = input.required<FieldAreaUnit>();
  readonly cropQuantity = input<number | null>(null);
  readonly cropQuantityUnit = input<CropQuantityUnit | null>(null);
  /** Set once the farmer has tried to submit, so an untouched form is not scolded on arrival. */
  readonly showAreaError = input(false);

  readonly areaChanged = output<number | null>();
  readonly areaUnitChanged = output<FieldAreaUnit>();
  readonly quantityChanged = output<number | null>();
  readonly quantityUnitChanged = output<CropQuantityUnit | null>();

  protected readonly areaUnits = AREA_UNITS;
  protected readonly quantityUnits = QUANTITY_UNITS;
  protected readonly fieldClass = FIELD_CLASS;
  protected readonly unitClass = UNIT_CLASS;

  protected readonly areaMin = APP_CONFIG.intake.metrics.fieldAreaMin;
  protected readonly areaMax = APP_CONFIG.intake.metrics.fieldAreaMax;
  protected readonly areaStep = APP_CONFIG.intake.metrics.fieldAreaStep;
  protected readonly quantityMin = APP_CONFIG.intake.metrics.cropQuantityMin;
  protected readonly quantityMax = APP_CONFIG.intake.metrics.cropQuantityMax;
  protected readonly quantityStep = APP_CONFIG.intake.metrics.cropQuantityStep;

  protected onArea(event: Event): void {
    this.areaChanged.emit(numberOrNull(event));
  }

  protected onQuantity(event: Event): void {
    this.quantityChanged.emit(numberOrNull(event));
  }

  protected onAreaUnit(event: Event): void {
    this.areaUnitChanged.emit((event.target as HTMLSelectElement).value as FieldAreaUnit);
  }

  protected onQuantityUnit(event: Event): void {
    const chosen = (event.target as HTMLSelectElement).value;
    this.quantityUnitChanged.emit(chosen === '' ? null : (chosen as CropQuantityUnit));
  }
}

/**
 * An emptied or half-typed number field reads back as `''` or `NaN`. Both mean "no value yet",
 * and neither may reach the request body as a number.
 */
function numberOrNull(event: Event): number | null {
  const raw = (event.target as HTMLInputElement).value.trim();
  if (raw.length === 0) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}
