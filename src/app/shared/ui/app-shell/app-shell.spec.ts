import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  TranslateLoader,
  provideTranslateLoader,
  provideTranslateService,
  type TranslationObject,
} from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { SessionStore } from '../../../core/auth/session-store';
import { BN_CATALOGUE } from '../../../core/i18n/bn-catalogue';
import type { Principal } from '../../../generated/models/principal';
import { AppShell } from './app-shell';

class BanglaCatalogueLoader extends TranslateLoader {
  override getTranslation(): Observable<TranslationObject> {
    return of(BN_CATALOGUE as TranslationObject);
  }
}

/** A token whose payload claims the role — the shell must read the claim, never the URL. */
function tokenFor(role: Principal['role']): string {
  const payload = btoa(JSON.stringify({ sub: 'u', role, exp: 9_999_999_999 }));
  return `header.${payload}.signature`;
}

function principal(role: Principal['role'], name: string): Principal {
  return { id: '01800000-0000-7000-8000-000000000201', name, role };
}

describe('AppShell (WEB-FR-001, WEB-UX-040, WEB-UX-046, WEB-FR-402)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppShell],
      providers: [
        provideRouter([]),
        provideTranslateService({
          lang: 'bn',
          fallbackLang: 'bn',
          loader: provideTranslateLoader(BanglaCatalogueLoader),
        }),
      ],
    }).compileComponents();
  });

  async function render() {
    const fixture = TestBed.createComponent(AppShell);
    await fixture.whenStable();
    return { fixture, host: fixture.nativeElement as HTMLElement };
  }

  it('puts a skip link first and a matching main landmark (WEB-UX-040)', async () => {
    const { host } = await render();
    const skip = host.querySelector('a[href="#main"]');
    expect(skip).not.toBeNull();
    expect(skip?.classList.contains('sr-only-focusable')).toBe(true);
    expect(host.querySelector('main#main')).not.toBeNull();
  });

  it('renders exactly one ARIA live region for the whole application (WEB-UX-046)', async () => {
    const { host } = await render();
    expect(host.querySelectorAll('[aria-live]').length).toBe(1);
  });

  it('renders the offline banner host and the toast host on every route', async () => {
    const { host } = await render();
    expect(host.querySelector('foshol-offline-banner')).not.toBeNull();
    expect(host.querySelector('foshol-toast-host')).not.toBeNull();
  });

  it('uses the warm farmer chrome for a FARMER session', async () => {
    TestBed.inject(SessionStore).signIn(
      tokenFor('FARMER'),
      principal('FARMER', 'Demo Farmer'),
      new Date(),
    );
    const { host } = await render();
    expect(host.querySelector('header')?.className).toContain('bg-surface-0');
  });

  it('uses the slate console chrome for an OFFICER session, read from the role not the URL', async () => {
    TestBed.inject(SessionStore).signIn(
      tokenFor('OFFICER'),
      principal('OFFICER', 'Demo Officer'),
      new Date(),
    );
    const { host } = await render();
    expect(host.querySelector('header')?.className).toContain('bg-slate-800');
  });
});
