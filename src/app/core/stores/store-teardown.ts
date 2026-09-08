import { inject, Injectable } from '@angular/core';
import { SecureMediaService } from '../media/secure-media.service';
import { CaseDraftStore } from './case-draft-store';
import { CaseReviewStore } from './case-review-store';
import { CaseStatusStore } from './case-status-store';
import { LiveAnnouncer } from './live-announcer';
import { QueueStore } from './queue-store';
import { StatsStore } from './stats-store';
import { ToastStore } from './toast-store';

/**
 * WEB-SEC-004 / WEB-DATA-023 — one call that empties every session-scoped store.
 *
 * The list lives here rather than in the auth layer so that adding a store cannot silently
 * forget to clear it: a new store is registered in one obvious place, next to its siblings, and
 * the dependency arrow points from `stores` to nothing rather than from `auth` to every feature.
 *
 * `SseStore` and the SSE connection are cleared by `SseClient` itself, which stops the moment
 * `SessionStore.isAuthenticated()` goes false, and `LanguageStore` is deliberately absent — the
 * language preference is the one thing that survives a sign-out (`WEB-DATA-023`).
 *
 * Sign-out invokes this through the SESSION_TEARDOWN token registered in `app.config.ts`.
 */
@Injectable({ providedIn: 'root' })
export class StoreTeardown {
  private readonly sessionScoped: readonly { clearSession(): void }[] = [
    inject(CaseStatusStore),
    inject(CaseDraftStore),
    inject(QueueStore),
    inject(CaseReviewStore),
    inject(StatsStore),
    inject(ToastStore),
    inject(LiveAnnouncer),
    // Presigned URLs are time-limited by design (COMMON-SEC-016); leaving a cache of live
    // ones behind after sign-out would defeat the limit on a shared demo laptop.
    inject(SecureMediaService),
  ];

  clearAll(): void {
    for (const store of this.sessionScoped) store.clearSession();
  }
}
