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
 * It is a RECORDER, not a fetcher. Every entry is handed to it — by `SseDispatcher` from a frame
 * it has already parsed, or by `KpiWarningSeeder` from the one recovery read — so nothing here
 * issues a request and nothing here polls (WEB-FR-356).
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
export type NotificationKind =
  | 'STATUS'
  | 'ADVISORY'
  | 'REVISION'
  | 'REJECTION'
  | 'KPI_WARNING'
  | 'QUEUE_ARRIVAL';

export const NOTIFY_STATUS: NotificationKind = 'STATUS';
export const NOTIFY_ADVISORY: NotificationKind = 'ADVISORY';
export const NOTIFY_REVISION: NotificationKind = 'REVISION';
export const NOTIFY_REJECTION: NotificationKind = 'REJECTION';
/**
 * The officer's resolution-KPI warning. The only kind addressed by `reviewTaskId` rather than
 * by `caseId`, because the console's workspace route is addressed by task.
 */
export const NOTIFY_KPI_WARNING: NotificationKind = 'KPI_WARNING';
/**
 * New work landed on the officer's review queue. Addressed by `caseId`, because that is all a
 * `queue` frame carries — the review task the console routes by does not exist on this client
 * until the queue page is read again. The bell resolves the task id at render time when it can.
 */
export const NOTIFY_QUEUE_ARRIVAL: NotificationKind = 'QUEUE_ARRIVAL';

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
   * The console's deep-link target. Present only on an officer-addressed entry; the farmer
   * surface has no route a task id can address and never receives one of these frames.
   */
  readonly reviewTaskId?: string;
  /**
   * The frozen server instant this task is due to be resolved by. Displayed, never recomputed
   * (WEB-NFR-001), and — with `reviewTaskId` — the dedupe key for an entry that carries no
   * `notificationId`.
   */
  readonly dueAt?: string;
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
    if (this.#isReplay(input)) return null;

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

  /**
   * Three identities, because the three families of entry have three different ones.
   *
   * A farmer-addressed frame carries the server's `notificationId`, which is authoritative. A
   * KPI warning has no such id at all — officer events are not persisted server-side — so it is
   * identified by WHAT it warns about: this task, due at this instant. That is what stops the
   * seeding fetch after a resync from doubling every warning already delivered live, and it
   * still lets a re-warning at a NEW due instant through as the new thing it is. A queue
   * arrival is the third: `queue` frames carry neither an id nor a task, so it is identified by
   * its case alone — see `identityOf` for why that fallback is scoped to that one kind.
   */
  #isReplay(input: NotificationInput): boolean {
    const serverId = input.notificationId;
    if (serverId !== undefined) {
      return this._items().some((item) => item.notificationId === serverId);
    }
    const key = identityOf(input);
    if (key === null) return false;
    return this._items().some((item) => identityOf(item) === key);
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

/**
 * `null` for any entry this application cannot identify by its content — which is most of them,
 * and deliberately so.
 *
 * The case fallback is scoped to `QUEUE_ARRIVAL` alone, and both branches are namespaced so they
 * can never collide. A GENERAL `kind + caseId` identity would be wrong twice over: a farmer's
 * `case-status` chain (`SUBMITTED → ANALYSING → ANALYSED → IN_REVIEW`) arrives as several `STATUS`
 * entries for one case and would collapse into one row whenever the server omits `notificationId`,
 * and folding `toStatus` in does not rescue it either, because `IN_REVIEW → ADVISED → revised →
 * IN_REVIEW` is a real loop — which is the whole reason `REVISION` exists as its own kind.
 *
 * `QUEUE_ARRIVAL` has no second dimension the way a KPI warning has `dueAt`, so a case driven to
 * `ANALYSED` a second time is swallowed while the first row is still held. That is the accepted
 * cost of not doubling on every `resync` replay: the row ages out past `maxItems`, and `dismiss`
 * clears it, after which a later arrival records as new.
 */
function identityOf(
  input: Pick<AppNotification, 'kind' | 'caseId' | 'reviewTaskId' | 'dueAt'>,
): string | null {
  const { kind, caseId, reviewTaskId, dueAt } = input;
  if (reviewTaskId !== undefined && dueAt !== undefined) return `task ${reviewTaskId} ${dueAt}`;
  if (kind === NOTIFY_QUEUE_ARRIVAL && caseId !== undefined) return `${kind} ${caseId}`;
  return null;
}
