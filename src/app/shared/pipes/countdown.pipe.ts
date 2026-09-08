import { Pipe, type PipeTransform } from '@angular/core';
import { APP_CONFIG } from '../../core/config/app-config';

/**
 * Milliseconds remaining → `mm:ss`, for the officer claim timer (`review.claimTtlMs`) and the
 * OTP expiry (`auth.otpTtlMs`).
 *
 * A negative remainder renders `00:00` rather than a minus sign: an expired claim is a state
 * the surrounding component has to handle, and a ticking negative number on screen reads as a
 * bug to anyone watching a demo.
 *
 * WEB-NFR-009 — the unit conversions come from `APP_CONFIG.ui`. The zero-pad width below is a
 * property of the `mm:ss` format itself rather than a tunable, so it stays here.
 */
const MS_PER_SECOND = APP_CONFIG.ui.msPerSecond;
const SECONDS_PER_MINUTE = APP_CONFIG.ui.secondsPerMinute;
const PAD_WIDTH = 2;
const PAD_CHAR = '0';

@Pipe({ name: 'countdown' })
export class CountdownPipe implements PipeTransform {
  transform(remainingMs: number | null | undefined): string {
    const ms = Number.isFinite(remainingMs) ? Math.max(0, remainingMs ?? 0) : 0;
    const totalSeconds = Math.floor(ms / MS_PER_SECOND);
    const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
    const seconds = totalSeconds % SECONDS_PER_MINUTE;
    return `${String(minutes).padStart(PAD_WIDTH, PAD_CHAR)}:${String(seconds).padStart(PAD_WIDTH, PAD_CHAR)}`;
  }
}
