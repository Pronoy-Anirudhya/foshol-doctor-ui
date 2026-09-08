import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { toPercentString } from '../../../core/util/percent';
import type { Candidate } from '../../../generated/models/candidate';
import type { Thresholds } from '../../../generated/models/thresholds';
import { CandidateSourceChip } from '../../../shared/ui/candidate-source-chip/candidate-source-chip';
import { ConfidenceBar } from '../../../shared/ui/confidence-bar/confidence-bar';

/**
 * The candidate list — and the protected wow factor of the whole console.
 *
 * `WEB-FR-220`…`223` are satisfied by `<foshol-confidence-bar>` itself: one bar per candidate,
 * both threshold lines on every bar, every number rendered as text, each line at exactly its
 * proportional position.
 *
 * What THIS component adds is the thing that turns a stack of bars into an argument: a matching
 * pair of **full-height rules** at the same two positions, running the length of the list, so
 * the two routing thresholds read as *columns across every candidate at once*. One
 * `position: absolute; inset-block: 0` element per threshold, positioned from the same
 * percentage strings the bars use — so a rule can never disagree with the line it extends.
 *
 * `WEB-NFR-011` — `low` and `high` arrive as an input bound from `AnalysisDetail.thresholds`.
 * Nothing in this file reads `APP_CONFIG`: a hard-coded line that disagrees with the routing
 * would be worse than no line at all.
 *
 * `WEB-FR-224` — the rules are the thresholds and nothing more. No band is shaded, no fill is
 * keyed to a band, no path is named. The decision path comes from the badge (`WEB-FR-215`).
 */
@Component({
  selector: 'foshol-candidate-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CandidateSourceChip, ConfidenceBar, TranslatePipe],
  templateUrl: './candidate-list.html',
  styleUrl: './candidate-list.css',
  host: {
    class: 'block',
    '[style.--cl-low]': 'lowPercent()',
    '[style.--cl-high]': 'highPercent()',
  },
})
export class CandidateList {
  readonly candidates = input.required<readonly Candidate[]>();
  /** `AnalysisDetail.thresholds`, never a constant (`WEB-NFR-011`). */
  readonly thresholds = input.required<Thresholds>();
  /** The disease the officer currently has selected, so the list shows what they chose. */
  readonly selectedDiseaseId = input<string | null>(null);

  /**
   * The same helper the bar uses, for the same reason: `0.45 * 100` is not `45` in IEEE-754,
   * and a rule a hair off the line it extends is a visible lie about the routing.
   */
  protected readonly lowPercent = computed(() => toPercentString(this.thresholds().low));
  protected readonly highPercent = computed(() => toPercentString(this.thresholds().high));
}
