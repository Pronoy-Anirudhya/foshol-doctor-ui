import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { AUTH_SURFACES, homePathForRole } from '../../../core/auth/auth.guard';
import { AuthFacade } from '../../../core/auth/auth-facade';
import { SessionStore } from '../../../core/auth/session-store';

/**
 * WEB-FR-003 — where a role may not go, it gets an explanation rather than a 403.
 *
 * Deliberately calm: nothing has gone wrong, no one has been caught doing anything. The most
 * likely visitor is a farmer who followed an officer link, or an officer who tried the admin
 * stats page. So the page names the role, says plainly that the area belongs to another one,
 * and offers the way back — no red, no alarm, no error code.
 */
@Component({
  selector: 'foshol-not-permitted-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslatePipe],
  template: `
    <main class="flex min-h-dvh items-center justify-center bg-surface-1 px-4 py-10">
      <div class="card w-full max-w-lg p-7 sm:p-9">
        <span class="badge" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" focusable="false">
            <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8" />
            <path d="M9 12h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          </svg>
        </span>

        <h1 class="mt-4 text-2xl font-bold sm:text-3xl">
          {{ 'auth.notPermitted.title' | translate }}
        </h1>
        <p class="mt-3 text-ink-muted">{{ 'auth.notPermitted.body' | translate }}</p>

        @if (roleKey(); as key) {
          <p class="role-chip mt-5">
            {{ 'auth.notPermitted.signedInAs' | translate: { role: (key | translate) } }}
          </p>
        }

        <div class="mt-7 flex flex-wrap gap-3">
          <a class="btn-primary touch-target" [routerLink]="homePath()">
            {{ homeLabelKey() | translate }}
          </a>
          @if (signedIn()) {
            <button type="button" class="btn-ghost touch-target" (click)="signOut()">
              {{ 'auth.signOut' | translate }}
            </button>
          }
        </div>
      </div>
    </main>
  `,
  styles: `
    .badge {
      display: grid;
      place-items: center;
      inline-size: 3rem;
      block-size: 3rem;
      border-radius: 1rem;
      background: var(--color-surface-2);
      color: var(--color-ink-muted);
    }

    .badge svg {
      inline-size: 1.75rem;
      block-size: 1.75rem;
    }

    .role-chip {
      display: inline-block;
      padding: 0.35rem 0.8rem;
      border-radius: 999px;
      background: var(--color-surface-2);
      color: var(--color-ink);
      font-size: 0.875rem;
      font-weight: 600;
    }

    .btn-primary {
      display: inline-flex;
      align-items: center;
      padding: 0.7rem 1.25rem;
      border-radius: 0.875rem;
      background: var(--color-paddy-600);
      color: var(--color-ink-invert);
      font-weight: 700;
      transition: background-color var(--duration-1) var(--ease-settle);
    }

    .btn-primary:hover {
      background: var(--color-paddy-700);
    }

    .btn-ghost {
      display: inline-flex;
      align-items: center;
      padding: 0.7rem 1.25rem;
      border-radius: 0.875rem;
      border: 1px solid var(--color-surface-3);
      color: var(--color-ink-muted);
      font-weight: 700;
      transition: background-color var(--duration-1) var(--ease-settle);
    }

    .btn-ghost:hover {
      background: var(--color-surface-2);
    }
  `,
})
export class NotPermittedPage {
  private readonly session = inject(SessionStore);
  private readonly facade = inject(AuthFacade);

  protected readonly signedIn = this.session.isAuthenticated;

  /** The role is read from the session (JWT claim), never from the URL that got here. */
  protected readonly roleKey = computed(() => {
    const role = this.session.role();
    return role === null ? null : `auth.role.${role}`;
  });

  protected readonly homePath = computed(() => homePathForRole(this.session.role()));

  protected readonly homeLabelKey = computed(() =>
    this.homePath() === AUTH_SURFACES.farmerLogin
      ? 'auth.notPermitted.signIn'
      : 'auth.notPermitted.home',
  );

  protected signOut(): void {
    void this.facade.signOut();
  }
}
