import { Pipe, type PipeTransform } from '@angular/core';
import { toPercentNumber } from '../../core/util/percent';

/**
 * A confidence or threshold as a percentage carrying at most one decimal.
 *
 * The rounding itself is `core/util/percent`, which exists because `0.45 * 100` is not `45`
 * in IEEE-754 and a threshold line a hair off its value is exactly the bug WEB-TEST-001
 * hunts. This pipe only reduces the already-correct number to display precision, so the
 * boundary case stays exact: 0.45 → 45, never 45.0000001.
 *
 * Returns a number rather than a string so the same expression can feed both the visible
 * label and `aria-valuenow` (WEB-UX-044).
 */
const DISPLAY_DECIMALS = 1; // presentation precision, not a tunable threshold
const DECIMAL_FACTOR = 10 ** DISPLAY_DECIMALS;

@Pipe({ name: 'percent1' })
export class Percent1Pipe implements PipeTransform {
  transform(value: number | null | undefined): number {
    return Math.round(toPercentNumber(value ?? 0) * DECIMAL_FACTOR) / DECIMAL_FACTOR;
  }
}
