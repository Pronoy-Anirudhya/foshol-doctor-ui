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
import { AppHeader } from './app-header';

class BanglaCatalogueLoader extends TranslateLoader {
  override getTranslation(): Observable<TranslationObject> {
    return of(BN_CATALOGUE as TranslationObject);
  }
}

/** A token whose payload claims the role — the header must read the claim, never the URL. */
function tokenFor(role: Principal['role']): string {
  const payload = btoa(JSON.stringify({ sub: 'u', role, exp: 9_999_999_999 }));
  return `header.${payload}.signature`;
}

/**
 * WEB-FR-001 — who is offered a notification bell.
 *
 * Farmers and officers are notified; admins are not. That is a product rule about the AUDIENCE,
 * so it is decided by the role on the JWT and not by which surface the browser happens to be on:
 * an admin is allowed onto `/officer/**`, and must still find no bell there. The SSE indicator
 * is a separate control on purpose — connection health is everyone's business.
 */
describe('AppHeader (WEB-FR-001, WEB-FR-354)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppHeader],
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

  afterEach(() => TestBed.resetTestingModule());

  async function render(role: Principal['role'] | null) {
    const fixture = TestBed.createComponent(AppHeader);
    if (role !== null) {
      TestBed.inject(SessionStore).signIn(
        tokenFor(role),
        { id: '01800000-0000-7000-8000-000000000201', name: 'Demo', role },
        new Date(),
      );
    }
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    return {
      bell: host.querySelector('foshol-notification-bell'),
      indicator: host.querySelector('foshol-sse-indicator'),
    };
  }

  it('offers a farmer the bell', async () => {
    const { bell, indicator } = await render('FARMER');
    expect(bell).not.toBeNull();
    expect(indicator).not.toBeNull();
  });

  it('offers an officer the bell', async () => {
    const { bell, indicator } = await render('OFFICER');
    expect(bell).not.toBeNull();
    expect(indicator).not.toBeNull();
  });

  it('offers an admin no bell, but keeps the connection indicator', async () => {
    const { bell, indicator } = await render('ADMIN');
    expect(bell).toBeNull();
    // A control that would sit empty is worse than no control; the stream's health is not.
    expect(indicator).not.toBeNull();
  });

  it('offers neither before sign-in', async () => {
    const { bell, indicator } = await render(null);
    expect(bell).toBeNull();
    expect(indicator).toBeNull();
  });
});
