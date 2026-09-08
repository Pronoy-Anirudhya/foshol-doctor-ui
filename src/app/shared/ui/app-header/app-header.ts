import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { homePathForRole } from '../../../core/auth/auth.guard';
import { SessionStore } from '../../../core/auth/session-store';
import { AccountMenu } from '../account-menu/account-menu';
import { Icon } from '../icon/icon';
import { LangToggle } from '../lang-toggle/lang-toggle';
import { NotificationBell } from '../notification-bell/notification-bell';
import { SseIndicator } from '../sse-indicator/sse-indicator';

/**
 * The application's one header: a mobile nav toggle, product mark, language toggle,
 * live-connection state, and the account menu (identity, location, sign-out — all in one place).
 *
 * The mark is hand-authored SVG — a leaf whose midrib is a pulse trace. WEB-NFR-007 permits
 * no icon pack, and in any case the whole product is "is this crop healthy?", which is what
 * the drawing says.
 *
 * Identity, region and sign-out used to be three separate elements in this bar; they are now
 * `AccountMenu`, one trigger with everything verbose behind a click — see that component's own
 * doc comment for the reasoning. `WEB-SEC-004`/`WEB-SEC-006` still apply, just inside it.
 */
@Component({
  selector: 'foshol-app-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, LangToggle, SseIndicator, NotificationBell, AccountMenu, Icon, RouterLink],
  templateUrl: './app-header.html',
  host: { class: 'block' },
})
export class AppHeader {
  private readonly session = inject(SessionStore);

  /** Slate for the officer and admin console, warm neutrals for the farmer surface. */
  readonly tone = input<'light' | 'dark'>('light');
  /** Whether the collapsible left nav is currently open as a mobile overlay. */
  readonly navOpen = input(false);

  /** The mobile hamburger was pressed — the shell owns whether the nav is open. */
  readonly menuToggle = output<void>();

  protected readonly authenticated = this.session.isAuthenticated;
  protected readonly role = this.session.role;

  /** Item 3 — the brand mark is a link home, home being whichever surface this role owns. */
  protected readonly homePath = computed(() => homePathForRole(this.role()));

  protected readonly barClass = computed(() =>
    this.tone() === 'dark'
      ? 'bg-slate-800 text-ink-invert'
      : 'bg-surface-0 text-ink border-b border-surface-2',
  );

  protected readonly mutedClass = computed(() =>
    this.tone() === 'dark' ? 'text-surface-2' : 'text-ink-muted',
  );

  protected readonly menuButtonClass = computed(() =>
    this.tone() === 'dark'
      ? 'bg-slate-900/70 text-surface-2 hover:bg-slate-700'
      : 'bg-surface-2 text-ink-muted hover:text-ink',
  );
}
