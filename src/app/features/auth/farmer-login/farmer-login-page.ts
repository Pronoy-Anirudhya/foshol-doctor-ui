import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { AUTH_SURFACES } from '../../../core/auth/auth.guard';
import { AuthFacade } from '../../../core/auth/auth-facade';
import { APP_CONFIG } from '../../../core/config/app-config';
import { Icon } from '../../../shared/ui/icon/icon';
import { localiseAuthProblem } from '../shared/auth-error-keys';
import { AuthShell } from '../shared/auth-shell';
import { DEMO_ACCOUNTS, DemoHint, type DemoAccount } from '../shared/demo-hint';
import { ProblemNotice } from '../shared/problem-notice';
import { Countdown } from './otp-countdown';

const NON_DIGIT = /\D/g;

/** The delivery mode the `local`/`demo` profiles report (handover §5.1). */
const DEV_FIXED = 'DEV_FIXED';

/**
 * WEB-FR-010 — the farmer login collects a phone number, requests an OTP, then collects a
 * `foshol.auth.otp.length`-digit code. One component, two steps, driven by a signal: the
 * number the farmer typed never leaves this component except in a POST body, and never enters
 * a URL, a query parameter or a route fragment (`WEB-SEC-002`).
 *
 * WEB-FR-011 — while OTP requests are rate-limited the request control is disabled and the
 * wait derived from `Retry-After` is shown, counting down.
 *
 * WEB-SEC-006 — the code is never echoed. A rejected code is cleared from the boxes rather
 * than left on screen, and it appears in no message, no URL and no log.
 *
 * The six boxes are ONE labelled group: a `fieldset` with a `legend` names them collectively,
 * each box says which position it is, and the hint is associated to all of them. They advance
 * on input, accept a paste anywhere in the row, walk backwards on `Backspace`, and move with
 * the arrow keys (`WEB-UX-040`, `WEB-UX-046`).
 */
