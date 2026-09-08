import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { AUTH_SURFACES } from '../../../core/auth/auth.guard';
import { AuthFacade } from '../../../core/auth/auth-facade';
import { APP_CONFIG } from '../../../core/config/app-config';
import { AuthShell } from '../shared/auth-shell';
import { DEMO_ACCOUNTS, DemoHint, type DemoAccount } from '../shared/demo-hint';
import { ProblemNotice } from '../shared/problem-notice';

/**
 * WEB-FR-012 — the officer and admin login collects a username and password and exchanges them
 * for a JWT. One endpoint serves both roles; `principal.role` on the response distinguishes
 * them (handover §5.3), and the facade routes on the role from the token — never on which URL
 * was used to reach this page.
 *
 * Same layout and rhythm as the farmer login, dressed in the slate console chrome so an
 * officer can see at a glance which surface they are entering.
 */
@Component({
  selector: 'foshol-officer-login-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthShell, DemoHint, ProblemNotice, ReactiveFormsModule, RouterLink, TranslatePipe],
  template: `
    <foshol-auth-shell variant="console">
      <div class="card p-6 sm:p-8">
        <h2 class="text-2xl font-bold">{{ 'auth.officer.title' | translate }}</h2>
        <p class="mt-1 text-ink-muted">{{ 'auth.officer.subtitle' | translate }}</p>

        <div class="mt-5">
          <foshol-problem-notice [problem]="facade.loginState().problem" />
        </div>

        <form class="mt-5 space-y-4" [formGroup]="form" (ngSubmit)="submit()">
          <div>
            <label class="field-label" for="username">
              {{ 'auth.officer.usernameLabel' | translate }}
            </label>
            <input
              #usernameInput
              id="username"
              type="text"
              autocomplete="username"
              class="field font-latin"
              formControlName="username"
              [attr.aria-invalid]="usernameInvalid() ? 'true' : null"
              [attr.aria-errormessage]="usernameInvalid() ? 'username-error' : null"
            />
            @if (usernameInvalid()) {
              <p id="username-error" class="field-error">
                {{ 'auth.officer.usernameRequired' | translate }}
              </p>
            }
          </div>

          <div>
            <label class="field-label" for="password">
              {{ 'auth.officer.passwordLabel' | translate }}
            </label>
            <div class="relative">
              <input
                #passwordInput
                id="password"
                [attr.type]="passwordVisible() ? 'text' : 'password'"
                autocomplete="current-password"
                class="field pe-12"
                formControlName="password"
                [attr.aria-invalid]="passwordInvalid() ? 'true' : null"
                [attr.aria-errormessage]="passwordInvalid() ? 'password-error' : null"
              />
              <button
                type="button"
                class="reveal touch-target"
                [attr.aria-pressed]="passwordVisible()"
                [attr.aria-label]="
                  (passwordVisible() ? 'auth.officer.hidePassword' : 'auth.officer.showPassword')
                    | translate
                "
                (click)="passwordVisible.set(!passwordVisible())"
              >
                @if (passwordVisible()) {
                  <svg viewBox="0 0 20 20" class="h-5 w-5" aria-hidden="true" fill="none">
                    <path
                      d="M3 3l14 14M8.5 8.65a2 2 0 0 0 2.85 2.85M6.1 6.15C4 7.4 2.5 9.3 2 10c1.3 1.85 4.2 5 8 5 1.4 0 2.65-.4 3.75-1M13.9 13.85C15.35 12.9 16.55 11.5 18 10c-1.3-1.85-4.2-5-8-5-.65 0-1.28.08-1.87.24"
                      stroke="currentColor"
                      stroke-width="1.6"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                } @else {
                  <svg viewBox="0 0 20 20" class="h-5 w-5" aria-hidden="true" fill="none">
                    <path
                      d="M2 10c1.3-1.85 4.2-5 8-5s6.7 3.15 8 5c-1.3 1.85-4.2 5-8 5s-6.7-3.15-8-5Z"
                      stroke="currentColor"
                      stroke-width="1.6"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                    <circle cx="10" cy="10" r="2.3" stroke="currentColor" stroke-width="1.6" />
                  </svg>
                }
              </button>
            </div>
            @if (passwordInvalid()) {
              <p id="password-error" class="field-error">
                {{ 'auth.officer.passwordRequired' | translate }}
              </p>
            }
          </div>

          <button type="submit" class="btn-console touch-target" [disabled]="facade.loginPending()">
            {{
              (facade.loginPending() ? 'auth.officer.submitting' : 'auth.officer.submit') | translate
            }}
          </button>
        </form>

        @if (showDemoHints) {
          <div class="mt-6">
            <foshol-demo-hint variant="console" (use)="fillDemo($event)" />
          </div>
        }

        <p class="mt-5 border-t border-surface-2 pt-4 text-sm">
          <a class="link" [routerLink]="farmerLoginPath">
            {{ 'auth.officer.farmerLink' | translate }}
          </a>
        </p>
      </div>
    </foshol-auth-shell>
  `,
  styles: `
    .field-label {
      display: block;
      font-weight: 600;
      color: var(--color-ink);
    }

    .field {
      margin-block-start: 0.4rem;
      inline-size: 100%;
      min-block-size: 3rem;
      padding: 0.6rem 0.85rem;
      border: 1px solid var(--color-surface-3);
      border-radius: 0.75rem;
      background: var(--color-surface-0);
      transition: border-color var(--duration-1) var(--ease-settle);
    }

    .field:hover {
      border-color: var(--color-slate-600);
    }

    .field-error {
      margin-block-start: 0.4rem;
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--color-clay-700);
    }

    .reveal {
      position: absolute;
      inset-block-start: 50%;
      inset-inline-end: 0.35rem;
      transform: translateY(-50%);
      margin-block-start: 0.2rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 0.6rem;
      color: var(--color-slate-700);
      background: var(--color-surface-2);
      transition: background-color var(--duration-1) var(--ease-settle);
    }

    .reveal:hover {
      background: var(--color-surface-3);
    }

    .btn-console {
      inline-size: 100%;
      padding: 0.75rem 1.25rem;
      border-radius: 0.875rem;
      background: var(--color-slate-800);
      color: var(--color-ink-invert);
      font-weight: 700;
      box-shadow: var(--shadow-card);
      transition:
        background-color var(--duration-1) var(--ease-settle),
        box-shadow var(--duration-2) var(--ease-settle),
        transform var(--duration-1) var(--ease-settle);
    }

    .btn-console:hover:not(:disabled) {
      background: var(--color-slate-900);
      box-shadow: var(--shadow-lift);
    }

    .btn-console:active:not(:disabled) {
      transform: scale(0.98);
    }

    .btn-console:disabled {
      background: var(--color-surface-3);
      color: var(--color-ink-muted);
      box-shadow: none;
      cursor: not-allowed;
    }

    /* WEB-UX-033 — a text control is still a touch target. */
    .link {
      display: inline-flex;
      align-items: center;
      min-block-size: 44px;
      font-weight: 600;
      color: var(--color-slate-700);
      text-decoration: underline;
      text-underline-offset: 3px;
    }
  `,
})
export class OfficerLoginPage {
  protected readonly facade = inject(AuthFacade);

