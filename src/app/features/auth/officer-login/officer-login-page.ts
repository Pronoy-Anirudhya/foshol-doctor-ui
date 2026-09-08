import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AUTH_SURFACES } from '../../../core/auth/auth.guard';
import { AuthFacade } from '../../../core/auth/auth-facade';
import { AuthShell } from '../shared/auth-shell';
import { DemoHint, demoValue, type DemoAccount } from '../shared/demo-hint';
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
                id="password"
                [attr.type]="passwordVisible() ? 'text' : 'password'"
                autocomplete="current-password"
                class="field pe-28"
                formControlName="password"
                [attr.aria-invalid]="passwordInvalid() ? 'true' : null"
                [attr.aria-errormessage]="passwordInvalid() ? 'password-error' : null"
              />
              <button
                type="button"
                class="reveal"
                [attr.aria-pressed]="passwordVisible()"
                (click)="passwordVisible.set(!passwordVisible())"
              >
                {{
                  (passwordVisible() ? 'auth.officer.hidePassword' : 'auth.officer.showPassword')
                    | translate
                }}
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

        <div class="mt-6">
          <foshol-demo-hint variant="console" (use)="fillDemo($event)" />
        </div>

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
      min-block-size: 2.75rem;
      padding: 0.35rem 0.6rem;
      border-radius: 0.5rem;
      font-size: 0.75rem;
      font-weight: 700;
      color: var(--color-slate-700);
      background: var(--color-surface-2);
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
        box-shadow var(--duration-2) var(--ease-settle);
    }

    .btn-console:hover:not(:disabled) {
      background: var(--color-slate-900);
      box-shadow: var(--shadow-lift);
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
  private readonly translate = inject(TranslateService);

  protected readonly farmerLoginPath = AUTH_SURFACES.farmerLogin;
  protected readonly passwordVisible = signal(false);

  protected readonly form = new FormGroup({
    username: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  private readonly submitted = signal(false);

  protected readonly usernameInvalid = computed(
    () => this.submitted() && this.form.controls.username.invalid,
  );
  protected readonly passwordInvalid = computed(
    () => this.submitted() && this.form.controls.password.invalid,
  );

  protected async submit(): Promise<void> {
    this.submitted.set(true);
    if (this.form.invalid || this.facade.loginPending()) return;

    const { username, password } = this.form.getRawValue();
    await this.facade.officerLogin(username, password);
  }

  protected fillDemo(account: DemoAccount): void {
    if (account === 'farmer') return;

    const isAdmin = account === 'admin';
    this.form.setValue({
      username: demoValue(
        this.translate,
        isAdmin ? 'auth.demo.adminUsername' : 'auth.demo.officerUsername',
      ),
      password: demoValue(
        this.translate,
        isAdmin ? 'auth.demo.adminPassword' : 'auth.demo.officerPassword',
      ),
    });
    this.submitted.set(false);
  }
}
