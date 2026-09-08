import { computed, inject, Injectable, InjectionToken, signal } from '@angular/core';
import { Router } from '@angular/router';
import { toProblemView, type ProblemView } from '../errors/problem';
import type { AuthResponse } from '../../generated/models/auth-response';
import type { Principal } from '../../generated/models/principal';
import { AuthService } from '../../generated/services/auth.service';
import { APP_CONFIG } from '../config/app-config';
import { homePathForRole, loginPathForUrl } from './auth.guard';
import { SessionStore } from './session-store';

/**
 * A unit conversion, not a tunable: the wire carries `expiresInSeconds` and `Retry-After` in
 * seconds while `APP_CONFIG.auth.otpTtlMs` mirrors a `Duration` in milliseconds. WEB-NFR-009
 * asks for named constants for thresholds, limits, intervals and sizes; this is none of those,
 * and `app-config.ts` is frozen. An amendment adding a seconds-valued OTP TTL would let this
 * disappear.
 */
export const MS_PER_SECOND = 1_000;

/**
 * WEB-SEC-004 — signing out must clear every store holding session, case and draft state and
 * close the SSE connection. Those stores must not be imported here: the dependency arrow has
 * to point from a feature to auth, never back. So each such store registers a teardown:
 *
 * ```ts
 * { provide: SESSION_TEARDOWN, multi: true,
 *   useFactory: () => { const sse = inject(SseClient); return () => sse.close(); } }
 * ```
 *
 * `signOut()` invokes every registered callback before it clears the token, so a stream can
 * still be closed politely while the credential that opened it is alive.
 */
export type SessionTeardown = () => void;
export const SESSION_TEARDOWN = new InjectionToken<readonly SessionTeardown[]>(
  'foshol.session.teardown',
);

export type AuthPhase = 'idle' | 'pending' | 'succeeded' | 'failed';

/** WEB-FR-005 — a failure is a problem document to render, never a status code on screen. */
export interface AuthOperationState {
  readonly phase: AuthPhase;
  readonly problem: ProblemView | null;
}

const IDLE: AuthOperationState = { phase: 'idle', problem: null };
const PENDING: AuthOperationState = { phase: 'pending', problem: null };
const SUCCEEDED: AuthOperationState = { phase: 'succeeded', problem: null };

/** The `202` challenge body of `POST /api/v1/auth/otp/request` (handover §5.1). */
interface OtpChallenge {
  readonly expiresInSeconds: number;
  readonly otpDeliveryMode: string | null;
}

/**
 * The one place the three login operations live (`WEB-FR-010`…`WEB-FR-013`).
 *
 * It wraps the generated `AuthService` — every URL is built by the generated client, never by
 * concatenation (`WEB-API-001`) — and exposes signals only (`WEB-NFR-002`). Neither the phone
 * number nor the OTP code ever reaches a URL, a query parameter or a log (`WEB-SEC-002`,
 * `WEB-SEC-006`); both travel in a POST body and are dropped as soon as the exchange succeeds.
 */
