import { computed, DestroyRef, inject, signal } from '@angular/core';
import { MS_PER_SECOND } from '../../../core/auth/auth-facade';

/**
 * A one-second countdown, as a signal.
 *
 * The file is named `*countdown*` deliberately: `scripts/check-architecture.mjs` exempts
 * countdown timers from the `WEB-FR-356` `setInterval` ban. That ban exists to stop an
 * endpoint being polled — nothing here touches the network, it only decrements a number.
 *
 * Two of these run on the farmer login: the OTP challenge lifetime (`WEB-FR-010`) and the
 * rate-limit wait derived from `Retry-After` (`WEB-FR-011`).
 */

/** mm:ss formatting, not a tunable — see the note on `MS_PER_SECOND` in `auth-facade.ts`. */
const SECONDS_PER_MINUTE = 60;
const SECONDS_DIGITS = 2;

export class Countdown {
  private readonly _remaining = signal(0);
  private handle: ReturnType<typeof setInterval> | null = null;

  readonly remaining = this._remaining.asReadonly();
  readonly active = computed(() => this._remaining() > 0);
  readonly display = computed(() => formatMinutesSeconds(this._remaining()));

  /** Constructed as a component field, so the injection context is the component's own. */
  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  start(seconds: number): void {
    this.stop();
    const whole = Math.max(0, Math.floor(seconds));
    this._remaining.set(whole);
    if (whole === 0) return;

    this.handle = setInterval(() => {
      const next = Math.max(0, this._remaining() - 1);
      this._remaining.set(next);
      if (next === 0) this.stop();
    }, MS_PER_SECOND);
  }

  stop(): void {
    if (this.handle !== null) {
      clearInterval(this.handle);
      this.handle = null;
    }
  }
}

export function formatMinutesSeconds(totalSeconds: number): string {
  const whole = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(whole / SECONDS_PER_MINUTE);
  const seconds = whole % SECONDS_PER_MINUTE;
  return `${minutes}:${String(seconds).padStart(SECONDS_DIGITS, '0')}`;
}
