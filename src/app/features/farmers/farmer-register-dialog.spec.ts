import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import farmersFragment from '../../../i18n/farmers.i18n.json';
import { SessionStore } from '../../core/auth/session-store';
import { APP_CONFIG } from '../../core/config/app-config';
import { provideI18n } from '../../core/i18n/i18n.providers';
import { ApiConfiguration } from '../../generated/api-configuration';
import type { Principal } from '../../generated/models/principal';
import { FarmerDirectoryStore } from './farmer-directory-store';
import { FarmerRegisterDialog } from './farmer-register-dialog';

const FARMERS_URL = `${APP_CONFIG.api.origin}/api/v1/farmers`;

const PRINCIPAL: Principal = {
  id: 'o-1',
  name: 'Amina Khatun',
  role: 'OFFICER',
  divisionCode: '30',
  districtCode: '3026',
  divisionNameBn: 'ঢাকা',
  divisionNameEn: 'Dhaka',
  districtNameBn: 'গাজীপুর',
  districtNameEn: 'Gazipur',
  preferredLanguage: 'bn',
  username: 'officer',
};

const CREATED = {
  id: 'f-1',
  name: 'রহিম উদ্দিন',
  divisionCode: '30',
  districtCode: '3026',
  divisionNameBn: 'ঢাকা',
  divisionNameEn: 'Dhaka',
  districtNameBn: 'গাজীপুর',
  districtNameEn: 'Gazipur',
  preferredLanguage: 'bn',
  createdAt: '2026-09-07T10:00:00Z',
  registeredByOfficerId: 'o-1',
  registeredByName: 'Amina Khatun',
  source: 'MANUAL',
};

const PHONE = '01712345678';

