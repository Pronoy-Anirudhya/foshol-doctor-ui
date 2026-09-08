import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { SessionStore } from '../../../core/auth/session-store';
import { LanguageStore } from '../../../core/i18n/language-store';
import { provideI18n } from '../../../core/i18n/i18n.providers';
import type { Principal } from '../../../generated/models/principal';
import { RegionChip } from './region-chip';

/**
 * Region is identity, so the only thing this component may ever show is what `/me` said.
 * The three behaviours worth pinning are the ones where a well-meaning edit would start
 * inventing: falling back to a code when a name is null, choosing a language, and collapsing a
 * division whose label merely repeats the district.
 */
const DHAKA: Principal = {
  id: '01800000-0000-7000-8000-000000000202',
  name: 'Demo Officer',
  role: 'OFFICER',
  districtCode: 'DHA',
  divisionCode: 'DHK',
  districtNameBn: 'ঢাকা',
  districtNameEn: 'Dhaka',
  divisionNameBn: 'ঢাকা',
  divisionNameEn: 'Dhaka',
};

function principal(overrides: Partial<Principal> = {}): Principal {
  return { ...DHAKA, ...overrides };
}

describe('RegionChip', () => {
  let fixture: ComponentFixture<RegionChip>;
  let session: SessionStore;

  function mount(value: Principal | null): HTMLElement {
    session = TestBed.inject(SessionStore);
    if (value !== null) session.signIn('token', value, new Date());
    fixture = TestBed.createComponent(RegionChip);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const text = (host: HTMLElement, id: string) =>
    host.querySelector(`[data-testid="${id}"]`)?.textContent?.trim() ?? null;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideI18n()] });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('renders nothing at all when there is no principal', () => {
    expect(mount(null).querySelector('[data-testid="region-chip"]')).toBeNull();
  });

  it('renders nothing when the principal carries no geography', () => {
    const host = mount(principal({ districtCode: undefined, divisionCode: undefined }));
    expect(host.querySelector('[data-testid="region-chip"]')).toBeNull();
  });

  it('shows the district in Bangla and carries its code for scoping checks', () => {
    const host = mount(principal());
    expect(text(host, 'region-district')).toBe('ঢাকা');
    expect(
      host.querySelector('[data-testid="region-chip"]')?.getAttribute('data-district'),
    ).toBe('DHA');
  });

  /**
   * Dhaka district sits in Dhaka division and Chattogram district in Chattogram division, so
   * both demo logins would otherwise print one word twice with a separator between them, which
   * reads as a rendering fault rather than a hierarchy.
   */
  it('omits the division when its label only repeats the district', () => {
    const host = mount(principal());
    expect(text(host, 'region-division')).toBeNull();
  });

  it('shows the division when it genuinely differs', () => {
    const host = mount(
      principal({
        districtCode: 'GAZIPUR',
        districtNameBn: 'গাজীপুর',
        districtNameEn: 'Gazipur',
      }),
    );
    expect(text(host, 'region-district')).toBe('গাজীপুর');
    expect(text(host, 'region-division')).toBe('ঢাকা');
  });

  /**
   * The contract marks every name nullable. A missing name must degrade to the code the server
   * routes on — never to a name this application made up, because it holds no district list.
   */
  it('falls back to the code when the server sent no name', () => {
    const host = mount(
      principal({
        districtCode: 'CHAPAINAWABGANJ',
        districtNameBn: null,
        districtNameEn: null,
      }),
    );
    expect(text(host, 'region-district')).toBe('CHAPAINAWABGANJ');
  });

  it('follows the language toggle, and still falls back across languages', () => {
    const host = mount(principal({ districtNameEn: 'Dhaka' }));
    TestBed.inject(LanguageStore).use('en');
    fixture.detectChanges();
    expect(text(host, 'region-district')).toBe('Dhaka');

    // English missing while Bangla is present: show the Bangla rather than the bare code.
    session.setPrincipal(principal({ districtNameEn: null }));
    fixture.detectChanges();
    expect(text(host, 'region-district')).toBe('ঢাকা');
  });
});
