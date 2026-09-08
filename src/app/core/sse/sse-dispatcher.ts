import { inject, Injectable } from '@angular/core';
import { CaseStatusStore } from '../stores/case-status-store';
import { LiveAnnouncer } from '../stores/live-announcer';
import {
  NotificationStore,
  NOTIFY_ADVISORY,
  NOTIFY_REJECTION,
  NOTIFY_REVISION,
  NOTIFY_STATUS,
  type NotificationKind,
} from '../stores/notification-store';
import { QueueStore } from '../stores/queue-store';
import {
  ToastStore,
  TOAST_INFO,
  TOAST_SUCCESS,
  TOAST_WARNING,
  type ToastKind,
} from '../stores/toast-store';
import {
  ADVISORY_PUBLISHED,
  ADVISORY_REVISED,
  CASE_REJECTED,
  SSE_EVENT,
  toAdvisoryEvent,
  toCaseStatusEvent,
  toQueueEvent,
  type AdvisoryEventData,
} from './sse-events';
import { SseStore } from './sse-store';

/** Chrome strings this application authored; server text is never looked up here. */
const KEY_STATUS_CHANGED = 'live.case.statusChanged';
const KEY_ADVISORY_PUBLISHED = 'live.advisory.published';
const KEY_ADVISORY_REVISED = 'live.advisory.revised';
const KEY_CASE_REJECTED = 'live.case.rejected';
const KEY_QUEUE_UPDATED = 'live.queue.updated';
const KEY_RESYNCED = 'live.stream.resynced';
/**
 * A status notification's detail line is the status label the badges already use, looked up by
 * the value the server sent. Reusing that catalogue rather than authoring a second set of status
 * words is what stops the bell and the stepper from ever disagreeing about what `IN_REVIEW`
 * is called.
 */
const KEY_STATUS_LABEL_PREFIX = 'badge.status.';

/**
 * Fan-out from one stream to the stores that care.
 *
 * The `switch` binds to the **wire** event names of `docs/handover/frontend-demo-api.md` §10,
 * not to the enum-style names in the OpenAPI prose. Those are two different vocabularies for
 * the same events, and only one of them appears in the `event:` field.
 *
 * Nothing in this class issues a request. WEB-FR-353 requires the farmer's stepper to advance
 * with no network round trip, and WEB-FR-356 forbids the reflex of "an event arrived, refetch
 * everything" — so a frame either carries enough to update a store, or it marks the affected
 * view as needing a refresh and lets that view decide when to read.
 */
@Injectable({ providedIn: 'root' })
export class SseDispatcher {
  private readonly caseStatus = inject(CaseStatusStore);
  private readonly queue = inject(QueueStore);
  private readonly toasts = inject(ToastStore);
  /**
   * The notification centre is a RECORDER hung off this same choke point, not a replacement for
   * the toast: a toast is the interruption, the bell is the record of it. Appending to an array
   * issues no request, so the "nothing here fetches" rule above still holds.
   */
  private readonly notifications = inject(NotificationStore);
  private readonly announcer = inject(LiveAnnouncer);
  private readonly sse = inject(SseStore);

  dispatch(event: string, data: string): void {
    switch (event) {
      case SSE_EVENT.caseStatus:
        this.#onCaseStatus(data);
        return;
      case SSE_EVENT.advisory:
        this.#onAdvisory(data);
        return;
      case SSE_EVENT.queue:
        this.#onQueue(data);
        return;
      case SSE_EVENT.resync:
        this.requestResync();
        return;
      case SSE_EVENT.reconnect:
        // The server is about to close an idle stream. Nothing to do: the read loop will see
        // the end of the body and the reconnect schedule takes over from there.
        return;
      default:
        // WEB-FR-352 — an unrecognised type is counted and ignored. It is NOT a reason to
        // disconnect: a server that adds an event type must not be able to take the client
        // down, and a client that tears down its stream over an unknown name is a liability.
        this.sse.noteUnknownEvent();
        return;
    }
  }

  /**
   * WEB-FR-358 — the connection reopened after a gap, or the server asked for a resync.
   * `resyncTick` is what visible views watch; the queue additionally lights its stale marker
   * because its ordering may have changed while the stream was down.
   */
  requestResync(): void {
    this.sse.requestResync();
    this.queue.markNeedsReload();
    this.announcer.announce(KEY_RESYNCED);
  }

  #onCaseStatus(data: string): void {
    const event = toCaseStatusEvent(data);
    if (event === null) return;
    // WEB-FR-353 — the whole update, with no request behind it.
    this.caseStatus.applyServerStatus(event.caseId, event.toStatus, event.fromStatus ?? null);
    this.notifications.record({
      kind: NOTIFY_STATUS,
      titleKey: KEY_STATUS_CHANGED,
      bodyKey: `${KEY_STATUS_LABEL_PREFIX}${event.toStatus}`,
      caseId: event.caseId,
      notificationId: event.notificationId,
    });
    this.announcer.announce(KEY_STATUS_CHANGED);
  }

  #onAdvisory(data: string): void {
    const event = toAdvisoryEvent(data);
    if (event === null) return;

    // WEB-FR-354 — toast now, and mark the case so its view re-reads when it next renders.
    this.caseStatus.markNeedsRefresh(event.caseId);

    const { key, kind, notificationKind } = describe(event);
    this.toasts.show({
      kind,
      titleKey: event.titleBn === null || event.titleBn === undefined ? key : undefined,
      // Server-authored Bangla. Rendered verbatim as text: never translated, never HTML
      // (COMMON-CON-003, WEB-SEC-005).
      title: event.titleBn ?? undefined,
      body: event.bodyBn ?? undefined,
      caseId: event.caseId,
    });
    // Same fields, kept rather than expired: a farmer who was looking at the camera when the
    // toast came and went still finds the advisory in the bell.
    this.notifications.record({
      kind: notificationKind,
      titleKey: event.titleBn === null || event.titleBn === undefined ? key : undefined,
      title: event.titleBn ?? undefined,
      body: event.bodyBn ?? undefined,
      caseId: event.caseId,
      notificationId: event.notificationId,
    });
    this.announcer.announce(key);
  }

  #onQueue(data: string): void {
    const event = toQueueEvent(data);
    if (event === null) return;
    // WEB-FR-200 / WEB-FR-204 — patch in place; a change that would move a row asks the server
    // for the page again. Nothing in this path sorts.
    const patched = this.queue.patchRow(event.caseId, event.toStatus);
    if (!patched) this.queue.markNeedsReload();
    this.announcer.announce(KEY_QUEUE_UPDATED);
  }
}

function describe(event: AdvisoryEventData): {
  key: string;
  kind: ToastKind;
  notificationKind: NotificationKind;
} {
  switch (event.type) {
    case ADVISORY_PUBLISHED:
      return {
        key: KEY_ADVISORY_PUBLISHED,
        kind: TOAST_SUCCESS,
        notificationKind: NOTIFY_ADVISORY,
      };
    case ADVISORY_REVISED:
      return { key: KEY_ADVISORY_REVISED, kind: TOAST_INFO, notificationKind: NOTIFY_REVISION };
    case CASE_REJECTED:
      return { key: KEY_CASE_REJECTED, kind: TOAST_WARNING, notificationKind: NOTIFY_REJECTION };
    default:
      return { key: KEY_ADVISORY_PUBLISHED, kind: TOAST_INFO, notificationKind: NOTIFY_ADVISORY };
  }
}
