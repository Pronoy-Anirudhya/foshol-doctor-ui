import { computed, Injectable, signal } from '@angular/core';
import type { Principal } from '../../generated/models/principal';
import { APP_CONFIG } from '../config/app-config';
import { expiryFromToken, roleFromToken, ROLES, type Role } from './jwt';

/**
 * The one sessionStorage key this application owns (`DEVIATIONS.md` D-37). Deliberately not in
 * `APP_CONFIG.storageKeys`, which lists the localStorage keys, and this one belongs here alone.
 */
const SESSION_KEY = 'foshol.session';

/** What survives a reload: exactly what a login returns, and nothing the user typed. */
interface PersistedSession {
  readonly token: string;
  readonly principal: Principal;
  readonly expiresAt: string;
}

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
 * WEB-SEC-001, as amended by `DEVIATIONS.md` D-37 — the JWT lives in a private signal in memory,
 * mirrored to THIS TAB's sessionStorage so that a reload does not cost a login. Nowhere else: not
 * localStorage, not IndexedDB, not a cookie, not the URL, not the document title, not a log
 * statement.
 *
 * sessionStorage rather than localStorage because it is scoped to one tab: it survives a reload,
 * dies with the tab, and two tabs signed in as two different users never overwrite each other.
 * The mirror is read exactly once, by `restore()` at bootstrap, and a token past its `exp` is
 * thrown away there rather than restored. Every sign-out path already runs through `clear()`,
 * which removes it.
 *
 * The trade-off, stated plainly: an XSS payload that could previously only act inside the page
 * can now read the token and carry it away — for at most the tab's lifetime and the token's
 * `exp`. There is still no cookie, so still no CSRF.
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
    this.#persist();
  }

  /**
   * D-37 — bring back the session this tab held before a reload. Called once, by an app
   * initializer, before the router's first navigation, so the guards already see it.
   *
   * An explicit call rather than constructor work on purpose: every spec that signs in leaves an
   * entry behind in jsdom's sessionStorage, and a constructor that read it would carry one test's
   * session into the next.
   *
   * The expiry comes from the JWT `exp` when there is one — the stored copy is only a fallback —
   * and the restore goes through `signIn`, so the `role` claim overrules the stored principal
   * exactly as it overrules a login response.
   */
  restore(): void {
    if (this.#token() !== null) return;

    const saved = this.#read();
    if (saved === null) {
      this.#forget();
      return;
    }

    const expiry = expiryFromToken(saved.token) ?? new Date(saved.expiresAt);
    if (Number.isNaN(expiry.getTime()) || expiry.getTime() <= Date.now()) {
      this.#forget();
      return;
    }

    this.signIn(saved.token, saved.principal, expiry);
  }

  /** Refresh the cached principal from GET /api/v1/me without touching the token. */
  setPrincipal(principal: Principal): void {
    this._principal.set(principal);
    this.#persist();
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
   * WEB-SEC-004 / WEB-FR-013 — clears session state, the persisted copy included. Callers are
   * responsible for closing the SSE connection and clearing the draft and case stores;
   * SessionStore does not reach into them, so that the dependency arrow never points from auth
   * to a feature.
   */
  clear(): void {
    this.#token.set(null);
    this._principal.set(null);
    this._expiresAt.set(null);
    this.#forget();
  }

  /**
   * WEB-DATA-024 applies here as it does to `LocalStore`: storage may be missing or may throw
   * (private mode, disabled site data, an embedded webview), and the answer is always "carry on
   * signed in until the next reload", never an error state.
   */
  #persist(): void {
    const token = this.#token();
    const principal = this._principal();
    const expiresAt = this._expiresAt();
    if (token === null || principal === null || expiresAt === null) return;
    try {
      const session: PersistedSession = { token, principal, expiresAt: expiresAt.toISOString() };
      globalThis.sessionStorage?.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
      /* Quota, disabled storage or an invalid date — the session still works until a reload. */
    }
  }

  #read(): PersistedSession | null {
    try {
      const raw = globalThis.sessionStorage?.getItem(SESSION_KEY) ?? null;
      if (raw === null) return null;
      const parsed: unknown = JSON.parse(raw);
      return isPersistedSession(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  #forget(): void {
    try {
      globalThis.sessionStorage?.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }
}

/** Anything stored under the key is untrusted input: another script can write it. */
function isPersistedSession(value: unknown): value is PersistedSession {
  if (typeof value !== 'object' || value === null) return false;
  const { token, principal, expiresAt } = value as Record<string, unknown>;
  if (typeof token !== 'string' || token.split('.').length !== 3) return false;
  if (typeof expiresAt !== 'string') return false;
  if (typeof principal !== 'object' || principal === null) return false;
  const { id, name, role } = principal as Record<string, unknown>;
  return (
    typeof id === 'string' && typeof name === 'string' && typeof role === 'string' && ROLES.includes(role)
  );
}