@Component({
  selector: 'foshol-farmer-login-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AuthShell,
    DemoHint,
    Icon,
    ProblemNotice,
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
  ],
  template: `
    <foshol-auth-shell variant="farmer">
      <div class="card p-6 sm:p-8">
        <h2 class="text-2xl font-bold">{{ 'auth.farmer.title' | translate }}</h2>
        <p class="mt-1 text-ink-muted">{{ 'auth.farmer.subtitle' | translate }}</p>

        <!-- WEB-UX-046 — step changes and send results announce politely. -->
        <p class="sr-only" aria-live="polite">
          @if (onCodeStep()) {
            {{ 'auth.farmer.codeSentAnnounce' | translate }}
          }
        </p>

        @if (onCodeStep()) {
          <p class="mt-5 text-sm text-ink-muted">
            {{
              'auth.farmer.codeSentTo'
                | translate: { phone: phone(), length: otpLength }
            }}
          </p>
        }

        <div class="mt-5">
          <foshol-problem-notice [problem]="activeProblem()" />
        </div>

        @if (!onCodeStep()) {
          <form class="mt-5 space-y-4" [formGroup]="phoneForm" (ngSubmit)="sendCode()">
            <div>
              <label class="field-label" for="phone">
                {{ 'auth.farmer.phoneLabel' | translate }}
              </label>
              <input
                #phoneInput
                id="phone"
                type="tel"
                inputmode="tel"
                autocomplete="tel"
                class="field font-latin"
                formControlName="phone"
                aria-describedby="phone-hint"
                [attr.aria-invalid]="phoneInvalid() ? 'true' : null"
                [attr.aria-errormessage]="phoneInvalid() ? 'phone-error' : null"
                (input)="phoneTouched.set(false)"
              />
              <p id="phone-hint" class="mt-1.5 text-xs text-ink-faint">
                {{ 'auth.farmer.phoneHint' | translate }}
              </p>
              @if (phoneInvalid()) {
                <p id="phone-error" class="field-error">
                  @if (phoneForm.controls.phone.hasError('required')) {
                    {{ 'auth.farmer.phoneRequired' | translate }}
                  } @else {
                    {{ 'auth.farmer.phoneInvalid' | translate }}
                  }
                </p>
              }
            </div>

            @if (cooldown.active()) {
              <p class="wait" role="status">
                <foshol-icon class="shrink-0" name="hourglass" size="sm" />
                {{ 'auth.farmer.rateLimited' | translate: { time: cooldown.display() } }}
              </p>
            }

            <button
              type="submit"
              class="btn-primary touch-target"
              [disabled]="facade.requestPending() || cooldown.active()"
            >
              {{
                (facade.requestPending() ? 'auth.farmer.requesting' : 'auth.farmer.requestOtp')
                  | translate
              }}
            </button>
          </form>
        } @else {
          <form class="mt-5 space-y-4" (ngSubmit)="submitCode()">
            <fieldset class="border-0 p-0" (focusout)="onGroupBlur($event)">
              <legend class="field-label">{{ 'auth.farmer.codeGroupLabel' | translate }}</legend>
              <div class="mt-2 flex gap-2 sm:gap-3">
                @for (position of positions; track position) {
                  <input
                    #box
                    type="text"
                    class="otp-box font-latin"
                    inputmode="numeric"
                    [attr.maxlength]="otpLength"
                    [attr.autocomplete]="position === firstPosition ? 'one-time-code' : 'off'"
                    [attr.aria-label]="
                      'auth.farmer.codeDigitLabel'
                        | translate: { index: position + oneBased, total: otpLength }
                    "
                    [attr.aria-describedby]="codeIncomplete() ? 'code-hint code-error' : 'code-hint'"
                    [attr.aria-invalid]="codeIncomplete() ? 'true' : null"
                    (input)="onInput(position, $event)"
                    (keydown)="onKeydown(position, $event)"
                    (paste)="onPaste(position, $event)"
                    (focus)="selectBox(position)"
                  />
                }
              </div>
              <p id="code-hint" class="mt-2 text-xs text-ink-faint">
                {{ 'auth.farmer.codeHint' | translate }}
              </p>
              @if (codeIncomplete()) {
                <p id="code-error" class="field-error">
                  {{ 'auth.farmer.codeInvalid' | translate: { length: otpLength } }}
                </p>
              }
            </fieldset>

            @if (facade.otpDeliveryMode() === devFixed) {
              <p class="notice-soft">{{ 'auth.farmer.devFixedNotice' | translate }}</p>
            }

            <p class="text-sm text-ink-muted" role="status">
              @if (expiry.active()) {
                {{ 'auth.farmer.expiresIn' | translate: { time: expiry.display() } }}
              } @else {
                {{ 'auth.farmer.expired' | translate }}
              }
            </p>

            @if (cooldown.active()) {
              <p class="wait" role="status">
                <foshol-icon class="shrink-0" name="hourglass" size="sm" />
                {{ 'auth.farmer.rateLimited' | translate: { time: cooldown.display() } }}
              </p>
            }

            <button
              type="submit"
              class="btn-primary touch-target"
              [disabled]="!codeComplete() || facade.verifyPending()"
            >
              {{
                (facade.verifyPending() ? 'auth.farmer.verifying' : 'auth.farmer.verify') | translate
              }}
            </button>

            <div class="flex flex-wrap gap-x-5 gap-y-2 pt-1">
              <button
                type="button"
                class="link"
                [disabled]="facade.requestPending() || cooldown.active()"
                (click)="resend()"
              >
                {{ 'auth.farmer.resend' | translate }}
              </button>
              <button type="button" class="link" (click)="changeNumber()">
                {{ 'auth.farmer.changeNumber' | translate }}
              </button>
            </div>
          </form>
        }

        @if (showDemoHints) {
          <div class="mt-6">
            <foshol-demo-hint variant="farmer" (use)="fillDemo($event)" />
          </div>
        }

        <p class="mt-5 border-t border-surface-2 pt-4 text-sm">
          <a class="link" [routerLink]="officerLoginPath">
            {{ 'auth.farmer.officerLink' | translate }}
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
      min-block-size: 44px;
      padding: 0.6rem 0.85rem;
      border: 1px solid var(--color-surface-3);
      border-radius: 0.75rem;
      background: var(--color-surface-0);
      transition: border-color var(--duration-1) var(--ease-settle);
    }

    .field:hover {
      border-color: var(--color-paddy-300);
    }

    .field-error {
      margin-block-start: 0.4rem;
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--color-clay-700);
    }

    .otp-box {
      inline-size: 100%;
      min-inline-size: 0;
      block-size: 3.5rem;
      text-align: center;
      font-size: 1.5rem;
      font-weight: 700;
      border: 1px solid var(--color-surface-3);
      border-radius: 0.75rem;
      background: var(--color-surface-0);
      box-shadow: var(--shadow-stamp) inset;
      transition:
        border-color var(--duration-1) var(--ease-settle),
        transform var(--duration-1) var(--ease-settle);
    }

    .otp-box:focus {
      border-color: var(--color-paddy-600);
      transform: translateY(-1px);
    }

    .btn-primary {
      inline-size: 100%;
      padding: 0.75rem 1.25rem;
      border-radius: 0.875rem;
      background: var(--color-paddy-600);
      color: var(--color-ink-invert);
      font-weight: 700;
      box-shadow: var(--shadow-card);
      transition:
        background-color var(--duration-1) var(--ease-settle),
        box-shadow var(--duration-2) var(--ease-settle),
        transform var(--duration-1) var(--ease-settle);
    }

    .btn-primary:hover:not(:disabled) {
      background: var(--color-paddy-700);
      box-shadow: var(--shadow-lift);
    }

    .btn-primary:active:not(:disabled) {
      transform: scale(0.98);
    }

    .btn-primary:disabled {
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
      color: var(--color-paddy-700);
      text-decoration: underline;
      text-underline-offset: 3px;
    }

    .link:disabled {
      color: var(--color-ink-faint);
      text-decoration: none;
      cursor: not-allowed;
    }

    /* WEB-UX-044 — the hourglass and the wording carry the meaning, not the amber alone. */
    .wait {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
      padding: 0.6rem 0.8rem;
      border: 1px solid var(--color-dawn-300);
      border-radius: 0.75rem;
      background: var(--color-dawn-100);
      color: var(--color-dawn-700);
      font-size: 0.875rem;
      font-weight: 600;
    }

    /* Optically centres the 16 px glyph on the first line of 14 px/1.5 text. */
    .wait foshol-icon {
      margin-block-start: 0.15rem;
    }

    .notice-soft {
      padding: 0.55rem 0.8rem;
      border-radius: 0.75rem;
      background: var(--color-paddy-50);
      color: var(--color-paddy-700);
      font-size: 0.8125rem;
      font-weight: 600;
    }
  `,
})
export class FarmerLoginPage {
  protected readonly facade = inject(AuthFacade);
  private readonly injector = inject(Injector);

