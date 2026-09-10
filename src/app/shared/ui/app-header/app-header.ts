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
 * Who sees the notification bell. Decided by the JWT role and never by the URL (WEB-FR-001) —
 * an ADMIN session standing on `/officer/**`, which the guard allows, still gets no bell.
 *
 * Admins are not a notification audience in this product: the console's bell speaks about a
 * farmer's cases and an officer's queue, and neither is an admin's work. They keep the SSE
 * indicator beside it, because connection health IS everyone's business.
 */
const BELL_ROLES: readonly string[] = ['FARMER', 'OFFICER'];

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
 *
 * The bar is pinned to the top of the viewport on every route and for every persona, so the
 * account menu, the language toggle and the live-connection state are never a scroll away —
 * a farmer half way down an advisory can still see whether the stream is alive, and an officer
 * deep in a queue can still switch language without scrolling back.
 *
 * The pin lives on the HOST rather than on the inner `<header>` on purpose. `sticky` is
 * resolved against the nearest scrolling ancestor but constrained by its own containing block:
 * a `<header>` inside a host box exactly its own height has nowhere to travel, so it never
 * moves. The host is a child of the shell's full-page column, which is the box the bar must be
 * free to slide down. Keeping it here also keeps it tone-agnostic — nothing about being pinned
 * belongs in the light/dark class computation below.
 */
@Component({
  selector: 'foshol-app-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, LangToggle, SseIndicator, NotificationBell, AccountMenu, Icon, RouterLink],
  templateUrl: './app-header.html',
  styleUrl: './app-header.css',
  // z-30 sits under the mobile nav drawer (z-45) and the skip link (z-50), both of which must
  // be able to cover the bar, and over ordinary page content, which must not.
  host: { class: 'sticky top-0 z-30 block' },
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

  protected readonly showBell = computed(() => {
    const role = this.role();
    return this.authenticated() && role !== null && BELL_ROLES.includes(role);
  });

  /** Item 3 — the brand mark is a link home, home being whichever surface this role owns. */
  protected readonly homePath = computed(() => homePathForRole(this.role()));

  /**
   * The Tailwind background is the opaque floor; `hd-bar*` in app-header.css only lightens it
   * where `backdrop-filter` exists to blur what shows through. Order matters — a browser
   * without the filter keeps the solid colour rather than an unreadable wash.
   */
  protected readonly barClass = computed(() =>
    this.tone() === 'dark'
      ? 'hd-bar hd-bar-dark bg-slate-800 text-ink-invert'
      : 'hd-bar hd-bar-light bg-surface-0 text-ink border-b border-surface-2',
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
