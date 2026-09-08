import { InjectionToken } from '@angular/core';

/**
 * The two impure things the SSE client touches, behind tokens so the whole reconnect loop —
 * backoff, watchdog, 401 handling, resync-on-reopen — is testable with fake timers and zero
 * network. A loop that can only be exercised against a real server is a loop that is exercised
 * once, by hand, on the morning of the demo.
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const SSE_FETCH = new InjectionToken<FetchLike>('SSE_FETCH', {
  providedIn: 'root',
  factory: (): FetchLike => globalThis.fetch.bind(globalThis),
});

export const SSE_RANDOM = new InjectionToken<() => number>('SSE_RANDOM', {
  providedIn: 'root',
  factory: (): (() => number) => Math.random,
});
