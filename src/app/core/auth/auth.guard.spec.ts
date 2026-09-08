import { TestBed } from '@angular/core/testing';
import {
  provideRouter,
  Router,
  UrlSegment,
  UrlTree,
  type CanMatchFn,
  type Route,
} from '@angular/router';
import type { Principal } from '../../generated/models/principal';
import { AUTH_SURFACES, authGuard, homePathForRole, loginPathForUrl } from './auth.guard';
import type { Role } from './jwt';
import { SessionStore } from './session-store';

/** The router's partial snapshot argument; the guards read only `route` and `segments`. */
type MatchSnapshot = Parameters<CanMatchFn>[2];

/**
 * WEB-TEST-006 — an unauthenticated request to a guarded route must land on the RIGHT
 * surface's login and must retain the attempted URL for restoration afterwards.
 */
describe('authGuard (WEB-FR-002)', () => {
  let session: SessionStore;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    session = TestBed.inject(SessionStore);
    router = TestBed.inject(Router);
  });

  function run(url: string): boolean | string {
    const result = TestBed.runInInjectionContext(() =>
      (authGuard as CanMatchFn)({} as Route, segmentsOf(url), {} as MatchSnapshot),
    );
    return result instanceof UrlTree ? router.serializeUrl(result) : result === true;
  }

  it('sends an anonymous farmer route attempt to the farmer login', () => {
    expect(run('/farmer/cases')).toBe(AUTH_SURFACES.farmerLogin);
  });

  it('sends an anonymous officer route attempt to the console login', () => {
    expect(run('/officer/queue')).toBe(AUTH_SURFACES.officerLogin);
  });

  it('sends an anonymous admin route attempt to the console login', () => {
    expect(run('/admin')).toBe(AUTH_SURFACES.officerLogin);
  });

  it('retains the attempted URL so login can restore it', () => {
    run('/officer/tasks/abc');
    expect(session.intendedUrl()).toBe('/officer/tasks/abc');
    expect(session.takeIntendedUrl()).toBe('/officer/tasks/abc');
    // Taking it clears it: a stale intended URL must not hijack the next login.
    expect(session.intendedUrl()).toBeNull();
  });

  it('matches without redirecting once a session exists', () => {
    signInAs(session, 'FARMER');
    expect(run('/farmer/cases')).toBe(true);
    expect(session.intendedUrl()).toBeNull();
  });
});

describe('surface resolution', () => {
  it('routes each guarded group to its own login', () => {
    expect(loginPathForUrl('/farmer')).toBe(AUTH_SURFACES.farmerLogin);
    expect(loginPathForUrl('/farmer/cases/1')).toBe(AUTH_SURFACES.farmerLogin);
    expect(loginPathForUrl('/officer')).toBe(AUTH_SURFACES.officerLogin);
    expect(loginPathForUrl('/admin/stats?tab=1')).toBe(AUTH_SURFACES.officerLogin);
    expect(loginPathForUrl('/')).toBe(AUTH_SURFACES.farmerLogin);
  });

  it('sends each role to its own home', () => {
    expect(homePathForRole('FARMER')).toBe('/farmer');
    expect(homePathForRole('OFFICER')).toBe('/officer');
    expect(homePathForRole('ADMIN')).toBe('/admin');
    expect(homePathForRole(null)).toBe(AUTH_SURFACES.farmerLogin);
  });
});

function segmentsOf(url: string): UrlSegment[] {
  return url
    .replace(/^\/+/, '')
    .split('/')
    .filter((part) => part.length > 0)
    .map((part) => new UrlSegment(part, {}));
}

/** An unsigned token carrying only the `role` claim — the claim is all the client reads. */
function signInAs(session: SessionStore, role: Role): void {
  const payload = btoa(JSON.stringify({ sub: 'test-subject', role }))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
  const principal: Principal = { id: 'test-subject', name: 'Test', role };
  session.signIn(`header.${payload}.signature`, principal, new Date());
}
