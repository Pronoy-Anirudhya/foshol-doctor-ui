import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslatePipe, translate } from '@ngx-translate/core';
import { APP_CONFIG } from '../../../core/config/app-config';
import { toPercentString } from '../../../core/util/percent';
import type { DecisionPath } from '../../../generated/models/decision-path';
import { DecisionPathBadge } from '../../../shared/ui/decision-path-badge/decision-path-badge';
import type { BandTally, ConfidenceLandscapeView } from '../queue-insight.adapter';

/**
 * `WEB-FR-302` — the routing thresholds, read-only, drawn over the confidences they actually
 * routed.
 *
 * The panel this replaced stated two numbers and left the reader to imagine what they do. This
 * one puts the queue underneath them: a histogram of every loaded case's `topConfidence`, a rug
 * of the individual cases below the axis, and the two thresholds as rules cutting the scale into
 * the three bands — each band named, ranged, and tallied.
 *
 * Three things are load-bearing:
 *
 *  1. **The band tallies come from the server's `decisionPath`, not from this component.**
 *     Nothing here buckets a confidence against a threshold to decide a path, and the bars are
 *     deliberately ONE colour for exactly that reason: tinting a bar by the band it falls in
 *     would be re-deriving the routing rule (`WEB-NFR-001`). The rules mark the bands; the
 *     tallies count what the server did.
 *  2. **Geometry is CSS, not SVG, and never measured.** Every position is a percentage string
 *     computed from a signal into a custom property, exactly as `<foshol-confidence-bar>` does
 *     it — so the drawing is testable in jsdom, which has no layout engine, and can never
 *     disagree with the numbers printed beside it.
 *  3. **`APP_CONFIG.admin.confidenceBins` is 20 deliberately.** 0.45 × 20 = 9 and 0.75 × 20 = 15
 *     are integers, so both rules land exactly on a bin edge and can never bisect a bar. 24 bins
 *     would bisect both, and a rule through the middle of a bar is a picture of a lie.
 *
 * `WEB-UX-044` — every value that matters is also text: both thresholds, each band's range and
 * count, the peak bin, and the size of the sample. Nothing is carried by colour or position.
 */

/** The routing bands in ascending-confidence order — the contract's, not a preference. */
const BAND_ORDER: readonly DecisionPath[] = ['UNDETERMINED', 'SECONDARY', 'PRIMARY'];

interface Band {
  readonly path: DecisionPath;
  readonly rangeKey: string;
  /** The slice of the 0→1 scale this band owns, so the three always tile the rail exactly. */
  readonly width: string;
  /** `null` when the queue sample is unavailable: a band with an unknown tally, not a zero. */
  readonly count: number | null;
}

interface Bar {
  readonly index: number;
  readonly count: number;
  /** Height as a share of the fullest bin. A CSS floor keeps a bin of 1 visible beside 40. */
  readonly height: string;
  readonly peak: boolean;
}

@Component({
  selector: 'foshol-confidence-landscape',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, DecisionPathBadge],
  templateUrl: './confidence-landscape.html',
  styleUrl: './confidence-landscape.css',
  host: {
    class: 'block',
    '[style.--cl-low]': 'lowPercent()',
    '[style.--cl-high]': 'highPercent()',
    '[style.--cl-bins]': 'binCount',
    'data-testid': 'confidence-landscape',
  },
})
export class ConfidenceLandscape {
  /** `AdminStatsView.thresholds.low`, from the payload — never a fallback constant. */
  readonly low = input.required<number>();
  readonly high = input.required<number>();

  /** `null` when the queue sample never loaded or failed — empty state (a). */
  readonly landscape = input<ConfidenceLandscapeView | null>(null);
  /** `null` alongside a null landscape: the bands are known, their tallies are not. */
  readonly tallies = input<readonly BandTally[] | null>(null);
  /** Rows the server sent no `decisionPath` for. Text only, never a fourth band. */
  readonly unrouted = input(0);
  readonly rowsLoaded = input(0);
  readonly totalElements = input(0);

  protected readonly lowPercent = computed(() => toPercentString(this.low()));
  protected readonly highPercent = computed(() => toPercentString(this.high()));

  /**
   * The ends of the scale, as text. `0` and `1` are the definition of a confidence rather than
   * configuration, so `WEB-NFR-009` has no server property to point them at.
   */
  protected readonly startPercent = toPercentString(0);
  protected readonly endPercent = toPercentString(1);

  /** Unitless, read by `grid-template-columns: repeat(var(--cl-bins), 1fr)`. */
  protected readonly binCount = String(APP_CONFIG.admin.confidenceBins);

  protected readonly rangeParams = computed(() => ({
    low: this.lowPercent(),
    high: this.highPercent(),
  }));

  /** Which of the three empty states — or none — the figure is in. */
  protected readonly mode = computed<'plot' | 'unavailable' | 'noRows' | 'noConfidence'>(() => {
    const data = this.landscape();
    if (data === null) return 'unavailable';
    if (data.scored + data.unscored === 0) return 'noRows';
    return data.scored === 0 ? 'noConfidence' : 'plot';
  });

  protected readonly bands = computed<readonly Band[]>(() => {
    const low = this.low();
    const high = this.high();
    const tallies = this.tallies();
    const widths: Record<DecisionPath, number> = {
      UNDETERMINED: low,
      SECONDARY: high - low,
      PRIMARY: 1 - high,
    };
    return BAND_ORDER.map((path) => ({
      path,
      rangeKey: `admin.stats.band.${path}.range`,
      width: toPercentString(widths[path]),
      count: tallies?.find((tally) => tally.path === path)?.count ?? null,
    }));
  });

  protected readonly bars = computed<readonly Bar[]>(() => {
    const data = this.landscape();
    if (data === null || data.peakCount === 0) return [];
    return data.bins.map((count, index) => ({
      index,
      count,
      height: toPercentString(count / data.peakCount),
      peak: index === data.peakBin,
    }));
  });

  /** One tick per scored case, at its own x position — six ticks read precise; six bars do not. */
  protected readonly ticks = computed<readonly string[]>(
    () => this.landscape()?.ticks.map(toPercentString) ?? [],
  );

  protected readonly scored = computed(() => this.landscape()?.scored ?? 0);
  protected readonly unscored = computed(() => this.landscape()?.unscored ?? 0);

  /** The fullest bin, stated as its range in text so the highlight is never the only signal. */
  protected readonly peakParams = computed(() => {
    const data = this.landscape();
    const bins = APP_CONFIG.admin.confidenceBins;
    const index = data?.peakBin ?? -1;
    return {
      count: data?.peakCount ?? 0,
      from: index < 0 ? this.startPercent : toPercentString(index / bins),
      to: index < 0 ? this.endPercent : toPercentString((index + 1) / bins),
    };
  });

  protected readonly sampleParams = computed(() => ({
    rows: this.rowsLoaded(),
    total: this.totalElements(),
  }));

  private readonly ariaText = translate('admin.landscape.aria', () => ({
    low: this.lowPercent(),
    high: this.highPercent(),
    scored: this.scored(),
    rows: this.rowsLoaded(),
  }));

  protected readonly ariaLabel = computed(() => String(this.ariaText()));
}
