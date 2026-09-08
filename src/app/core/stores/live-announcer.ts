import { Injectable, signal } from '@angular/core';

/**
 * WEB-UX-046 — one polite ARIA live region for the whole application.
 *
 * The shell renders `message()` inside a single `aria-live="polite"` element. Everything
 * asynchronous — a case transition, an SSE toast, an action result — announces through here,
 * because several live regions competing on one page is how a screen reader ends up reading
 * none of them.
 *
 * The message is a translation KEY, not text: translation belongs in the template so the
 * announcement follows the language toggle without this store knowing a locale exists
 * (WEB-UX-012, WEB-UX-013). `seq` increments on every announcement so that announcing the same
 * key twice still changes the signal and is therefore re-read.
 */
export interface LiveMessage {
  readonly seq: number;
  readonly key: string;
  readonly params?: Readonly<Record<string, string | number>>;
}

@Injectable({ providedIn: 'root' })
export class LiveAnnouncer {
  private readonly _message = signal<LiveMessage | null>(null);
  readonly message = this._message.asReadonly();

  announce(key: string, params?: Readonly<Record<string, string | number>>): void {
    this._message.update((current) => ({ seq: (current?.seq ?? 0) + 1, key, params }));
  }

  clear(): void {
    this._message.set(null);
  }

  clearSession(): void {
    this.clear();
  }
}
