import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { SessionStore } from '../../../core/auth/session-store';
import { AppHeader } from '../app-header/app-header';
import { LiveRegion } from '../live-region/live-region';
import { OfflineBanner } from '../offline-banner/offline-banner';
import { ToastHost } from '../toast-host/toast-host';

/**
 * The routed layout: skip link, header, offline banner, the outlet, the toast stack and the
 * one live region.
 *
 * WEB-FR-001 — the surface adapts to the signed-in ROLE, read from `SessionStore` (whose role
 * comes from the JWT claim), never from the URL. Reading `/officer/...` out of the address bar
 * would put the console chrome on screen for anyone who typed it, which is exactly the
 * inference WEB-SEC-002 and the handover both forbid.
 *
 * Two surfaces, deliberately different:
 *  - **Farmer** — warm and roomy, one readable column. It is used one-handed, outdoors, by
 *    someone who is not a computer user.
 *  - **Officer / admin** — the slate console chrome and a wide measure. It is a work queue
 *    used at a desk, and it should not look like the farmer's app.
 *
 * WEB-UX-031 — no horizontal page scroll at 360 px: the shell is a single column with padding
 * and no fixed width. Anything genuinely wide (the queue table) scrolls inside its own
 * container, which is the feature's job.
 *
 * WEB-UX-040 — the skip link is the first tab stop on every route, and `<main>` takes focus
 * when it is used.
 */
const CONSOLE_ROLES: readonly string[] = ['OFFICER', 'ADMIN'];

@Component({
  selector: 'foshol-app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, TranslatePipe, AppHeader, OfflineBanner, ToastHost, LiveRegion],
  templateUrl: './app-shell.html',
  host: { class: 'flex min-h-dvh flex-col bg-surface-1' },
})
export class AppShell {
  private readonly session = inject(SessionStore);

  protected readonly isConsole = computed(() => {
    const role = this.session.role();
    return role !== null && CONSOLE_ROLES.includes(role);
  });

  protected readonly headerTone = computed<'light' | 'dark'>(() =>
    this.isConsole() ? 'dark' : 'light',
  );

  /** The farmer's measure is a reading measure; the console's is a working one. */
  protected readonly mainClass = computed(() =>
    this.isConsole()
      ? 'mx-auto w-full max-w-[110rem] px-4 py-5 md:px-6 md:py-7'
      : 'mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-10 xl:max-w-5xl',
  );
}
