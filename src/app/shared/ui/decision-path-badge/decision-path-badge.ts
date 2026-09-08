import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { DecisionPath } from '../../../generated/models/decision-path';

/**
 * WEB-FR-215 — renders `PRIMARY`, `SECONDARY` or `UNDETERMINED` exactly as received. The
 * routing decision belongs to the backend (WEB-NFR-001); this component has no branch that
 * could compute one, which is why the value arrives as a required input and is only ever used
 * to select a label key and a glyph.
 *
 * WEB-UX-044 — the text value is always visible; the colour and the glyph are reinforcement,
 * never the carrier.
 */
@Component({
  selector: 'foshol-decision-path-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  templateUrl: './decision-path-badge.html',
  styleUrl: './decision-path-badge.css',
  host: {
    class:
      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-sm font-semibold',
    '[attr.data-path]': 'path()',
    'data-testid': 'decision-path-badge',
  },
})
export class DecisionPathBadge {
  readonly path = input.required<DecisionPath>();

  readonly labelKey = computed(() => `badge.decisionPath.${this.path()}`);
}
