import { computed, Injectable, signal } from '@angular/core';
import { APP_CONFIG } from '../config/app-config';
import { newUuid } from '../util/uuid';

/**
 * WEB-FR-354 / WEB-FR-357 — the in-session notification centre behind the header bell.
 *
 * A toast is a moment: it appears, it announces itself and it is gone in `ui.toastMs`. Anyone
 * who looked away has no way back to it. This store is the other half of the same events —
 * every advisory and every case transition the stream already delivered, kept in arrival order
 * so the bell can show what was missed.
 *
 * It is a RECORDER, not a fetcher. Every entry arrives from a frame `SseDispatcher` has already
 * parsed, so nothing here issues a request and nothing here polls (WEB-FR-356).
 *
 * Deliberately memory-only. `APP_CONFIG.storageKeys` names the only two localStorage keys this
 * application may write (WEB-DATA-020) and a farmer's case notifications are not one of them;
 * `clearSession()` is what a sign-out calls (WEB-SEC-004).
 *
 * The `titleKey` / `title` split is `Toast`'s, for the same reason: chrome this application
 * authored is a catalogue key, and a server-supplied Bangla advisory title is a literal that is
 * rendered verbatim and NEVER looked up or translated (WEB-UX-013, COMMON-CON-003). Both render
 * as text, never as HTML (WEB-SEC-005). `bodyKey` / `body` mirror the pair, because a case
 * transition has no server prose at all — its detail line is the status label from our own
 * catalogue.
 */
export type NotificationKind = 'STATUS' | 'ADVISORY' | 'REVISION' | 'REJECTION';

export const NOTIFY_STATUS: NotificationKind = 'STATUS';
export const NOTIFY_ADVISORY: NotificationKind = 'ADVISORY';
export const NOTIFY_REVISION: NotificationKind = 'REVISION';
export const NOTIFY_REJECTION: NotificationKind = 'REJECTION';

/** Which half of the arrival animation is armed. See `arrivalPhase` below. */
export type ArrivalPhase = 'a' | 'b';

export interface AppNotification {
  readonly id: string;
  readonly kind: NotificationKind;
  /** A key from this application's catalogues. Mutually exclusive with `title` in practice. */
  readonly titleKey?: string;
  /** A string the server supplied; rendered verbatim and never translated. */
  readonly title?: string;
  readonly bodyKey?: string;
  readonly body?: string;
  /** Lets a row offer "open the case" without the view guessing (WEB-FR-354). */
  readonly caseId?: string;
  /**
   * The server's own id for this notification, when the frame carried one. It is the dedupe
   * key: a resync replays frames that were already delivered, and a duplicated row is a lie
   * about how many things happened.
   */
  readonly notificationId?: string;
  readonly receivedAtMs: number;
  readonly read: boolean;
}

export type NotificationInput = Omit<AppNotification, 'id' | 'receivedAtMs' | 'read'>;

@Injectable({ providedIn: 'root' })
export class NotificationStore {
  private readonly _items = signal<readonly AppNotification[]>([]);
  /** Newest first: the bell is read top-down and the newest arrival is the reason it was opened. */
  readonly items = this._items.asReadonly();

  readonly unreadCount = computed(() => this._items().filter((item) => !item.read).length);
  readonly hasUnread = computed(() => this._items().some((item) => !item.read));
  readonly isEmpty = computed(() => this._items().length === 0);

  /**
   * Alternates on every arrival, and means nothing on its own.
   *
   * Bound to an attribute, it makes the CSS rule keyed on the OTHER value newly match, and a
   * rule that newly matches runs its animation exactly once — the pattern `status-stepper.css`
   * uses for the flowing connector. That buys the badge's arrival cue with no timer, no
   * `setTimeout` to cancel and no state anyone has to remember to reset; `prefers-reduced-motion`
   * in `styles.css` disables it globally.
   */
  private readonly _arrivalPhase = signal<ArrivalPhase>('a');
  readonly arrivalPhase = this._arrivalPhase.asReadonly();

  /**
   * Returns the new entry's id, or `null` when the frame was a replay of one already held.
   * `receivedAtMs` is a parameter so a test can pin the clock without faking timers.
   */
  record(input: NotificationInput, receivedAtMs = Date.now()): string | null {
    const serverId = input.notificationId;
    if (serverId !== undefined && this._items().some((item) => item.notificationId === serverId)) {
      return null;
    }

    const entry: AppNotification = { ...input, id: newUuid(), receivedAtMs, read: false };
    this._items.update((current) => {
      const next = [entry, ...current];
      // Newest-first and capped: a demo needs no scrollback, and an array a long-lived stream
      // appends to forever is a leak. `pop()` rather than `slice(0, n)` keeps the bound named.
      while (next.length > APP_CONFIG.notifications.maxItems) next.pop();
      return next;
    });
    this._arrivalPhase.update((phase) => (phase === 'a' ? 'b' : 'a'));
    return entry.id;
  }

  markAllRead(): void {
    this._items.update((current) =>
      current.map((item) => (item.read ? item : { ...item, read: true })),
    );
  }

  dismiss(id: string): void {
    this._items.update((current) => current.filter((item) => item.id !== id));
  }

  /** WEB-SEC-004 — one session's case notifications must not outlive it. */
  clearSession(): void {
    this._items.set([]);
  }
}
