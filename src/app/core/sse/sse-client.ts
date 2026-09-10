import { DestroyRef, effect, inject, Injectable } from '@angular/core';
import { SessionStore } from '../auth/session-store';
import { APP_CONFIG } from '../config/app-config';
import { apiBaseUrl } from '../config/runtime-config';
import { nextDelayMs, type SseBackoffConfig } from './sse-backoff';
import { SseDispatcher } from './sse-dispatcher';
import { SseFrameDecoder, type SseFrame } from './sse-parser';
import { SseStore } from './sse-store';
import { SSE_FETCH, SSE_RANDOM } from './sse-tokens';

const HEADER_AUTHORIZATION = 'Authorization';
const HEADER_ACCEPT = 'Accept';
const HEADER_LAST_EVENT_ID = 'Last-Event-ID';
const BEARER_PREFIX = 'Bearer ';
const EVENT_STREAM = 'text/event-stream';
const HTTP_UNAUTHORIZED = 401;
const EVENT_ONLINE = 'online';
const EVENT_VISIBILITY = 'visibilitychange';
const VISIBLE = 'visible';

/**
 * The one SSE connection this application ever has (`WEB-FR-351`).
 *
 * `WEB-FR-350` — it is read with `fetch`, never `EventSource`. `EventSource` cannot set a
 * request header, so using it would force the JWT into the query string, where it would land in
 * server logs, browser history and any proxy in between — a direct breach of `WEB-SEC-002`.
 * The cost of that decision is that reconnection, `Last-Event-ID` and the heartbeat watchdog
 * are all hand-written, which is what most of this file is.
 *
 * The loop is driven by an `effect` on `SessionStore.isAuthenticated()`: sign in opens it, sign
 * out and a `401` close it. No surface opens or closes the stream itself.
 */
@Injectable({ providedIn: 'root' })
export class SseClient {
  private readonly session = inject(SessionStore);
  private readonly store = inject(SseStore);
  private readonly dispatcher = inject(SseDispatcher);
  private readonly fetchFn = inject(SSE_FETCH);
  private readonly random = inject(SSE_RANDOM);

  #running = false;
  /** Bumped on every connect and on every stop, so a late callback from a dead attempt exits. */
  #generation = 0;
  #attempt = 0;
  #abort: AbortController | null = null;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #watchdog: ReturnType<typeof setTimeout> | null = null;
  #lastEventId: string | null = null;
  /** A `retry:` frame lets the server propose its own base delay; default until it does. */
  #baseRetryMs: number = APP_CONFIG.sse.initialRetryMs;
  /** WEB-FR-358 — a second and subsequent open follows a gap, so the visible view must refetch. */
  #everOpened = false;

  constructor() {
    const onOnline = (): void => this.retryNow();
    const onVisibility = (): void => {
      if (globalThis.document?.visibilityState === VISIBLE) this.retryNow();
    };
    globalThis.addEventListener?.(EVENT_ONLINE, onOnline);
    globalThis.document?.addEventListener?.(EVENT_VISIBILITY, onVisibility);

    inject(DestroyRef).onDestroy(() => {
      globalThis.removeEventListener?.(EVENT_ONLINE, onOnline);
      globalThis.document?.removeEventListener?.(EVENT_VISIBILITY, onVisibility);
      this.stop();
    });

    effect(() => {
      if (this.session.isAuthenticated()) this.start();
      else this.stop();
    });
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#attempt = 0;
    this.#baseRetryMs = APP_CONFIG.sse.initialRetryMs;
    void this.#connect();
  }

  /** WEB-SEC-004 — closes the reader, the abort controller and every timer, in that order. */
  stop(): void {
    this.#running = false;
    this.#generation += 1;
    this.#clearRetryTimer();
    this.#clearWatchdog();
    this.#abort?.abort();
    this.#abort = null;
    this.#lastEventId = null;
    this.#everOpened = false;
    this.store.clearSession();
  }

