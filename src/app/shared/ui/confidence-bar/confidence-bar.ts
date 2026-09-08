import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { translate } from '@ngx-translate/core';
import { toPercentString } from '../../../core/util/percent';

/**
 * The confidence bar — the protected wow factor (plan §8).
 *
 * It is what makes the two-threshold routing *visible* rather than described, so three
 * properties are load-bearing and are asserted by WEB-TEST-001:
 *
 *  - WEB-FR-221 — BOTH threshold lines are drawn on EVERY bar, always. A bar without them is
 *    a progress indicator, not an explanation.
 *  - WEB-FR-222 — the confidence and both thresholds are rendered as text, so the routing is
 *    readable without perceiving fill colour or line position (WEB-UX-044).
 *  - WEB-FR-224 — the bar NEVER derives, displays or implies a decision path. The fill is one
 *    colour at every value; the path comes from the decision-path badge (WEB-FR-215).
 *
 * WEB-NFR-011 — `low` and `high` are required inputs fed from `AnalysisDetail.thresholds`.
 * They are deliberately NOT read from APP_CONFIG: a hard-coded line that disagrees with the
 * routing is worse than no line at all.
 *
 * Every position is a CSS custom property holding a percentage string computed from a signal,
 * never measured geometry. jsdom has no layout engine, so a bar positioned by
 * `getBoundingClientRect` would be untestable — and this is the one component where a
 * rendering bug silently misrepresents the routing.
 */
@Component({
  selector: 'foshol-confidence-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './confidence-bar.html',
  styleUrl: './confidence-bar.css',
  host: {
    // The whole bar is one graphic; the aria-label states all three numbers (WEB-FR-222).
    role: 'img',
    '[attr.aria-label]': 'ariaLabel()',
    '[attr.data-compact]': 'compact()',
    '[style.--cb-fill]': 'fillPercent()',
    '[style.--cb-low]': 'lowPercent()',
    '[style.--cb-high]': 'highPercent()',
    'data-testid': 'confidence-bar',
  },
})
export class ConfidenceBar {
  /** The candidate's confidence over 0…1, exactly as the server returned it (WEB-NFR-001). */
  readonly confidence = input.required<number>();

  /** `AnalysisDetail.thresholds.low` — never APP_CONFIG (WEB-NFR-011). */
  readonly low = input.required<number>();

  /** `AnalysisDetail.thresholds.high` — never APP_CONFIG (WEB-NFR-011). */
  readonly high = input.required<number>();

  /** Denser geometry for use inside a small card. The threshold lines stay, always. */
  readonly compact = input(false);

  /**
   * WEB-FR-223 — each position is the exact proportional position of its value, and stays
   * exact when a confidence equals a threshold. `toPercentString` is the single helper that
   * keeps `0.45 * 100 === 45.00000000000001` off the screen.
   */
  readonly fillPercent = computed(() => toPercentString(this.confidence()));
  readonly lowPercent = computed(() => toPercentString(this.low()));
  readonly highPercent = computed(() => toPercentString(this.high()));

  private readonly ariaText = translate('badge.confidence.aria', () => ({
    value: this.fillPercent(),
    low: this.lowPercent(),
    high: this.highPercent(),
  }));

  readonly ariaLabel = computed(() => String(this.ariaText()));
}
