import { APP_CONFIG } from '../config/app-config';
import { DEFAULT_BACKOFF, nextDelayMs } from './sse-backoff';

/**
 * WEB-TEST-005 / AC-20 — the delay sequence, the cap and the jitter envelope, asserted as
 * equalities. That is only possible because `rand` is injected: with `rand = () => 0.5` the
 * jitter term is exactly zero.
 */
describe('nextDelayMs (WEB-FR-355)', () => {
  const noJitter = (): number => 0.5;

  it('produces the exact documented sequence and caps at maxRetryMs', () => {
    const sequence = [0, 1, 2, 3, 4, 5, 6].map((attempt) => nextDelayMs(attempt, DEFAULT_BACKOFF, noJitter));
    expect(sequence).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });

  it('never exceeds the cap however far the attempt counter runs', () => {
    for (const attempt of [7, 12, 40, 1000]) {
      expect(nextDelayMs(attempt, DEFAULT_BACKOFF, noJitter)).toBe(APP_CONFIG.sse.maxRetryMs);
    }
  });

  it('applies jitter within ± jitterRatio of the uncapped base', () => {
    // rand() = 0 is the bottom of the envelope, rand() = 1 the top.
    expect(nextDelayMs(1, DEFAULT_BACKOFF, () => 0)).toBe(1600);
    expect(nextDelayMs(1, DEFAULT_BACKOFF, () => 1)).toBe(2400);
    expect(nextDelayMs(0, DEFAULT_BACKOFF, () => 0)).toBe(800);
    expect(nextDelayMs(0, DEFAULT_BACKOFF, () => 1)).toBe(1200);
  });

  it('clamps a jittered delay at the cap rather than letting an unlucky draw exceed it', () => {
    expect(nextDelayMs(9, DEFAULT_BACKOFF, () => 1)).toBe(APP_CONFIG.sse.maxRetryMs);
    expect(nextDelayMs(9, DEFAULT_BACKOFF, () => 0)).toBe(24000);
  });

  it('is never negative, whatever the draw', () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
        expect(nextDelayMs(attempt, DEFAULT_BACKOFF, () => r)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('treats a negative or fractional attempt as attempt zero', () => {
    expect(nextDelayMs(-3, DEFAULT_BACKOFF, noJitter)).toBe(1000);
    expect(nextDelayMs(0.9, DEFAULT_BACKOFF, noJitter)).toBe(1000);
  });

  it('adopts a server-proposed base delay from a retry: frame', () => {
    const serverProposed = { ...DEFAULT_BACKOFF, initialRetryMs: 4500 };
    expect(nextDelayMs(0, serverProposed, noJitter)).toBe(4500);
    expect(nextDelayMs(1, serverProposed, noJitter)).toBe(9000);
  });

  it('mirrors app-config rather than hard-coding the schedule (WEB-NFR-009)', () => {
    expect(DEFAULT_BACKOFF).toEqual({
      initialRetryMs: APP_CONFIG.sse.initialRetryMs,
      maxRetryMs: APP_CONFIG.sse.maxRetryMs,
      backoffMultiplier: APP_CONFIG.sse.backoffMultiplier,
      jitterRatio: APP_CONFIG.sse.jitterRatio,
    });
  });
});
