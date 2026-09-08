import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlTree, type CanMatchFn, type Route } from '@angular/router';
import type { Principal } from '../../generated/models/principal';
import { AUTH_SURFACES } from './auth.guard';
import type { Role } from './jwt';
import { roleGuard } from './role.guard';
import { SessionStore } from './session-store';

/** The route groups of WEB-FR-001, with the roles each one admits. */
const GROUPS = [
  { path: '/farmer', allowed: ['FARMER'] as const },
  { path: '/officer', allowed: ['OFFICER', 'ADMIN'] as const },
  { path: '/admin', allowed: ['ADMIN'] as const },
];

const ROLES: readonly Role[] = ['FARMER', 'OFFICER', 'ADMIN'];

/**
 * WEB-TEST-006 — "each role resolves correctly against each route group". Every one of the
 * nine role × group pairs is asserted, plus the anonymous row, because a guard that is right
 * for the two roles someone thought about is the one that lets an admin-only page through.
 */
describe('roleGuard (WEB-FR-001, WEB-FR-003)', () => {
  let session: SessionStore;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    session = TestBed.inject(SessionStore);
    router = TestBed.inject(Router);
  });

  function run(allowed: readonly Role[]): boolean | string {
    const guard = roleGuard(allowed);
    const result = TestBed.runInInjectionContext(() =>
      (guard as CanMatchFn)({} as Route, [], {} as Parameters<CanMatchFn>[2]),
    );
    return result instanceof UrlTree ? router.serializeUrl(result) : result === true;
  }

  for (const group of GROUPS) {
    for (const role of ROLES) {
      const permitted = (group.allowed as readonly Role[]).includes(role);

      it(`${permitted ? 'admits' : 'refuses'} ${role} on ${group.path}`, () => {
        signInAs(session, role);
        expect(run(group.allowed)).toBe(permitted ? true : AUTH_SURFACES.notPermitted);
      });
    }

    it(`refuses an anonymous visitor on ${group.path}`, () => {
      expect(run(group.allowed)).toBe(AUTH_SURFACES.notPermitted);
    });
  }

  it('reads the role from the JWT claim, not from the login response', () => {
    // Handover §2: the claim is authoritative. A principal body claiming FARMER alongside an
    // OFFICER token must not open the farmer group.
    signInAs(session, 'OFFICER', 'FARMER');
    expect(session.role()).toBe('OFFICER');
    expect(run(['FARMER'])).toBe(AUTH_SURFACES.notPermitted);
    expect(run(['OFFICER', 'ADMIN'])).toBe(true);
  });
});

/** An unsigned token carrying only the `role` claim — the claim is all the client reads. */
function signInAs(session: SessionStore, claimRole: Role, bodyRole: Role = claimRole): void {
  const payload = btoa(JSON.stringify({ sub: 'test-subject', role: claimRole }))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
  const principal: Principal = { id: 'test-subject', name: 'Test', role: bodyRole };
  session.signIn(`header.${payload}.signature`, principal, new Date());
}