  /**
   * The network came back, or the tab did. Collapse a pending backoff rather than making the
   * user watch out a 30-second delay that the browser has just told us is obsolete. It only
   * acts on a *scheduled* retry: an attempt already in flight is left alone.
   */
  retryNow(): void {
    if (!this.#running || this.#retryTimer === null) return;
    this.#clearRetryTimer();
    void this.#connect();
  }

  async #connect(): Promise<void> {
    if (!this.#running) return;
    const token = this.session.bearerToken();
    if (token === null) {
      this.stop();
      return;
    }

    this.#generation += 1;
    const generation = this.#generation;
    const controller = new AbortController();
    this.#abort = controller;
    this.store.markConnecting();

    try {
      const headers: Record<string, string> = {
        [HEADER_AUTHORIZATION]: BEARER_PREFIX + token,
        [HEADER_ACCEPT]: EVENT_STREAM,
      };
      // Only sent once the server has given us an id to resume from (handover §10).
      if (this.#lastEventId !== null) headers[HEADER_LAST_EVENT_ID] = this.#lastEventId;

      const response = await this.fetchFn(apiBaseUrl() + APP_CONFIG.api.streamPath, {
        headers,
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
      });
      if (generation !== this.#generation) return;

      if (response.status === HTTP_UNAUTHORIZED) {
        // Do NOT reconnect: the token is dead and retrying would be a login-less hot loop.
        this.session.clear();
        this.stop();
        return;
      }
      if (!response.ok || response.body === null) {
        throw new Error(`sse-status-${response.status}`);
      }

      this.store.markOpen();
      // WEB-FR-355 — the delay resets after a connection actually succeeds, not after one is
      // merely attempted.
      this.#attempt = 0;
      if (this.#everOpened) this.dispatcher.requestResync();
      this.#everOpened = true;

      await this.#read(response.body, generation);
    } catch {
      // An abort, a network failure or a non-200: all of them mean the same thing here, which
      // is that the stream is gone and the backoff schedule decides what happens next.
    } finally {
      this.#clearWatchdog();
    }

    if (generation !== this.#generation || !this.#running) return;
    this.#scheduleReconnect();
  }

  async #read(body: ReadableStream<Uint8Array>, generation: number): Promise<void> {
    const reader = body.getReader();
    const decoder = new SseFrameDecoder(this.#lastEventId);
    this.#armWatchdog();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (generation !== this.#generation) return;
        if (done) return;
        if (value === undefined) continue;
        // Any byte at all rearms the watchdog, heartbeat comments very much included.
        this.#armWatchdog();
        for (const frame of decoder.push(value)) this.#onFrame(frame);
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* Already released by an abort; nothing to undo. */
      }
    }
  }

  #onFrame(frame: SseFrame): void {
    switch (frame.kind) {
      case 'comment':
        // The 20-second heartbeat. It carries no data and its only job is to be evidence.
        this.store.noteBytes();
        return;
      case 'retry':
        this.#baseRetryMs = frame.delayMs;
        return;
      case 'event':
        this.store.noteBytes();
        if (frame.id !== null) {
          this.#lastEventId = frame.id;
          this.store.noteEventId(frame.id);
        }
        this.dispatcher.dispatch(frame.event, frame.data);
        return;
    }
  }

  /**
   * A watchdog on an OPEN stream, not a poll of an endpoint — so it does not violate
   * WEB-FR-356, which forbids polling. A TCP connection dropped behind a proxy or a sleeping
   * phone's radio never errors and never ends; the reader simply waits forever. The server's
   * heartbeat comment every `foshol.channels.sse.heartbeat` is what makes that state
   * detectable, and this is what acts on it.
   *
   * It rearms a `setTimeout` on every byte rather than running a `setInterval`, both because
   * that is the correct shape for "time since last byte" and because the architecture lint
   * flags `setInterval` on sight.
   */
  #armWatchdog(): void {
    this.#clearWatchdog();
    this.#watchdog = setTimeout(() => {
      this.#watchdog = null;
      this.#abort?.abort();
    }, APP_CONFIG.sse.staleAfterMs);
  }

  #scheduleReconnect(): void {
    const attempt = this.#attempt;
    const cfg: SseBackoffConfig = {
      initialRetryMs: this.#baseRetryMs,
      maxRetryMs: APP_CONFIG.sse.maxRetryMs,
      backoffMultiplier: APP_CONFIG.sse.backoffMultiplier,
      jitterRatio: APP_CONFIG.sse.jitterRatio,
    };
    const delay = nextDelayMs(attempt, cfg, this.random);
    this.#attempt = attempt + 1;
    this.store.markRetrying(attempt + 1, delay);
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      void this.#connect();
    }, delay);
  }

  #clearRetryTimer(): void {
    if (this.#retryTimer === null) return;
    clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
  }

  #clearWatchdog(): void {
    if (this.#watchdog === null) return;
    clearTimeout(this.#watchdog);
    this.#watchdog = null;
  }
}