  protected readonly farmerLoginPath = AUTH_SURFACES.farmerLogin;
  /** Hackathon-only — `false` in production; see `APP_CONFIG.demo`. */
  protected readonly showDemoHints = APP_CONFIG.demo.showLoginHints;
  protected readonly passwordVisible = signal(false);

  protected readonly form = new FormGroup({
    username: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  private readonly submitted = signal(false);
  private readonly usernameInputRef = viewChild<ElementRef<HTMLInputElement>>('usernameInput');
  private readonly passwordInputRef = viewChild<ElementRef<HTMLInputElement>>('passwordInput');

  protected readonly usernameInvalid = computed(
    () => this.submitted() && this.form.controls.username.invalid,
  );
  protected readonly passwordInvalid = computed(
    () => this.submitted() && this.form.controls.password.invalid,
  );

  protected async submit(): Promise<void> {
    this.submitted.set(true);
    if (this.form.invalid) {
      // First red field wins the focus — username precedes password on screen.
      const target = this.form.controls.username.invalid
        ? this.usernameInputRef()
        : this.passwordInputRef();
      target?.nativeElement.focus();
      return;
    }
    if (this.facade.loginPending()) return;

    const { username, password } = this.form.getRawValue();
    await this.facade.officerLogin(username, password);
  }

  protected fillDemo(account: DemoAccount): void {
    if (account === 'farmer') return;

    const seeded = account === 'admin' ? DEMO_ACCOUNTS.admin : DEMO_ACCOUNTS.officer;
    this.form.setValue(seeded);
    this.submitted.set(false);
  }
}