@Injectable({ providedIn: 'root' })
export class AuthFacade {
  private readonly api = inject(AuthService);
  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);
  private readonly teardowns = inject(SESSION_TEARDOWN, { optional: true }) ?? [];

  private readonly _requestState = signal<AuthOperationState>(IDLE);
  private readonly _verifyState = signal<AuthOperationState>(IDLE);
  private readonly _loginState = signal<AuthOperationState>(IDLE);
  private readonly _expiresInSeconds = signal<number | null>(null);
  private readonly _otpDeliveryMode = signal<string | null>(null);
  private readonly _retryAfterSeconds = signal<number | null>(null);

  readonly requestState = this._requestState.asReadonly();
  readonly verifyState = this._verifyState.asReadonly();
  readonly loginState = this._loginState.asReadonly();

  /** Lifetime of the outstanding challenge, for the step-two countdown. */
  readonly expiresInSeconds = this._expiresInSeconds.asReadonly();
  /** `DEV_FIXED` on the demo profile — surfaced so the login can say so out loud. */
  readonly otpDeliveryMode = this._otpDeliveryMode.asReadonly();
  /** WEB-FR-011 — seconds the server told us to wait after a `429`. */
  readonly retryAfterSeconds = this._retryAfterSeconds.asReadonly();

  readonly requestPending = computed(() => this._requestState().phase === 'pending');
  readonly verifyPending = computed(() => this._verifyState().phase === 'pending');
  readonly loginPending = computed(() => this._loginState().phase === 'pending');
  readonly challengeIssued = computed(() => this._requestState().phase === 'succeeded');
  readonly rateLimited = computed(() => this._retryAfterSeconds() !== null);

  /**
   * WEB-FR-010 step one. A `202` is returned whether or not the phone is known, so a failure
   * here never says whether the number exists (handover §5.1) — the UI simply shows the
   * problem document the server chose to send.
   */
  async requestOtp(phone: string): Promise<boolean> {
    this._requestState.set(PENDING);
    this._retryAfterSeconds.set(null);
    try {
      const response = await this.api.requestOtp$Response({ body: { phone } });
      const challenge = readOtpChallenge(response.body as unknown);
      this._expiresInSeconds.set(challenge.expiresInSeconds);
      this._otpDeliveryMode.set(challenge.otpDeliveryMode);
      this._requestState.set(SUCCEEDED);
      return true;
    } catch (error: unknown) {
      const problem = toProblemView(error);
      this._requestState.set({ phase: 'failed', problem });
      // WEB-FR-011 — the wait is the server's to dictate; the client only renders it.
      this._retryAfterSeconds.set(problem.retryAfterSeconds ?? null);
      return false;
    }
  }

  /** WEB-FR-010 step two. On success the code is discarded and never echoed (`WEB-SEC-006`). */
  async verifyOtp(phone: string, code: string): Promise<boolean> {
    this._verifyState.set(PENDING);
    try {
      const auth = await this.api.verifyOtp({ body: { phone, code } });
      await this.completeSignIn(auth);
      this._verifyState.set(SUCCEEDED);
      return true;
    } catch (error: unknown) {
      this._verifyState.set({ phase: 'failed', problem: toProblemView(error) });
      return false;
    }
  }

  /** WEB-FR-012 — one operation for both console roles; `principal.role` separates them. */
  async officerLogin(username: string, password: string): Promise<boolean> {
    this._loginState.set(PENDING);
    try {
      const auth = await this.api.officerLogin({ body: { username, password } });
      await this.completeSignIn(auth);
      this._loginState.set(SUCCEEDED);
      return true;
    } catch (error: unknown) {
      this._loginState.set({ phase: 'failed', problem: toProblemView(error) });
      return false;
    }
  }

  /** `GET /api/v1/me` — refreshes the cached principal without touching the token. */
  async loadCurrentPrincipal(): Promise<Principal | null> {
    try {
      const principal = await this.api.getCurrentPrincipal();
      this.session.setPrincipal(principal);
      return principal;
    } catch {
      return null;
    }
  }

  /**
   * WEB-SEC-004 — clear the session and every store that registered a teardown, close the SSE
   * connection, and return to the login of the surface the user was on.
   */
  async signOut(): Promise<void> {
    const destination = loginPathForUrl(this.router.url);

    for (const teardown of this.teardowns) {
      try {
        teardown();
      } catch {
        // One store failing to tear down must never strand a user in a signed-in shell.
      }
    }

    this.session.clear();
    this.session.rememberIntendedUrl(null);
    this.reset();
    await this.router.navigateByUrl(destination);
  }

  /** Drops the outstanding challenge — used when the farmer goes back to change the number. */
  clearChallenge(): void {
    this._requestState.set(IDLE);
    this._verifyState.set(IDLE);
    this._expiresInSeconds.set(null);
    this._otpDeliveryMode.set(null);
  }

  private reset(): void {
    this.clearChallenge();
    this._loginState.set(IDLE);
    this._retryAfterSeconds.set(null);
  }

  /**
   * WEB-FR-002 — restore the URL the guard retained, or fall back to the role's home. If the
   * retained URL belongs to a group this role may not enter, `roleGuard` sends it on to
   * `/not-permitted`, which is the honest outcome rather than a silent redirect.
   */
  private async completeSignIn(auth: AuthResponse): Promise<void> {
    this.session.signIn(auth.token, auth.principal, auth.expiresAt);
    this._expiresInSeconds.set(null);
    this._otpDeliveryMode.set(null);
    this._retryAfterSeconds.set(null);

    const intended = this.session.takeIntendedUrl();
    await this.router.navigateByUrl(intended ?? homePathForRole(this.session.role()));
  }
}

/**
 * The frozen OpenAPI describes the `202` minimally, so `ng-openapi-gen` types this body `void`
 * and reads the response as text. Angular's `HttpResponse.clone({ body: undefined })` treats
 * `undefined` as "not supplied" and keeps the original body, so the JSON text is still present
 * at runtime — typed away rather than thrown away. It is therefore parsed DEFENSIVELY: any
 * shape but the documented one falls back to the mirrored config value (`WEB-NFR-010`), and
 * `otpDeliveryMode` is simply absent rather than guessed.
 */
function readOtpChallenge(body: unknown): OtpChallenge {
  const parsed = typeof body === 'string' ? parseJson(body) : body;
  const fields: Record<string, unknown> =
    typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};

  const expires = fields['expiresInSeconds'];
  const mode = fields['otpDeliveryMode'];

  return {
    expiresInSeconds:
      typeof expires === 'number' && Number.isFinite(expires) && expires > 0
        ? expires
        : Math.round(APP_CONFIG.auth.otpTtlMs / MS_PER_SECOND),
    otpDeliveryMode: typeof mode === 'string' && mode.length > 0 ? mode : null,
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
