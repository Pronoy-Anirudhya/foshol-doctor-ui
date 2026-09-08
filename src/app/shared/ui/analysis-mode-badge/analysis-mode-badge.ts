import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { AnalysisMode } from '../../../generated/models/analysis-mode';

/**
 * WEB-FR-216 / COMMON-UX-001 — every case detail says whether the analysis it is showing came
 * from live inference or from a replayed fixture. Nobody in the room should ever be able to
 * mistake one for the other, so `LIVE` carries a pulsing dot and `REPLAY` is deliberately
 * archival: dashed border, muted surface, a stacked-record glyph.
 */
@Component({
  selector: 'foshol-analysis-mode-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  templateUrl: './analysis-mode-badge.html',
  styleUrl: './analysis-mode-badge.css',
  host: {
    class:
      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-sm font-semibold',
    '[attr.data-mode]': 'mode()',
    'data-testid': 'analysis-mode-badge',
  },
})
export class AnalysisModeBadge {
  readonly mode = input.required<AnalysisMode>();

  readonly labelKey = computed(() => `badge.analysisMode.${this.mode()}`);
}
