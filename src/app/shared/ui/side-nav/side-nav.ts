import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type { Role } from '../../../core/auth/jwt';
import { SessionStore } from '../../../core/auth/session-store';
import { Icon, type IconName } from '../icon/icon';

/**
 * The collapsible left navigation — one persistent way to move between a persona's own pages,
 * so getting from "my queue" to "my dashboard" no longer means knowing a link exists somewhere
 * inside another page's body.
 *
 * Route paths are re-declared here rather than imported from `features/*` — the same choice
 * `notification-bell.ts` already makes and for the same reason: `shared/` stays free of any
 * dependency on a feature's internal structure, so a feature can rename its own routes without
 * touching this file. Keep these paths in step with `farmer.routes.ts` / `officer.routes.ts` /
 * `admin.routes.ts` and their `*_PATHS` constants by hand.
 *
 * Two independent kinds of "collapsed", on purpose:
 *  - **Icon-rail** (`collapsed`, desktop only, this component's own signal) — a width choice,
 *    never persisted (`WEB-DATA-020` names the only two localStorage keys this application owns,
 *    and this is not one of them), so it resets to expanded every fresh session.
 *  - **Mobile overlay** (`open` input / `closed` output) — the shell owns this one, because the
 *    button that opens it lives in the header, not in this component.
 */
interface NavItem {
  readonly key: string;
  readonly path: string;
  readonly icon: IconName;
}

const FARMER_ITEMS: readonly NavItem[] = [
  { key: 'cases', path: '/farmer/cases', icon: 'list' },
  { key: 'newCase', path: '/farmer/new', icon: 'camera' },
];

const OFFICER_ITEMS: readonly NavItem[] = [{ key: 'queue', path: '/officer/queue', icon: 'inbox' }];

const ADMIN_ITEMS: readonly NavItem[] = [
  { key: 'dashboard', path: '/admin/stats', icon: 'home' },
  { key: 'cases', path: '/admin/cases', icon: 'list' },
  { key: 'kpis', path: '/admin/kpis', icon: 'warning' },
];

const ITEMS_BY_ROLE: Readonly<Record<Role, readonly NavItem[]>> = {
  FARMER: FARMER_ITEMS,
  OFFICER: OFFICER_ITEMS,
  ADMIN: ADMIN_ITEMS,
};

@Component({
  selector: 'foshol-side-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, RouterLink, RouterLinkActive, Icon, NgTemplateOutlet],
  templateUrl: './side-nav.html',
  styleUrl: './side-nav.css',
  host: { class: 'contents' },
})
export class SideNav {
  private readonly session = inject(SessionStore);

  /** Slate for the officer/admin console, warm neutrals for the farmer surface. */
  readonly tone = input<'light' | 'dark'>('light');
  /** The mobile overlay's visibility — owned by the shell, toggled from the header. */
  readonly open = input(false);
  readonly closed = output<void>();

  private readonly _collapsed = signal(false);
  protected readonly collapsed = this._collapsed.asReadonly();

  protected readonly role = this.session.role;

  protected readonly items = computed<readonly NavItem[]>(() => {
    const role = this.role();
    return role === null ? [] : ITEMS_BY_ROLE[role];
  });

  protected readonly toneClass = computed(() =>
    this.tone() === 'dark'
      ? 'border-slate-700 bg-slate-900 text-on-console'
      : 'border-surface-3 bg-surface-0 text-ink',
  );

  /** The collapsed width lives here, never beside `md:w-60` in the template, so the two can
      never both land in the class list at once and leave the cascade to pick a winner. */
  /*
   * `4rem` is the header's height, and the column pins directly below it now that the header
   * itself is pinned (app-header.ts). It is not a tunable and so not an APP_CONFIG constant
   * (WEB-NFR-009 exempts CSS values): the bar is one flex row whose tallest child is a
   * `touch-target` control — 44 px, the WEB-UX-041 floor — inside `py-2.5`, so 2.75 rem +
   * 1.25 rem = 4 rem exactly, at every breakpoint. Change either of those in app-header.html
   * and change this with them.
   * The light tone's 1 px bottom border falls inside the column's own `md:p-3`, so the two
   * tones do not need two offsets.
   */
  protected readonly desktopClass = computed(
    () =>
      `sn-nav hidden md:sticky md:top-[4rem] md:flex md:h-[calc(100dvh-4rem)] md:flex-col md:gap-0.5 md:border-e md:p-3 ${
        this.collapsed() ? 'md:w-[4.5rem]' : 'md:w-60'
      } ${this.toneClass()}`,
  );

  protected readonly mobileClass = computed(
    () => `sn-nav fixed inset-y-0 start-0 z-[45] flex w-64 flex-col gap-0.5 border-e p-3 md:hidden ${this.toneClass()}`,
  );

  protected labelKey(item: NavItem): string {
    const role = this.role();
    return role === null ? '' : `shared.nav.${role}.${item.key}`;
  }

  protected toggleCollapsed(): void {
    this._collapsed.set(!this._collapsed());
  }

  /** A link was followed: on the mobile overlay, that is also a request to close it. */
  protected onNavigate(): void {
    this.closed.emit();
  }
}
