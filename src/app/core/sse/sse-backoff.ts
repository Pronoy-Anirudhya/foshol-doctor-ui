import { APP_CONFIG } from '../config/app-config';

/**
 * WEB-FR-355 — the reconnect delay schedule, as a pure function.
 *
 * `rand` is injected rather than reached for, and that is the whole point: with
 * `rand = () => 0.5` the jitter term is exactly zero, so WEB-TEST-005 can assert the delay
 * sequence, the cap and the reset as equalities instead of as ranges.
 */
export interface SseBackoffConfig {
  readonly initialRetryMs: number;
  readonly maxRetryMs: number;
  readonly backoffMultiplier: number;
  readonly jitterRatio: number;
}

export const DEFAULT_BACKOFF: SseBackoffConfig = {
  initialRetryMs: APP_CONFIG.sse.initialRetryMs,
  maxRetryMs: APP_CONFIG.sse.maxRetryMs,
  backoffMultiplier: APP_CONFIG.sse.backoffMultiplier,
  jitterRatio: APP_CONFIG.sse.jitterRatio,
};

/**
 * `attempt` is zero-based: attempt 0 is the first reconnect after a connection was lost, and
 * yields `initialRetryMs` before jitter.
 *
 * The exponential is capped BEFORE jitter is applied, then the jittered result is clamped to
 * `[0, maxRetryMs]`, so an unlucky draw can never push a delay past the configured ceiling.
 */
export function nextDelayMs(
  attempt: number,
  cfg: SseBackoffConfig = DEFAULT_BACKOFF,
  rand: () => number = Math.random,
): number {
  const steps = Math.max(0, Math.floor(attempt));
  const exponential = cfg.initialRetryMs * Math.pow(cfg.backoffMultiplier, steps);
  const base = Math.min(exponential, cfg.maxRetryMs);

  // rand() ∈ [0, 1) mapped to [-1, 1), scaled by the jitter ratio: ± jitterRatio of base.
  const jitterFraction = (rand() * 2 - 1) * cfg.jitterRatio;
  const jittered = Math.round(base * (1 + jitterFraction));

  return Math.min(cfg.maxRetryMs, Math.max(0, jittered));
}
