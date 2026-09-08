import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { toPercentString } from '../../../core/util/percent';
import type { AnalysisMode } from '../../../generated/models/analysis-mode';
import { AnalysisModeBadge } from '../../../shared/ui/analysis-mode-badge/analysis-mode-badge';
import type { CompositionSlice, QueueState } from '../queue-insight.adapter';

/**
 * What the loaded sample is made of: the review-task state mix, and the live/replay mix.
 *
 * Two thin proportional rails rather than two more charts — this is the lowest-value widget on
 * the page and it earns a glance, not a stare. Every segment's count and share are printed
 * beside it, so the rails are decoration over a table rather than the reading itself.
 *
 * The labels are reused rather than re-authored: `officer.queue.state.*` already names each
 * state in both languages for the console, and `<foshol-analysis-mode-badge>` is the component
 * that guarantees a replayed fixture can never be mistaken for live inference
 * (`WEB-FR-216` / `COMMON-UX-001`). A second set of words for the same values would be a second
 * thing to keep true.
 *
 * There is deliberately no `<foshol-decision-path-badge>` here. The routing bands are stated
 * once, on the confidence landscape, where the thresholds that produce them are also on screen.
 */

interface Segment<T extends string> {
  readonly key: T;
  readonly count: number;
  readonly width: string;
  readonly share: string;
}

@Component({
  selector: 'foshol-queue-composition',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, AnalysisModeBadge],
  templateUrl: './queue-composition.html',
  styleUrl: './queue-composition.css',
  host: { class: 'block', 'data-testid': 'queue-composition' },
})
export class QueueComposition {
  readonly states = input<readonly CompositionSlice<QueueState>[]>([]);
  readonly modes = input<readonly CompositionSlice<AnalysisMode>[]>([]);
  readonly rowsLoaded = input(0);

  private static sized<T extends string>(
    slices: readonly CompositionSlice<T>[],
  ): readonly Segment<T>[] {
    const total = slices.reduce((sum, slice) => sum + slice.count, 0);
    if (total === 0) return [];
    return slices.map((slice) => ({
      key: slice.key,
      count: slice.count,
      width: toPercentString(slice.count / total),
      share: toPercentString(slice.count / total),
    }));
  }

  protected readonly stateSegments = computed(() => QueueComposition.sized(this.states()));
  protected readonly modeSegments = computed(() => QueueComposition.sized(this.modes()));

  /** A mode the server did not send is not a mode; the difference is stated rather than hidden. */
  protected readonly modeUnknown = computed(
    () => this.rowsLoaded() - this.modes().reduce((sum, slice) => sum + slice.count, 0),
  );

  protected readonly hasRows = computed(() => this.rowsLoaded() > 0);
}
