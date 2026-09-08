import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ApiConfiguration } from '../../../generated/api-configuration';
import { AuthService } from '../../../generated/services/auth.service';
import { APP_CONFIG } from '../../../core/config/app-config';
import { provideI18n } from '../../../core/i18n/i18n.providers';
import { OfficerLoginPage } from './officer-login-page';

describe('OfficerLoginPage (WEB-FR-012)', () => {
  let fixture: ComponentFixture<OfficerLoginPage>;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideI18n(),
        { provide: ApiConfiguration, useValue: { rootUrl: APP_CONFIG.api.origin } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(OfficerLoginPage);
    await fixture.whenStable();
  });

  afterEach(() => {
    http.verify();
  });

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  it('collects a username and a password', () => {
    expect(el().querySelector('#username')).not.toBeNull();
    expect(el().querySelector('#password')).not.toBeNull();
  });

  it('refuses to call the API until both fields are filled', async () => {
    el().querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await fixture.whenStable();

    http.expectNone(`${APP_CONFIG.api.origin}${AuthService.OfficerLoginPath}`);
    expect(el().querySelector('#username-error')).not.toBeNull();
    expect(el().querySelector('#password-error')).not.toBeNull();
  });

  it('hides the seeded-credential card in production (APP_CONFIG.demo.showLoginHints is false)', () => {
    expect(el().querySelector('foshol-demo-hint')).toBeNull();
  });

  describe('with the hackathon-demo affordance enabled', () => {
    const demoFlag = APP_CONFIG.demo as { showLoginHints: boolean };

    beforeEach(async () => {
      demoFlag.showLoginHints = true;
      fixture = TestBed.createComponent(OfficerLoginPage);
      await fixture.whenStable();
    });

    afterEach(() => {
      demoFlag.showLoginHints = false;
    });

    it('prefills the demo officer and exchanges the credentials for a token', async () => {
      el().querySelector<HTMLButtonElement>('foshol-demo-hint .fill')!.click();
      await fixture.whenStable();

      el().querySelector<HTMLButtonElement>('button[type="submit"]')!.click();

      const request = http.expectOne(`${APP_CONFIG.api.origin}${AuthService.OfficerLoginPath}`);
      expect(request.request.body).toEqual({ username: 'officer', password: 'password' });
      // WEB-SEC-002 — no credential ever reaches a URL.
      expect(request.request.urlWithParams).toBe(request.request.url);

      request.flush({ code: 'ERR_BAD_CREDENTIALS', correlationId: 'c-2', status: 401, title: 'x' }, {
        status: 401,
        statusText: 'Unauthorized',
      });
      await fixture.whenStable();

      // WEB-FR-005 — the failure is a problem notice with a copyable correlation id.
      expect(el().querySelector('foshol-problem-notice [role="alert"]')).not.toBeNull();
      expect(el().textContent).toContain('c-2');
    });
  });
});