describe('FarmerRegisterDialog', () => {
  let fixture: ComponentFixture<FarmerRegisterDialog>;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideI18n(),
        FarmerDirectoryStore,
        { provide: ApiConfiguration, useValue: { rootUrl: APP_CONFIG.api.origin } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(TranslateService).setTranslation(
      APP_CONFIG.i18n.defaultLocale,
      Object.fromEntries(Object.entries(farmersFragment).map(([key, value]) => [key, value.bn])),
      true,
    );
    TestBed.inject(SessionStore).signIn('token', PRINCIPAL, new Date());

    fixture = TestBed.createComponent(FarmerRegisterDialog);
    fixture.componentRef.setInput('open', true);
  });

  afterEach(() => {
    http.verify();
  });

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function field(testid: string): HTMLInputElement {
    return el().querySelector<HTMLInputElement>(`[data-testid="${testid}"]`)!;
  }

  async function settle(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function typeInto(testid: string, value: string): void {
    const input = field(testid);
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  async function fillAndSubmit(): Promise<void> {
    typeInto('register-phone', PHONE);
    typeInto('register-name', 'রহিম উদ্দিন');
    fixture.detectChanges();
    el().querySelector<HTMLElement>('[data-testid="register-submit"]')!.click();
    await settle();
  }

  it('sends an Idempotency-Key on the register POST (WEB-API-004)', async () => {
    await settle();
    await fillAndSubmit();

    const request = http.expectOne(FARMERS_URL);
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('Idempotency-Key')).toBeTruthy();
    request.flush(CREATED, { status: 201, statusText: 'Created' });
    await settle();
  });

  it('reuses the SAME key when a failed attempt is retried — a retry is not a second farmer', async () => {
    await settle();
    await fillAndSubmit();

    const first = http.expectOne(FARMERS_URL);
    const key = first.request.headers.get('Idempotency-Key');
    first.flush({ title: 'Service unavailable' }, { status: 503, statusText: 'Unavailable' });
    await settle();

    el().querySelector<HTMLElement>('[data-testid="register-submit"]')!.click();
    await settle();

    const second = http.expectOne(FARMERS_URL);
    expect(second.request.headers.get('Idempotency-Key')).toBe(key);
    second.flush(CREATED, { status: 201, statusText: 'Created' });
    await settle();
  });

  it('mints a NEW key once the officer edits the form after a failure', async () => {
    await settle();
    await fillAndSubmit();

    const first = http.expectOne(FARMERS_URL);
    const key = first.request.headers.get('Idempotency-Key');
    first.flush({ title: 'nope' }, { status: 503, statusText: 'Unavailable' });
    await settle();

    typeInto('register-phone', '01812345678');
    fixture.detectChanges();
    el().querySelector<HTMLElement>('[data-testid="register-submit"]')!.click();
    await settle();

    const second = http.expectOne(FARMERS_URL);
    expect(second.request.headers.get('Idempotency-Key')).not.toBe(key);
    second.flush(CREATED, { status: 201, statusText: 'Created' });
    await settle();
  });

  it('submits the principal’s own division and district (WEB-FR-314)', async () => {
    await settle();
    await fillAndSubmit();

    const request = http.expectOne(FARMERS_URL);
    expect(request.request.body).toMatchObject({
      divisionCode: PRINCIPAL.divisionCode,
      districtCode: PRINCIPAL.districtCode,
      preferredLanguage: 'bn',
    });
    request.flush(CREATED, { status: 201, statusText: 'Created' });
    await settle();
  });

  it('renders division and district as controls the officer cannot edit', async () => {
    await settle();
    expect(field('register-division').disabled).toBe(true);
    expect(field('register-district').disabled).toBe(true);
    expect(field('register-district').value).toBe('গাজীপুর');
  });

  it('sends the phone as typed — normalising it would re-implement a server rule', async () => {
    await settle();
    await fillAndSubmit();

    const request = http.expectOne(FARMERS_URL);
    expect(request.request.body.phone).toBe(PHONE);
    request.flush(CREATED, { status: 201, statusText: 'Created' });
    await settle();
  });

  it('clears the phone control the moment the registration succeeds (WEB-SEC-002)', async () => {
    await settle();
    await fillAndSubmit();
    http.expectOne(FARMERS_URL).flush(CREATED, { status: 201, statusText: 'Created' });
    await settle();

    // The confirmation replaces the form, and nothing on it repeats the number.
    const confirmation = el().querySelector('[data-testid="register-confirmation"]');
    expect(confirmation).not.toBeNull();
    expect(el().textContent ?? '').not.toContain(PHONE);
  });

  it('treats an Idempotency-Replayed response as a success, not a failure', async () => {
    await settle();
    await fillAndSubmit();

    http.expectOne(FARMERS_URL).flush(CREATED, {
      status: 201,
      statusText: 'Created',
      headers: { 'Idempotency-Replayed': 'true' },
    });
    await settle();

    expect(el().querySelector('[data-testid="register-confirmation"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="register-replayed"]')).not.toBeNull();
  });

  it('reports a duplicate as "already registered" without naming another district', async () => {
    await settle();
    await fillAndSubmit();

    http.expectOne(FARMERS_URL).flush(
      {
        title: 'Conflict',
        detail: 'Farmer already registered in Rangpur district',
        code: 'ERR_FARMER_PHONE_EXISTS',
        status: 409,
        correlationId: 'corr-1',
      },
      { status: 409, statusText: 'Conflict' },
    );
    await settle();

    const error = el().querySelector('[data-testid="register-error"]');
    expect(error?.textContent).toContain(farmersFragment['farmers.error.phoneExists'].bn);
    // The server's own detail names a district; the UI must not repeat it (WEB-FR-312).
    expect(el().textContent ?? '').not.toContain('Rangpur');
  });

  it('refuses to submit an invalid phone number before any request is made', async () => {
    await settle();
    typeInto('register-phone', '12345');
    typeInto('register-name', 'রহিম উদ্দিন');
    fixture.detectChanges();
    el().querySelector<HTMLElement>('[data-testid="register-submit"]')!.click();
    await settle();

    expect(el().querySelector('[data-testid="register-phone-error"]')).not.toBeNull();
    http.expectNone(FARMERS_URL);
  });
});
