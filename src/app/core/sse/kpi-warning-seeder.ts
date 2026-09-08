import { effect, inject, Injectable, signal } from '@angular/core';
import { ReviewService } from '../../generated/services/review.service';
import { SessionStore } from '../auth/session-store';
import { LiveAnnouncer } from '../stores/live-announcer';
import { NotificationStore, NOTIFY_KPI_WARNING } from '../stores/notification-store';
import { SseStore } from './sse-store';

/** See `SseDispatcher` — the same key, because it is the same warning by another route. */
const KEY_KPI_RESOLUTION_WARN = 'shared.notifications.kpi.resolutionWarning';
const KEY_KPI_RESTORED = 'shared.notifications.kpi.restored';

/** Farmers have no tasks and no KPI; the endpoint is officer-addressed (`/review/kpi-warnings`). */
const SEEDING_ROLES: readonly string[] = ['OFFICER', 'ADMIN'];

/**
 * WEB-FR-358 — the recovery half of the officer's resolution-KPI warnings.
 *
 * A `kpi` frame delivered while the tab was closed is gone: officer events are not persisted
 * server-side, because the notification table is farmer-addressed (`farmer_id NOT NULL`). There
 * is no inbox that fills in later. `GET /review/kpi-warnings` is the ONLY way back to a warning
 * that was missed, so it is read exactly twice per session-shaped moment: once when an officer
 * signs in, and once each time the stream tells us it lost its place.
 *
 * That "twice" is the whole design. WEB-FR-356 forbids polling an endpoint on a timer, and the
 * architecture lint fails the build on `setInterval` on sight — so the trigger is a signal, not
 * a clock. `SseStore.resyncTick` is bumped by `SseDispatcher.requestResync()`, which is what
 * both a server `resync` frame and `SseClient`'s synthetic reconnect resync go through; reading
 * it in an effect makes this the same recovery pattern the queue uses when it refetches its
 * page. Seeding lives HERE rather than in the dispatcher because the dispatcher is a pure
 * fan-out that issues no requests, and that rule is worth more than the one hop it saves.
 *
 * A failed fetch is swallowed. The endpoint is a convenience over the live stream, never a
 * dependency of it: the bell must keep working from frames, and a 500 here must not break a
 * sign-in or blank the chrome. `lastSeedFailed` records it for diagnostics and nothing renders
 * an error, because there is nothing an officer could usefully do about it.
 */
@Injectable({ providedIn: 'root' })
export class KpiWarningSeeder {
  private readonly review = inject(ReviewService);
  private readonly session = inject(SessionStore);
  private readonly sse = inject(SseStore);
  private readonly notifications = inject(NotificationStore);
  private readonly announcer = inject(LiveAnnouncer);

  private readonly _lastSeedFailed = signal(false);
  readonly lastSeedFailed = this._lastSeedFailed.asReadonly();

  private readonly _seedCount = signal(0);
  /** How many times the endpoint has been read this session. A test's proof of "once". */
  readonly seedCount = this._seedCount.asReadonly();

  /** The `(role, tick)` pair a fetch has already been started for; `null` when signed out. */
  #seededFor: string | null = null;

  constructor() {
    effect(() => {
      const authenticated = this.session.isAuthenticated();
      const role = this.session.role();
      // Read unconditionally so the effect re-runs on every resync, not only the first.
      const tick = this.sse.resyncTick();

      if (!authenticated || role === null || !SEEDING_ROLES.includes(role)) {
        this.#seededFor = null;
        return;
      }

      const moment = `${role} ${tick}`;
      if (this.#seededFor === moment) return;
      this.#seededFor = moment;
      void this.#seed();
    });
  }

  async #seed(): Promise<void> {
    try {
      const warnings = await this.review.listKpiWarnings();
      let restored = 0;
      for (const warning of warnings) {
        // `record` returns null for one the live stream already delivered — a resync must not
        // double every warning, and these carry no server notification id to dedupe on.
        const id = this.notifications.record({
          kind: NOTIFY_KPI_WARNING,
          titleKey: KEY_KPI_RESOLUTION_WARN,
          caseId: warning.caseId,
          reviewTaskId: warning.reviewTaskId,
          dueAt: warning.dueAt,
        });
        if (id !== null) restored += 1;
      }
      this._lastSeedFailed.set(false);
      this._seedCount.update((n) => n + 1);
      if (restored > 0) this.announcer.announce(KEY_KPI_RESTORED, { count: restored });
    } catch {
      // Degrade in silence — see the class comment. The stream is the primary channel.
      this._lastSeedFailed.set(true);
      this._seedCount.update((n) => n + 1);
    }
  }
}
