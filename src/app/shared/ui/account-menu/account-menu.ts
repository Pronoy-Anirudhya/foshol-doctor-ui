import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthFacade } from '../../../core/auth/auth-facade';
import { SessionStore } from '../../../core/auth/session-store';
import { APP_CONFIG } from '../../../core/config/app-config';
import { LanguageStore } from '../../../core/i18n/language-store';
import { Icon } from '../icon/icon';

/**
 * The one place identity, location and sign-out live in the header.
 *
 * Before this component, "who is signed in" was three separate things in the bar at once — a
 * name, a district chip, a sign-out button — and several feature pages ALSO printed the district
 * again in their own heading, so the same fact appeared on screen twice at once. Industry
 * convention for this is a single account control in the top-right corner: a compact trigger
 * (an avatar, optionally a name) that opens one panel holding everything verbose — full name,
 * role, location, sign out. This is that control, and it is now the ONLY place location renders;
 * no page prints its own district chip any more.
 *
 * `WEB-SEC-004` — sign-out goes through `AuthFacade`, exactly as the header's old button did.
 *
 * The open/close mechanics (`aria-expanded`, `aria-controls`, escape-closes, outside-click
 * closes) mirror `NotificationBell` — the one dropdown pattern this codebase already has,
 * repeated here rather than reinvented.
 */
const PANEL_ID = 'foshol-account-menu-panel';

@Component({
  selector: 'foshol-account-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, Icon],
  templateUrl: './account-menu.html',
  styleUrl: './account-menu.css',
  host: {
    class: 'relative inline-flex',
    '(document:keydown.escape)': 'close()',
    '(document:click)': 'onDocumentClick($event)',
  },
})
export class AccountMenu {
  private readonly session = inject(SessionStore);
  private readonly auth = inject(AuthFacade);
  private readonly language = inject(LanguageStore);
  private readonly host = inject(ElementRef<HTMLElement>);

  /** Slate for the officer/admin console, warm neutrals for the farmer surface. */
  readonly tone = input<'light' | 'dark'>('light');

  protected readonly panelId = PANEL_ID;

  private readonly _open = signal(false);
  protected readonly open = this._open.asReadonly();

  protected readonly role = this.session.role;
  protected readonly region = this.session.region;

  protected readonly roleKey = computed(() => {
    const role = this.role();
    return role === null ? '' : `shared.header.role.${role}`;
  });

  /** WEB-SEC-006 — masked when it is a phone, printed when it is a name. Never both. */
  protected readonly identity = computed(() => {
    const name = this.session.displayName();
    return APP_CONFIG.auth.phonePattern.test(name) ? SessionStore.maskPhone(name) : name;
  });

  /** The trigger's avatar glyph: the identity's first character, upper-cased. */
  protected readonly initial = computed(() => {
    const name = this.identity().trim();
    return name === '' ? '' : name[0].toUpperCase();
  });

  protected readonly districtLabel = computed(() => {
    const region = this.region();
    return region === null ? '' : this.#label(region.districtNameBn, region.districtNameEn, region.districtCode);
  });

  /** Empty when the division would only repeat the district (Dhaka, Chattogram). */
  protected readonly divisionLabel = computed(() => {
    const region = this.region();
    if (region === null) return '';
    const division = this.#label(region.divisionNameBn, region.divisionNameEn, region.divisionCode);
    return division === this.districtLabel() ? '' : division;
  });

  protected readonly triggerClass = computed(() =>
    this.tone() === 'dark'
      ? 'border-slate-600 bg-slate-900/70 text-ink-invert hover:bg-slate-700'
      : 'border-surface-3 bg-surface-0 text-ink hover:bg-surface-1',
  );

  protected readonly mutedClass = computed(() =>
    this.tone() === 'dark' ? 'text-slate-300' : 'text-ink-muted',
  );

  protected toggle(): void {
    this._open.set(!this._open());
  }

  protected close(): void {
    this._open.set(false);
  }

  protected onDocumentClick(event: Event): void {
    if (!this._open()) return;
    const target = event.target;
    if (target instanceof Node && (this.host.nativeElement as HTMLElement).contains(target)) return;
    this._open.set(false);
  }

  protected async signOut(): Promise<void> {
    this.close();
    await this.auth.signOut();
  }

  /** The active language first, then the other, then the code — never an invented name. */
  #label(bn: string | null, en: string | null, code: string | null): string {
    const preferred = this.language.isBangla() ? bn : en;
    return preferred ?? bn ?? en ?? code ?? '';
  }
}
