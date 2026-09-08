import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthFacade } from '../../../core/auth/auth-facade';
import { SessionStore } from '../../../core/auth/session-store';
import { APP_CONFIG } from '../../../core/config/app-config';
import { LangToggle } from '../lang-toggle/lang-toggle';
import { SseIndicator } from '../sse-indicator/sse-indicator';

/**
 * The application's one header: product mark, language toggle, live-connection state, who is
 * signed in, and the way out.
 *
 * The mark is hand-authored SVG — a leaf whose midrib is a pulse trace. WEB-NFR-007 permits
 * no icon pack, and in any case the whole product is "is this crop healthy?", which is what
 * the drawing says.
 *
 * WEB-SEC-006 — a phone number is displayed only as its last four digits. The frozen
 * `Principal` schema carries no phone field, so the only phone that can reach the header is a
 * farmer whose display name IS their number; when it matches `auth.phonePattern` it is masked
 * rather than printed. See the amendment note in the progress file.
 *
 * WEB-SEC-004 — sign-out goes through `AuthFacade`, which clears every registered store and
 * closes the stream before it navigates.
 */
@Component({
  selector: 'foshol-app-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, LangToggle, SseIndicator],
  templateUrl: './app-header.html',
  host: { class: 'block' },
})
export class AppHeader {
  private readonly session = inject(SessionStore);
  private readonly auth = inject(AuthFacade);

  /** Slate for the officer and admin console, warm neutrals for the farmer surface. */
  readonly tone = input<'light' | 'dark'>('light');

  protected readonly authenticated = this.session.isAuthenticated;
  protected readonly role = this.session.role;

  protected readonly roleKey = computed(() => {
    const role = this.role();
    return role === null ? '' : `shared.header.role.${role}`;
  });

  /** WEB-SEC-006 — masked when it is a phone, printed when it is a name. Never both. */
  protected readonly identity = computed(() => {
    const name = this.session.displayName();
    return APP_CONFIG.auth.phonePattern.test(name) ? SessionStore.maskPhone(name) : name;
  });

  protected readonly barClass = computed(() =>
    this.tone() === 'dark'
      ? 'bg-slate-800 text-ink-invert'
      : 'bg-surface-0 text-ink border-b border-surface-2',
  );

  protected readonly mutedClass = computed(() =>
    this.tone() === 'dark' ? 'text-surface-2' : 'text-ink-muted',
  );

  protected readonly signOutClass = computed(() =>
    this.tone() === 'dark'
      ? 'border-slate-600 text-ink-invert hover:bg-slate-700'
      : 'border-surface-3 text-ink hover:bg-surface-1',
  );

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
  }
}
