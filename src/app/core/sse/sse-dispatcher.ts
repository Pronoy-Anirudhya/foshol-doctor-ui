import { inject, Injectable } from '@angular/core';
import type { CaseStatus } from '../../generated/models/case-status';
import { SessionStore } from '../auth/session-store';
import { CaseStatusStore } from '../stores/case-status-store';
import { LiveAnnouncer } from '../stores/live-announcer';
import {
  NotificationStore,
  NOTIFY_ADVISORY,
  NOTIFY_KPI_WARNING,
  NOTIFY_QUEUE_ARRIVAL,
  NOTIFY_REJECTION,
  NOTIFY_REVISION,
  NOTIFY_STATUS,
  type NotificationKind,
} from '../stores/notification-store';
import { QueueStore } from '../stores/queue-store';
import {
  ToastStore,
  TOAST_ERROR,
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
  toKpiEvent,
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
 * The KPI warning's words are ours alone: the frame carries no prose, and nothing about a
 * deadline is agronomic content. It sits in the `shared.notifications.*` namespace rather than
 * `live.*` only because `src/i18n/live.i18n.json` is another agent's fragment.
 */
const KEY_KPI_RESOLUTION_WARN = 'shared.notifications.kpi.resolutionWarning';
/**
 * New work on the console's queue. In `shared.notifications.*` for the same reason the KPI
 * warning is: `live.i18n.json` is another agent's fragment, and the merge gate requires the
 * kind label (`shared.notifications.kind.QUEUE_ARRIVAL`) to sit under `shared.` regardless — so
 * both halves of one bell row stay under one owner.
 */
const KEY_QUEUE_ANALYSED = 'shared.notifications.queue.analysed';
const KEY_QUEUE_ANALYSED_BODY = 'shared.notifications.queue.analysedBody';

/** Farmers receive `advisory` / `case-status`; officers receive `queue` / `kpi`. */
const ROLE_FARMER = 'FARMER';
const ROLE_OFFICER = 'OFFICER';

/**
 * The one queue transition worth interrupting an officer for: analysis finished, so a review row
 * now exists to claim. `SUBMITTED` and `ANALYSING` have no review row yet, `IN_REVIEW` is usually
 * this officer's own claim coming back to them, and `ADVISED` / `REJECTED` / `FAILED` are work
 * LEAVING the queue — none of those is news. Those still patch the queue and announce, exactly as
 * before; they simply raise no toast and record no bell row.
 */
const STATUS_ANALYSED: CaseStatus = 'ANALYSED';

/**
 * Which case transitions are worth a toast on the FARMER's surface, and in what tone.
 *
 * A partial map rather than an `if`, so "no toast" is the structural default and every exclusion
 * is visible in one place. `SUBMITTED` is the farmer's own button coming back to them. `ADVISED`
 * and `REJECTED` are excluded because `#onAdvisory` ALREADY toasts both beats — the server sends
 * an `advisory` frame and a `case-status` frame for each, so toasting here too would put two
 * toasts on screen for one event.
 */
const CASE_STATUS_TOAST: Readonly<Partial<Record<CaseStatus, ToastKind>>> = {
  ANALYSED: TOAST_INFO,
  IN_REVIEW: TOAST_INFO,
  FAILED: TOAST_ERROR,
};
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
  /** Read only to decide who a frame is FOR. Nothing here authorises anything. */
  private readonly session = inject(SessionStore);

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
      case SSE_EVENT.kpi:
        this.#onKpi(data);
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
    const bodyKey = `${KEY_STATUS_LABEL_PREFIX}${event.toStatus}`;
    this.notifications.record({
      kind: NOTIFY_STATUS,
      titleKey: KEY_STATUS_CHANGED,
      bodyKey,
      caseId: event.caseId,
      notificationId: event.notificationId,
    });
    // The bell records every transition; only the ones a farmer would want interrupting for get
    // a toast. Role-gated belt-and-braces: `case-status` is farmer-addressed, but a console that
    // ever received one must not start toasting case chatter over a review.
    const toastKind = CASE_STATUS_TOAST[event.toStatus];
    if (toastKind !== undefined && this.session.role() === ROLE_FARMER) {
      this.toasts.show({
        kind: toastKind,
        titleKey: KEY_STATUS_CHANGED,
        // The same status label the badges and the bell row use — one catalogue, so the toast
        // and the stepper can never disagree about what `IN_REVIEW` is called.
        bodyKey,
        caseId: event.caseId,
      });
    }
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

  /**
   * A task this officer holds is approaching its resolution KPI.
   *
   * Recorded and announced, and that is all: no toast, because a deadline that is still
   * fifteen minutes away is not worth seizing the screen for mid-review, and no request,
   * because the frame already carries every field the row shows. The row deep-links by
   * `reviewTaskId` — the console is addressed by task, not by case.
   */
  #onKpi(data: string): void {
    // A farmer has no console, no task and no KPI. If one ever reaches this client the frame
    // is dropped in silence — dropped, not counted as unknown, because the name IS known.
    if (this.session.role() === ROLE_FARMER) return;
    const event = toKpiEvent(data);
    if (event === null) return;
    this.notifications.record({
      kind: NOTIFY_KPI_WARNING,
      titleKey: KEY_KPI_RESOLUTION_WARN,
      caseId: event.caseId,
      reviewTaskId: event.reviewTaskId,
      dueAt: event.dueAt,
    });
    this.announcer.announce(KEY_KPI_RESOLUTION_WARN);
  }

  #onQueue(data: string): void {
    const event = toQueueEvent(data);
    if (event === null) return;
    // WEB-FR-200 / WEB-FR-204 — patch in place; a change that would move a row asks the server
    // for the page again. Nothing in this path sorts.
    const patched = this.queue.patchRow(event.caseId, event.toStatus);
    if (!patched) this.queue.markNeedsReload();
    this.announcer.announce(KEY_QUEUE_UPDATED);

    // Everything above is the queue's business and runs for whoever is signed in. Everything
    // below is notification CHROME, and only an officer is its audience: an admin has no bell,
    // and a farmer has no queue.
    if (this.session.role() !== ROLE_OFFICER || event.toStatus !== STATUS_ANALYSED) return;

    // Recorded FIRST, and the toast gated on the result. `record` returns `null` for a replay,
    // `ToastStore` has no dedupe of its own, and a `resync` replays frames — so ordering it the
    // other way round would show one bell row and N toasts for the same arrival.
    const recorded = this.notifications.record({
      kind: NOTIFY_QUEUE_ARRIVAL,
      titleKey: KEY_QUEUE_ANALYSED,
      bodyKey: KEY_QUEUE_ANALYSED_BODY,
      caseId: event.caseId,
    });
    if (recorded === null) return;

    this.toasts.show({
      kind: TOAST_INFO,
      titleKey: KEY_QUEUE_ANALYSED,
      bodyKey: KEY_QUEUE_ANALYSED_BODY,
      caseId: event.caseId,
    });
    // WEB-UX-046 — the application's one live region, through the announcer the queue patch
    // above already used. The more specific message replaces the generic one for this frame.
    this.announcer.announce(KEY_QUEUE_ANALYSED);
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
