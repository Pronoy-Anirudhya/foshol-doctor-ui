import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslatePipe, translate } from '@ngx-translate/core';
import { formatDhakaDateTime } from '../../../core/time/dhaka-time';
import { toPercentString } from '../../../core/util/percent';
import { DhakaDateTimePipe } from '../../../shared/pipes/dhaka-date-time.pipe';
import type { CadenceView } from '../queue-insight.adapter';

/**
 * When the loaded cases arrived — the one graphic on this page that earns an `<svg>`, because
 * CSS cannot draw a polyline and a bar chart of twelve buckets says less than a line does.
 *
 * **The honesty problem this widget is mostly made of.** Queue page 0 returns the newest
 * submissions first. That order is chronological, but a single page of it is still only the most
 * recent slice of the queue — never a census — so the rows loaded remain a *biased* sample of
 * submissions and the shape drawn from them is not the arrival rate of the system. The caption
 * therefore always states three things: how many rows were loaded, how many exist, and the ends
 * of the OBSERVED window in Dhaka time. Bucketing across a fixed clock window instead would
 * invent empty buckets for hours there is no evidence about.
 *
 * Below `APP_CONFIG.admin.cadenceMinRows` timestamps, or across a window of zero width, the
 * adapter returns no buckets at all and this component draws **no line** — a polyline through
 * two points is a trend the data cannot support. The summary stands alone.
 *
 * **The SVG trap, and why the dots are HTML.** A sparkline that fills its container needs
 * `preserveAspectRatio="none"`. Under it the viewBox is stretched independently in x and y, so
 * strokes squash (fixed with `vector-effect="non-scaling-stroke"`) and `<circle>` and `<text>`
 * distort with no fix at all. So the SVG carries ONLY the polyline and its area fill; every dot
 * and label is an HTML sibling positioned from a percentage custom property.
 */

/**
 * The sparkline's own coordinate space — a presentation constant, not a tunable (cf.
 * `MINUTE_DECIMALS` in `admin-stats-page.ts`). `preserveAspectRatio="none"` stretches this
 * square to whatever box CSS gives it, so the number only sets the arithmetic's precision.
 */
const VIEW = 100;
/** Two decimals of a 0–100 space is sub-pixel at any width this ever renders at. */
const COORD_DECIMALS = 2;

interface Dot {
  readonly index: number;
  readonly count: number;
  readonly x: string;
  readonly y: string;
  readonly peak: boolean;
}

const round = (value: number): number => {
  const factor = 10 ** COORD_DECIMALS;
  return Math.round(value * factor) / factor;
};

@Component({
  selector: 'foshol-submission-cadence',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, DhakaDateTimePipe],
  templateUrl: './submission-cadence.html',
  styleUrl: './submission-cadence.css',
  host: { class: 'block', 'data-testid': 'submission-cadence' },
})
export class SubmissionCadence {
  /** `null` while the queue sample has never loaded. */
  readonly cadence = input<CadenceView | null>(null);
  readonly rowsLoaded = input(0);
  readonly totalElements = input(0);

  protected readonly viewBox = `0 0 ${VIEW} ${VIEW}`;

  protected readonly counted = computed(() => this.cadence()?.counted ?? 0);

  /** Empty buckets are the adapter's refusal to draw, not an absence of data. */
  protected readonly hasLine = computed(() => (this.cadence()?.buckets.length ?? 0) > 0);

  protected readonly fromDate = computed(() => {
    const ms = this.cadence()?.fromMs ?? null;
    return ms === null ? null : new Date(ms);
  });

  protected readonly toDate = computed(() => {
    const ms = this.cadence()?.toMs ?? null;
    return ms === null ? null : new Date(ms);
  });

  /** Normalised 0…1 heights, the one intermediate every other computed reads. */
  private readonly heights = computed<readonly number[]>(() => {
    const view = this.cadence();
    if (view === null || view.buckets.length === 0 || view.peakCount === 0) return [];
    return view.buckets.map((count) => count / view.peakCount);
  });

  private readonly points = computed<readonly { x: number; y: number }[]>(() => {
    const heights = this.heights();
    const last = heights.length - 1;
    if (last <= 0) return [];
    return heights.map((height, index) => ({
      x: round((index / last) * VIEW),
      y: round(VIEW - height * VIEW),
    }));
  });

  protected readonly linePoints = computed(() =>
    this.points()
      .map((point) => `${point.x},${point.y}`)
      .join(' '),
  );

  /** The line, closed along the baseline. Drawn first so the stroke sits over its own fill. */
  protected readonly areaPoints = computed(() => {
    const line = this.linePoints();
    return line === '' ? '' : `0,${VIEW} ${line} ${VIEW},${VIEW}`;
  });

  protected readonly dots = computed<readonly Dot[]>(() => {
    const view = this.cadence();
    const heights = this.heights();
    const last = heights.length - 1;
    if (view === null || last <= 0) return [];
    return heights.map((height, index) => ({
      index,
      count: view.buckets[index] ?? 0,
      x: toPercentString(index / last),
      // Measured from the top, because that is the direction CSS positions from.
      y: toPercentString(1 - height),
      peak: (view.buckets[index] ?? 0) === view.peakCount,
    }));
  });

  protected readonly summaryParams = computed(() => ({
    counted: this.counted(),
    rows: this.rowsLoaded(),
    total: this.totalElements(),
  }));

  protected readonly peakParams = computed(() => ({
    count: this.cadence()?.peakCount ?? 0,
  }));

  /** The whole figure in one sentence, so the shape is readable without seeing it. */
  private readonly ariaText = translate('admin.cadence.aria', () => ({
    counted: this.counted(),
    rows: this.rowsLoaded(),
    total: this.totalElements(),
    from: formatDhakaDateTime(this.fromDate()),
    to: formatDhakaDateTime(this.toDate()),
  }));

  protected readonly ariaLabel = computed(() => String(this.ariaText()));
}
