import { computed, Injectable, signal } from '@angular/core';

/**
 * WEB-DATA-002 — every signal here is exposed `readonly`; the only way to change any of them
 * is a method on this class. WEB-FR-357 reads `connectionState` to render the discreet
 * reconnecting indicator without any surface having to know how the transport works.
 */
export type SseConnectionState = 'CONNECTING' | 'OPEN' | 'RETRYING' | 'CLOSED';

export const SSE_CONNECTING: SseConnectionState = 'CONNECTING';
export const SSE_OPEN: SseConnectionState = 'OPEN';
export const SSE_RETRYING: SseConnectionState = 'RETRYING';
export const SSE_CLOSED: SseConnectionState = 'CLOSED';

@Injectable({ providedIn: 'root' })
export class SseStore {
  private readonly _connectionState = signal<SseConnectionState>(SSE_CLOSED);
  private readonly _retryAttempt = signal(0);
  private readonly _nextRetryDelayMs = signal<number | null>(null);
  private readonly _lastEventId = signal<string | null>(null);
  /** Epoch millis of the last byte seen — an event OR a heartbeat comment. */
  private readonly _lastEventAt = signal<number | null>(null);
  private readonly _unknownEventCount = signal(0);
  /**
   * WEB-FR-358 — bumped whenever the client believes it may have missed events. A visible
   * view watches this counter and refetches; the counter carries no payload because "what to
   * refetch" is the view's business, not the transport's.
   */
  private readonly _resyncTick = signal(0);

  readonly connectionState = this._connectionState.asReadonly();
  readonly retryAttempt = this._retryAttempt.asReadonly();
  readonly nextRetryDelayMs = this._nextRetryDelayMs.asReadonly();
  readonly lastEventId = this._lastEventId.asReadonly();
  readonly lastEventAt = this._lastEventAt.asReadonly();
  readonly unknownEventCount = this._unknownEventCount.asReadonly();
  readonly resyncTick = this._resyncTick.asReadonly();

  readonly isOpen = computed(() => this._connectionState() === SSE_OPEN);
  /** WEB-FR-357 — "not open" covers connecting, retrying and closed alike. */
  readonly isDegraded = computed(() => this._connectionState() !== SSE_OPEN);

  markConnecting(): void {
    this._connectionState.set(SSE_CONNECTING);
  }

  markOpen(at: number = Date.now()): void {
    this._connectionState.set(SSE_OPEN);
    this._retryAttempt.set(0);
    this._nextRetryDelayMs.set(null);
    this._lastEventAt.set(at);
  }

  markRetrying(attempt: number, delayMs: number): void {
    this._connectionState.set(SSE_RETRYING);
    this._retryAttempt.set(attempt);
    this._nextRetryDelayMs.set(delayMs);
  }

  markClosed(): void {
    this._connectionState.set(SSE_CLOSED);
    this._nextRetryDelayMs.set(null);
  }

  /** Any byte at all, including a heartbeat comment: the watchdog's evidence of life. */
  noteBytes(at: number = Date.now()): void {
    this._lastEventAt.set(at);
  }

  noteEventId(id: string): void {
    this._lastEventId.set(id);
  }

  /** WEB-FR-352 — counted so an unrecognised type is visible in diagnostics, never fatal. */
  noteUnknownEvent(): void {
    this._unknownEventCount.update((n) => n + 1);
  }

  requestResync(): void {
    this._resyncTick.update((n) => n + 1);
  }

  /** WEB-SEC-004 — sign-out drops the resume position along with everything else. */
  clearSession(): void {
    this.markClosed();
    this._retryAttempt.set(0);
    this._lastEventId.set(null);
    this._lastEventAt.set(null);
    this._unknownEventCount.set(0);
  }
}