  /** Hackathon-only — `false` in production; see `APP_CONFIG.demo`. */
  protected readonly showDemoHints = APP_CONFIG.demo.showLoginHints;

  protected readonly otpLength = APP_CONFIG.auth.otpLength;
  protected readonly positions = Array.from({ length: APP_CONFIG.auth.otpLength }, (_, i) => i);
  protected readonly firstPosition = this.positions[0];
  /** Screen-reader positions are 1-based; the array is 0-based. */
  protected readonly oneBased = 1;
  protected readonly devFixed = DEV_FIXED;
  protected readonly officerLoginPath = AUTH_SURFACES.officerLogin;

  /** The challenge lifetime, and the WEB-FR-011 rate-limit wait. */
  protected readonly expiry = new Countdown();
  protected readonly cooldown = new Countdown();

  private readonly boxes = viewChildren<ElementRef<HTMLInputElement>>('box');

  protected readonly phoneForm = new FormGroup({
    phone: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(APP_CONFIG.auth.phonePattern)],
    }),
  });

  /**
   * The code is a fixed-length array of positions rather than a string, so clearing the third
   * box leaves the fourth where it was instead of shifting the row left.
   *
   * Six boxes are one composite, not one native control, so this row is signal-backed while
   * both single-field forms on these two screens are reactive forms. The validity rule is a
   * `computed` for exactly the same reason a `Validators.pattern` would be on a single input.
   */
  private readonly digits = signal<readonly string[]>(emptyDigits(APP_CONFIG.auth.otpLength));

  private readonly step = signal<'phone' | 'code'>('phone');
  private readonly _phone = signal('');
  protected readonly phoneTouched = signal(false);
  private readonly codeTouched = signal(false);

  protected readonly phone = this._phone.asReadonly();
  protected readonly onCodeStep = computed(() => this.step() === 'code');
  protected readonly code = computed(() => this.digits().join(''));
  protected readonly codeComplete = computed(() => this.code().length === this.otpLength);
  protected readonly codeIncomplete = computed(() => this.codeTouched() && !this.codeComplete());

  protected readonly phoneInvalid = computed(
    () => this.phoneTouched() && this.phoneForm.controls.phone.invalid,
  );

  private readonly phoneInputRef = viewChild<ElementRef<HTMLInputElement>>('phoneInput');

  /**
   * One notice at a time: the verification failure on step two, otherwise the send failure.
   *
   * `localiseAuthProblem` swaps in our own Bangla copy for the codes we have something better to
   * say about — today just `ERR_FARMER_NOT_FOUND`, the 404 that means this number is not a
   * registered farmer. Everything else, a verify `401` included, passes through with the server's
   * own `detail` intact.
   */
  protected readonly activeProblem = computed(() =>
    localiseAuthProblem(
      this.onCodeStep()
        ? (this.facade.verifyState().problem ?? this.facade.requestState().problem)
        : this.facade.requestState().problem,
    ),
  );

  constructor() {
    // WEB-FR-011 — the wait is the server's; the client only counts it down.
    effect(() => {
      const seconds = this.facade.retryAfterSeconds();
      if (seconds !== null) this.cooldown.start(seconds);
    });
  }

  protected async sendCode(): Promise<void> {
    this.phoneTouched.set(true);
    this.phoneForm.controls.phone.markAsTouched();
    if (this.phoneForm.invalid) {
      this.phoneInputRef()?.nativeElement.focus();
      return;
    }
    if (this.facade.requestPending() || this.cooldown.active()) return;

    const phone = this.phoneForm.controls.phone.value.trim();
    if (!(await this.facade.requestOtp(phone))) return;

    this._phone.set(phone);
    this.clearDigits();
    this.step.set('code');
    this.expiry.start(this.facade.expiresInSeconds() ?? 0);
    this.focusFirstBoxWhenRendered();
  }

  protected async resend(): Promise<void> {
    if (this.facade.requestPending() || this.cooldown.active()) return;
    if (!(await this.facade.requestOtp(this._phone()))) return;

    this.clearDigits();
    this.expiry.start(this.facade.expiresInSeconds() ?? 0);
    this.focusBox(0);
  }

  protected changeNumber(): void {
    this.expiry.stop();
    this.clearDigits();
    this.step.set('phone');
    this.facade.clearChallenge();
  }

  protected async submitCode(): Promise<void> {
    if (!this.codeComplete()) {
      this.codeTouched.set(true);
      this.focusBox(this.digits().findIndex((digit) => digit === ''));
      return;
    }
    if (this.facade.verifyPending()) return;

    if (!(await this.facade.verifyOtp(this._phone(), this.code()))) {
      // WEB-SEC-006 — a rejected code is cleared rather than left on screen to be re-read.
      this.clearDigits();
      this.focusBox(0);
    }
  }

  protected onInput(position: number, event: Event): void {
    this.codeTouched.set(false);
    const element = event.target as HTMLInputElement;
    const typed = element.value.replace(NON_DIGIT, '');

    if (typed.length === 0) {
      this.writeDigits(replaceAt(this.digits(), position, ''));
      return;
    }

    this.writeDigits(overlay(this.digits(), position, typed));
    this.focusBox(position + typed.length);
    if (this.codeComplete()) void this.submitCode();
  }

  protected onKeydown(position: number, event: KeyboardEvent): void {
    const element = event.target as HTMLInputElement;

    if (event.key === 'Backspace' && element.value === '') {
      event.preventDefault();
      this.codeTouched.set(false);
      this.writeDigits(replaceAt(this.digits(), position - 1, ''));
      this.focusBox(position - 1);
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.focusBox(position - 1);
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.focusBox(position + 1);
    }
  }

  protected onPaste(position: number, event: ClipboardEvent): void {
    const pasted = (event.clipboardData?.getData('text') ?? '').replace(NON_DIGIT, '');
    if (pasted.length === 0) return;

    event.preventDefault();
    this.codeTouched.set(false);
    this.writeDigits(overlay(this.digits(), position, pasted));
    this.focusBox(position + pasted.length);
    if (this.codeComplete()) void this.submitCode();
  }

  protected selectBox(position: number): void {
    this.boxes()[position]?.nativeElement.select();
  }

  /**
   * The "not finished" message appears when the farmer leaves the row still short of a full
   * code — never mid-typing, which would nag from the second digit onwards.
   */
  protected onGroupBlur(event: FocusEvent): void {
    const group = event.currentTarget as HTMLElement;
    const next = event.relatedTarget as Node | null;
    if (next !== null && group.contains(next)) return;
    this.codeTouched.set(true);
  }

  protected fillDemo(account: DemoAccount): void {
    if (account !== 'farmer') return;

    if (this.onCodeStep()) {
      this.writeDigits(overlay(emptyDigits(this.otpLength), 0, DEMO_ACCOUNTS.farmer.otp));
      return;
    }
    this.phoneForm.controls.phone.setValue(DEMO_ACCOUNTS.farmer.phone);
  }

  /**
   * The boxes are DOM-driven and the signal is the source of truth, so every mutation writes
   * the whole row back. Binding `[value]` instead would not repaint when a farmer retypes the
   * same digit into the same box.
   */
  private writeDigits(next: readonly string[]): void {
    this.digits.set(next);
    for (const [index, box] of this.boxes().entries()) {
      box.nativeElement.value = next[index] ?? '';
    }
  }

  private clearDigits(): void {
    this.digits.set(emptyDigits(this.otpLength));
    this.codeTouched.set(false);
    for (const box of this.boxes()) box.nativeElement.value = '';
  }

  private focusBox(position: number): void {
    const clamped = Math.min(Math.max(position, 0), this.otpLength - this.oneBased);
    const box = this.boxes()[clamped]?.nativeElement;
    box?.focus();
    box?.select();
  }

  private focusFirstBoxWhenRendered(): void {
    afterNextRender(() => this.focusBox(0), { injector: this.injector });
  }
}

function emptyDigits(length: number): readonly string[] {
  return Array.from({ length }, () => '');
}

function replaceAt(digits: readonly string[], position: number, digit: string): readonly string[] {
  if (position < 0 || position >= digits.length) return digits;
  return digits.map((existing, index) => (index === position ? digit : existing));
}

/** Lays `incoming` over the row starting at `position` — how a pasted code lands. */
function overlay(digits: readonly string[], position: number, incoming: string): readonly string[] {
  return digits.map((existing, index) => {
    const offset = index - position;
    return offset >= 0 && offset < incoming.length ? (incoming[offset] ?? existing) : existing;
  });
}

