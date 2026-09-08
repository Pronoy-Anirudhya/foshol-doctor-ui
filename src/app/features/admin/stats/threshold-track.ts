import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslatePipe, translate } from '@ngx-translate/core';
import { toPercentString } from '../../../core/util/percent';
import type { DecisionPath } from '../../../generated/models/decision-path';
import { DecisionPathBadge } from '../../../shared/ui/decision-path-badge/decision-path-badge';

/**
 * `WEB-FR-302` — both routing thresholds, read-only, drawn as ONE 0→1 track rather than two
 * bare numbers.
 *
 * Two numbers on a card state the configuration. The point of the requirement (plan
 * clarification 20) is that the *two-threshold routing story* is on screen, so the track shows
 * what the pair actually does: the low line, the high line, and the three bands they cut the
 * scale into, each band named with the decision path a case in it takes.
 *
 * `WEB-UX-044` — every band carries its name as TEXT via `<foshol-decision-path-badge>` and its
 * numeric range beside it, so nothing here is carried by colour or position alone. The whole
 * track additionally exposes one `aria-label` stating both values.
 *
 * `WEB-NFR-001` / `WEB-NFR-011` — the values are inputs fed from the API response; this
 * component computes no routing and reads no fallback constant. A line that disagrees with the
 * routing that produced it is worse than no line at all.
 *
 * Geometry follows `<foshol-confidence-bar>` deliberately, so the officer console and the admin
 * page draw the same threshold in the same way: every position is a percentage string set as a
 * CSS custom property from a signal, never measured layout.
 */
interface Band {
  readonly path: DecisionPath;
  readonly rangeKey: string;
  readonly width: string;
}

@Component({
  selector: 'foshol-threshold-track',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, DecisionPathBadge],
  templateUrl: './threshold-track.html',
  styleUrl: './threshold-track.css',
  host: {
    class: 'block',
    '[style.--tt-low]': 'lowPercent()',
    '[style.--tt-high]': 'highPercent()',
    'data-testid': 'threshold-track',
  },
})
export class ThresholdTrack {
  readonly low = input.required<number>();
  readonly high = input.required<number>();

  protected readonly lowPercent = computed(() => toPercentString(this.low()));
  protected readonly highPercent = computed(() => toPercentString(this.high()));

  /**
   * The ends of the scale, stated as text so the domain is never left to be inferred. `0` and
   * `1` are the definition of a confidence, not configuration, so `WEB-NFR-009` does not send
   * them to `APP_CONFIG` — there is no value the server could send that would change them.
   */
  protected readonly startPercent = toPercentString(0);
  protected readonly endPercent = toPercentString(1);

  /**
   * Widths, not positions: each band is the slice of the scale between the two lines that
   * bound it, so the three always tile the track exactly however the thresholds move.
   */
  protected readonly bands = computed<readonly Band[]>(() => {
    const low = this.low();
    const high = this.high();
    return [
      {
        path: 'UNDETERMINED',
        rangeKey: 'admin.stats.band.UNDETERMINED.range',
        width: toPercentString(low),
      },
      {
        path: 'SECONDARY',
        rangeKey: 'admin.stats.band.SECONDARY.range',
        width: toPercentString(high - low),
      },
      {
        path: 'PRIMARY',
        rangeKey: 'admin.stats.band.PRIMARY.range',
        width: toPercentString(1 - high),
      },
    ];
  });

  /** Both values in one string, so the track is readable without seeing it (WEB-UX-044). */
  private readonly ariaText = translate('admin.stats.thresholds.aria', () => ({
    low: this.lowPercent(),
    high: this.highPercent(),
  }));

  protected readonly ariaLabel = computed(() => String(this.ariaText()));

  protected readonly rangeParams = computed(() => ({
    low: this.lowPercent(),
    high: this.highPercent(),
  }));
}
