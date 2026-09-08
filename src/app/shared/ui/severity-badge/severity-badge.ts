import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { Disease } from '../../../generated/models/disease';

/**
 * WEB-DATA-001 — the severity union is taken from the generated schema rather than re-declared
 * here. `Disease.severity` is the only place the contract spells it out.
 */
export type Severity = Disease['severity'];

/**
 * WEB-FR-156 / WEB-UX-044 — a severity indicator carries a colour AND a text label AND a
 * shape. The shapes escalate on their own (struck circle → ring and dot → rounded square →
 * triangle → octagon), so the ordering survives greyscale, a projector with a broken colour
 * channel, and colour blindness.
 *
 * The ladder is shared with `pictogram/severity-glyph.ts`, which draws the same five levels
 * filled at 24 px where this draws them stroked at 16 px — a fill reads as a blob that small,
 * a stroke reads as a hole that large, so the rendering differs on purpose but the SHAPES may
 * not. They disagreed once, with the triangle meaning MODERATE here and HIGH there: the same
 * mark carrying two different levels on two surfaces of the same case, which is precisely the
 * failure WEB-UX-044 exists to prevent. The triangle is the warning shape — `icon.ts` spends it
 * on `warning` as well — so it is HIGH in both, and MODERATE took the rounded square.
 */
@Component({
  selector: 'foshol-severity-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  templateUrl: './severity-badge.html',
  styleUrl: './severity-badge.css',
  host: {
    class:
      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-sm font-semibold',
    '[attr.data-severity]': 'severity()',
    'data-testid': 'severity-badge',
  },
})
export class SeverityBadge {
  readonly severity = input.required<Severity>();

  readonly labelKey = computed(() => `badge.severity.${this.severity()}`);
}
