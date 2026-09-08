import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';

/**
 * WEB-FR-402 — the offline banner's source of truth.
 *
 * `navigator.onLine` is a weak signal (it reports link state, not reachability), so it is used
 * for exactly what it is good at: telling the farmer their phone has no connection, while the
 * draft stays in memory untouched. It is never used to decide whether a request may be issued
 * — the request's own failure decides that.
 */
@Injectable({ providedIn: 'root' })
export class ConnectivityStore {
  private readonly _online = signal(readNavigatorOnline());
  private readonly _lastChangeAt = signal<number | null>(null);

  readonly online = this._online.asReadonly();
  readonly lastChangeAt = this._lastChangeAt.asReadonly();
  readonly offline = computed(() => !this._online());

  constructor() {
    const goOnline = (): void => this.#set(true);
    const goOffline = (): void => this.#set(false);
    globalThis.addEventListener?.('online', goOnline);
    globalThis.addEventListener?.('offline', goOffline);
    inject(DestroyRef).onDestroy(() => {
      globalThis.removeEventListener?.('online', goOnline);
      globalThis.removeEventListener?.('offline', goOffline);
    });
  }

  /** Exposed for tests and for a surface that has just observed a request succeed or fail. */
  setOnline(online: boolean): void {
    this.#set(online);
  }

  #set(online: boolean): void {
    if (this._online() === online) return;
    this._online.set(online);
    this._lastChangeAt.set(Date.now());
  }
}

function readNavigatorOnline(): boolean {
  const nav: { onLine?: boolean } | undefined = globalThis.navigator;
  // Absent in a non-browser test environment: assume online rather than render a false banner.
  return typeof nav?.onLine === 'boolean' ? nav.onLine : true;
}
