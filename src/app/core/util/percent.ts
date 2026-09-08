import { APP_CONFIG } from '../config/app-config';

/**
 * The single helper every confidence value and threshold position goes through.
 *
 * WEB-FR-223 requires a threshold line to sit at exactly the proportional position of its
 * value, and to remain correct when a candidate's confidence equals a threshold exactly. In
 * IEEE-754, `0.45 * 100 === 45.00000000000001`, so a naive template expression puts the line
 * a hair off and the boundary test in WEB-TEST-001 is precisely there to catch it.
 */
export function toPercentString(value: number): string {
  return `${toPercentNumber(value)}%`;
}

export function toPercentNumber(value: number): number {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  const factor = 10 ** APP_CONFIG.ui.percentPrecision;
  return Math.round(clamped * 100 * factor) / factor;
}
