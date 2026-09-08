import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { ExtractedSymptom } from '../../../generated/models/extracted-symptom';
import { toPercentString } from '../../../core/util/percent';

/**
 * WEB-DATA-001 — the matcher union comes from the generated schema. It is nullable there
 * (an officer-recorded symptom may carry no matcher), so the chip takes the non-null form and
 * the caller decides whether to render a chip at all.
 */
export type SymptomMatcher = NonNullable<ExtractedSymptom['matcher']>;

/**
 * WEB-FR-214 — an officer's trust in a symptom depends on how it was found: a fuzzy token
 * match and a vector match are not the same claim, and a manually recorded symptom is not a
 * claim by the machine at all. So the three are separated by glyph, by colour, by border
 * treatment and by their own text label — the difference has to be legible at a glance, in a
 * list of a dozen chips, by someone who is about to approve pesticide advice.
 *
 * The chip carries the matcher and the score. The symptom name is rendered by the caller: it
 * is human-supplied agricultural content and this component never touches it
 * (COMMON-CON-003).
 */
@Component({
  selector: 'foshol-matcher-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  templateUrl: './matcher-chip.html',
  styleUrl: './matcher-chip.css',
  host: {
    class: 'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold',
    '[attr.data-matcher]': 'matcher()',
    'data-testid': 'matcher-chip',
  },
})
export class MatcherChip {
  readonly matcher = input.required<SymptomMatcher>();

  /** `ExtractedSymptom.score`, over 0…1, rendered exactly as the server produced it. */
  readonly score = input.required<number>();

  readonly labelKey = computed(() => `badge.matcher.${this.matcher()}`);

  /** The same helper the confidence bar uses, so one score never reads two ways. */
  readonly scoreText = computed(() => toPercentString(this.score()));
}
