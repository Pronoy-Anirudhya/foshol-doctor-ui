import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { Candidate } from '../../../generated/models/candidate';

/** WEB-DATA-001 — `Candidate.source` is where the contract spells this union out. */
export type CandidateSource = Candidate['source'];

/**
 * Where a candidate came from. `analysis` and `knowledge` are separate modules deliberately —
 * the AI can be wrong and the knowledge base is authoritative — so a candidate the model
 * produced, one the knowledge base contributed, and one that is both are three different
 * claims, and the officer should not have to work out which is which.
 */
@Component({
  selector: 'foshol-candidate-source-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  templateUrl: './candidate-source-chip.html',
  styleUrl: './candidate-source-chip.css',
  host: {
    class: 'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold',
    '[attr.data-source]': 'source()',
    'data-testid': 'candidate-source-chip',
  },
})
export class CandidateSourceChip {
  readonly source = input.required<CandidateSource>();

  readonly labelKey = computed(() => `badge.source.${this.source()}`);
}
