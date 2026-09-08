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
 * shape. The shapes escalate on their own (dash → disc → triangle → diamond → octagon), so the
 * ordering survives greyscale, a projector with a broken colour channel, and colour blindness.
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
