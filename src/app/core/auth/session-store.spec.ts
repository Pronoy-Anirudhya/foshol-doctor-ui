import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import type { Principal } from '../../generated/models/principal';
import type { Role } from './jwt';
import { SessionStore } from './session-store';

const SESSION_KEY = 'foshol.session';
const MS_PER_SECOND = 1_000;
const HOUR_SECONDS = 3_600;

const PRINCIPAL: Principal = {
  id: 'u-1',
  name: 'Test Officer',
  role: 'OFFICER',
  districtCode: 'D-01',
  divisionCode: 'V-01',
  districtNameEn: 'Bogura',
};

const nowSeconds = (): number => Math.floor(Date.now() / MS_PER_SECOND);

/** An unsigned token carrying `sub`, `role` and `exp` — the claims the client reads. */
function tokenFor(role: Role, expSeconds: number): string {
  const payload = btoa(JSON.stringify({ sub: 'u-1', role, exp: expSeconds }))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
  return `header.${payload}.signature`;
}

/** A fresh injector, as a reload would give: the old SessionStore goes with the old page. */
function reload(): SessionStore {
  TestBed.resetTestingModule();
  const store = TestBed.inject(SessionStore);
  store.restore();
  return store;
}

function store(value: unknown): void {
  sessionStorage.setItem(SESSION_KEY, typeof value === 'string' ? value : JSON.stringify(value));
}

describe('SessionStore persistence (WEB-SEC-001 as amended by D-37)', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('mirrors a sign-in into sessionStorage, and clear() removes it', () => {
    const session = TestBed.inject(SessionStore);
    session.signIn(tokenFor('OFFICER', nowSeconds() + HOUR_SECONDS), PRINCIPAL, new Date());
    expect(sessionStorage.getItem(SESSION_KEY)).not.toBeNull();

    session.clear();
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('never writes the session to localStorage', () => {
    const session = TestBed.inject(SessionStore);
    session.signIn(tokenFor('OFFICER', nowSeconds() + HOUR_SECONDS), PRINCIPAL, new Date());
    for (let i = 0; i < localStorage.length; i++) {
      expect(localStorage.getItem(localStorage.key(i) ?? '')).not.toContain('header.');
    }
  });

  it('restores the same session after a reload', () => {
    const exp = nowSeconds() + HOUR_SECONDS;
    const token = tokenFor('OFFICER', exp);
    TestBed.inject(SessionStore).signIn(token, PRINCIPAL, new Date(exp * MS_PER_SECOND));

    const restored = reload();
    expect(restored.isAuthenticated()).toBe(true);
    expect(restored.bearerToken()).toBe(token);
    expect(restored.role()).toBe('OFFICER');
    expect(restored.displayName()).toBe('Test Officer');
    expect(restored.region()?.districtCode).toBe('D-01');
    expect(restored.expiresAt()?.getTime()).toBe(exp * MS_PER_SECOND);
  });

  it('keeps a principal refreshed from /me across the reload', () => {
    const session = TestBed.inject(SessionStore);
    session.signIn(tokenFor('OFFICER', nowSeconds() + HOUR_SECONDS), PRINCIPAL, new Date());
    session.setPrincipal({ ...PRINCIPAL, name: 'Renamed Officer' });

    expect(reload().displayName()).toBe('Renamed Officer');
  });

  it('does not restore a token past its exp, and forgets it', () => {
    // The stored expiry says an hour from now; the JWT `exp` is authoritative and says it is over.
    store({
      token: tokenFor('OFFICER', nowSeconds() - 60),
      principal: PRINCIPAL,
      expiresAt: new Date(Date.now() + HOUR_SECONDS * MS_PER_SECOND).toISOString(),
    });

    const restored = reload();
    expect(restored.isAuthenticated()).toBe(false);
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('ignores and forgets an entry that is not JSON', () => {
    store('{not json');
    expect(reload().isAuthenticated()).toBe(false);
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('ignores an entry of the wrong shape', () => {
    const expiresAt = new Date(Date.now() + HOUR_SECONDS * MS_PER_SECOND).toISOString();
    const token = tokenFor('OFFICER', nowSeconds() + HOUR_SECONDS);
    for (const bad of [
      { token: 'not-a-jwt', principal: PRINCIPAL, expiresAt },
      { token, principal: { ...PRINCIPAL, role: 'ROOT' }, expiresAt },
      { token, principal: null, expiresAt },
      { token, principal: PRINCIPAL },
    ]) {
      store(bad);
      expect(reload().isAuthenticated()).toBe(false);
    }
  });

  it('lets the JWT role claim overrule an edited stored principal', () => {
    store({
      token: tokenFor('OFFICER', nowSeconds() + HOUR_SECONDS),
      principal: { ...PRINCIPAL, role: 'ADMIN' },
      expiresAt: new Date(Date.now() + HOUR_SECONDS * MS_PER_SECOND).toISOString(),
    });
    expect(reload().role()).toBe('OFFICER');
  });

  it('stays signed out when nothing was stored', () => {
    expect(reload().isAuthenticated()).toBe(false);
  });

  it('stays signed out, without throwing, when storage itself throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(() => reload()).not.toThrow();
    expect(TestBed.inject(SessionStore).isAuthenticated()).toBe(false);
  });
});
