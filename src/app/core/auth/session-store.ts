import { computed, Injectable, signal } from '@angular/core';
import type { Principal } from '../../generated/models/principal';
import { APP_CONFIG } from '../config/app-config';
import { roleFromToken, type Role } from './jwt';

/**
 * The principal's geography, as the server reported it. Codes are authoritative; the names are
 * nullable on the contract, so every consumer must be able to fall back to the code rather than
 * inventing a label — this application does not carry a district list of its own.
 */
export interface PrincipalRegion {
  readonly districtCode: string | null;
  readonly divisionCode: string | null;
  readonly districtNameBn: string | null;
  readonly districtNameEn: string | null;
  readonly divisionNameBn: string | null;
  readonly divisionNameEn: string | null;
}

/**
 * WEB-SEC-001 — the JWT lives in a private signal in memory and NOWHERE else: not
 * localStorage, not sessionStorage, not IndexedDB, not a cookie, not the URL, not the document
 * title, not a log statement.
 *
 * The trade-off, stated plainly: a refresh or a new tab loses the session and the user logs in
 * again. That is a real cost, accepted because there is no refresh token and no server session
 * (COMMON-SEC-012), so a lost token costs exactly one login; demo re-login is a fixed dev OTP
 * or a seeded password and takes seconds; and persistent storage would add a token-theft
 * surface that outlives the tab, while a cookie would add CSRF and a SameSite/HTTPS problem on
 * the demo machine. This is NOT immunity to XSS — it removes persistence and CSRF, and that is
 * the whole of the claim.
 */
@Injectable({ providedIn: 'root' })
export class SessionStore {
  /** Private on purpose: no template and no other store can read the raw token. */
  readonly #token = signal<string | null>(null);

  private readonly _principal = signal<Principal | null>(null);
  private readonly _expiresAt = signal<Date | null>(null);
  /** WEB-FR-002 / WEB-FR-013 — the route to restore after a successful login. */
  private readonly _intendedUrl = signal<string | null>(null);

  readonly principal = this._principal.asReadonly();
  readonly expiresAt = this._expiresAt.asReadonly();
  readonly intendedUrl = this._intendedUrl.asReadonly();

  /**
   * Region is an identity attribute, not something the UI collects. The server snapshots the
   * farmer's division and district onto the case at submit and scopes every officer and admin
   * read to their own district, so the only honest source for it is the principal — never a
   * picker, never a URL, never a second store. `null` when the server sent no district at all,
   * so a caller renders nothing rather than an empty chip.
   */
  readonly region = computed<PrincipalRegion | null>(() => {
    const principal = this._principal();
    if (principal === undefined || principal === null) return null;
    const districtCode = principal.districtCode ?? null;
    const divisionCode = principal.divisionCode ?? null;
    if (districtCode === null && divisionCode === null) return null;
    return {
      districtCode,
      divisionCode,
      districtNameBn: principal.districtNameBn ?? null,
      districtNameEn: principal.districtNameEn ?? null,
      divisionNameBn: principal.divisionNameBn ?? null,
      divisionNameEn: principal.divisionNameEn ?? null,
    };
  });

  readonly isAuthenticated = computed(() => this.#token() !== null);
  readonly role = computed<Role | null>(() => this._principal()?.role ?? null);
  readonly subjectId = computed<string | null>(() => this._principal()?.id ?? null);
  readonly displayName = computed<string>(() => this._principal()?.name ?? '');

  /**
   * The single read point for the interceptor. Kept as a method rather than an exposed signal
   * so that "who reads the token" stays greppable to exactly one call site.
   */
  bearerToken(): string | null {
    return this.#token();
  }

  /** WEB-SEC-006 — a phone number is displayed only as its last four digits after login. */
  static maskPhone(phone: string | null | undefined): string {
    if (!phone) return '';
    const digits = phone.replace(/\D/g, '');
    return `••••${digits.slice(-APP_CONFIG.auth.phoneVisibleDigits)}`;
  }

  signIn(token: string, principal: Principal, expiresAt: string | Date): void {
    this.#token.set(token);
    // Prefer the principal the login returned; fall back to the token claim. Never the URL.
    const claimed = roleFromToken(token);
    this._principal.set(claimed && claimed !== principal.role ? { ...principal, role: claimed } : principal);
    this._expiresAt.set(expiresAt instanceof Date ? expiresAt : new Date(expiresAt));
  }

  /** Refresh the cached principal from GET /api/v1/me without touching the token. */
  setPrincipal(principal: Principal): void {
    this._principal.set(principal);
  }

  rememberIntendedUrl(url: string | null): void {
    this._intendedUrl.set(url);
  }

  takeIntendedUrl(): string | null {
    const url = this._intendedUrl();
    this._intendedUrl.set(null);
    return url;
  }

  /**
   * WEB-SEC-004 / WEB-FR-013 — clears session state. Callers are responsible for closing the
   * SSE connection and clearing the draft and case stores; SessionStore does not reach into
   * them, so that the dependency arrow never points from auth to a feature.
   */
  clear(): void {
    this.#token.set(null);
    this._principal.set(null);
    this._expiresAt.set(null);
  }
}
