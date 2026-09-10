import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../../../generated/services/auth.service';
import { ApiConfiguration } from '../../../generated/api-configuration';
import { APP_CONFIG } from '../../../core/config/app-config';
import { provideI18n } from '../../../core/i18n/i18n.providers';
import { FarmerLoginPage } from './farmer-login-page';

const PHONE = '+8801711111111';
const UNREGISTERED = '+8801799999999';
const CODE = '123456';
const REQUEST_URL = `${APP_CONFIG.api.origin}${AuthService.RequestOtpPath}`;
const VERIFY_URL = `${APP_CONFIG.api.origin}${AuthService.VerifyOtpPath}`;

/** The identity module's own wording, hardcoded in English and never language-negotiated. */
const SERVER_DETAIL = 'Farmer was not found.';

describe('FarmerLoginPage (WEB-FR-010, WEB-SEC-002, WEB-SEC-006)', () => {
  let fixture: ComponentFixture<FarmerLoginPage>;
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
    fixture = TestBed.createComponent(FarmerLoginPage);
    await fixture.whenStable();
  });

  afterEach(() => {
    http.verify();
  });

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  async function reachCodeStep(): Promise<void> {
    const phone = el().querySelector<HTMLInputElement>('#phone');
    phone!.value = PHONE;
    phone!.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    el().querySelector<HTMLButtonElement>('button[type="submit"]')!.click();

    const request = http.expectOne(
      `${APP_CONFIG.api.origin}${AuthService.RequestOtpPath}`,
    );
    // WEB-SEC-002 — the phone number travels in the body; the URL carries nothing.
    expect(request.request.url).not.toContain(PHONE);
    expect(request.request.body).toEqual({ phone: PHONE });

    request.flush('{"expiresInSeconds":300,"otpDeliveryMode":"DEV_FIXED"}', {
      status: 202,
      statusText: 'Accepted',
    });
    await fixture.whenStable();
  }

  it('starts on the phone step', () => {
    expect(el().querySelector('#phone')).not.toBeNull();
    expect(el().querySelectorAll('.otp-box').length).toBe(0);
  });

  it('offers one labelled box per OTP digit after a challenge is issued', async () => {
    await reachCodeStep();

    const boxes = el().querySelectorAll<HTMLInputElement>('.otp-box');
    expect(boxes.length).toBe(APP_CONFIG.auth.otpLength);
    // WEB-UX-046 — one labelled group, and every box says which position it is.
    expect(el().querySelector('fieldset legend')?.textContent?.trim().length).toBeGreaterThan(0);
    for (const box of boxes) {
      expect(box.getAttribute('aria-label')?.length).toBeGreaterThan(0);
      expect(box.getAttribute('aria-describedby')).toContain('code-hint');
    }
  });

  it('spreads a pasted code across the boxes and submits it in the body only', async () => {
    await reachCodeStep();

    const boxes = el().querySelectorAll<HTMLInputElement>('.otp-box');
    const paste = new Event('paste') as ClipboardEvent;
    Object.defineProperty(paste, 'clipboardData', { value: { getData: () => CODE } });
    boxes[0]!.dispatchEvent(paste);
    await fixture.whenStable();

    expect([...boxes].map((box) => box.value).join('')).toBe(CODE);

    const verify = http.expectOne(`${APP_CONFIG.api.origin}${AuthService.VerifyOtpPath}`);
    // WEB-SEC-002 / WEB-SEC-006 — the code is in the body, never in the URL.
    expect(verify.request.url).not.toContain(CODE);
    expect(verify.request.body).toEqual({ phone: PHONE, code: CODE });

    verify.flush({ code: 'ERR_INVALID_OTP', correlationId: 'c-1', status: 401, title: 'x' }, {
      status: 401,
      statusText: 'Unauthorized',
    });
    // The paste handler fires the verification without awaiting it, so let the rejection
    // settle before asserting what the boxes now hold.
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();

    // WEB-SEC-006 — a rejected code is cleared rather than left on screen.
    const after = el().querySelectorAll<HTMLInputElement>('.otp-box');
    expect([...after].map((box) => box.value).join('')).toBe('');
  });

  /**
   * The 404 rewording is scoped to the request step's own code. A verify `401` — the wrong or
   * expired code — must keep the OTP-error path it always had, or the fix for one confusing
   * message would have created another.
   */
  it('keeps the server’s own wording for a verify 401, not the not-registered copy', async () => {
    await reachCodeStep();

    const boxes = el().querySelectorAll<HTMLInputElement>('.otp-box');
    const paste = new Event('paste') as ClipboardEvent;
    Object.defineProperty(paste, 'clipboardData', { value: { getData: () => CODE } });
    boxes[0]!.dispatchEvent(paste);
    await fixture.whenStable();

    http.expectOne(`${APP_CONFIG.api.origin}${AuthService.VerifyOtpPath}`).flush(
      {
        title: 'Unauthorized',
        status: 401,
        detail: 'That code is not valid.',
        code: 'ERR_OTP_INVALID',
        correlationId: 'c-2',
      },
      { status: 401, statusText: 'Unauthorized' },
    );
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();

    const notice = el().querySelector('[role="alert"]');
    expect(notice!.textContent).toContain('That code is not valid.');
    expect(notice!.textContent).not.toContain('এই নম্বরটি নিবন্ধিত নয়');
  });

  it('walks backwards over an empty box on Backspace', async () => {
    await reachCodeStep();

    const boxes = el().querySelectorAll<HTMLInputElement>('.otp-box');
    boxes[0]!.value = '7';
    boxes[0]!.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(boxes[0]!.value).toBe('7');

    boxes[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }));
    await fixture.whenStable();
    expect(boxes[0]!.value).toBe('');
  });
});

/**
 * `IDENTITY-FR-001` — `POST /auth/otp/request` answers `404 ERR_FARMER_NOT_FOUND` for a number
 * that is not a registered farmer, and the OTP step must never open for it.
 *
 * This whole path was previously untested: the contract used to answer `202` either way, so there
 * was no failure to assert. It is now the behaviour a farmer meets first when they mistype.
 */
describe('FarmerLoginPage — an unregistered number (IDENTITY-FR-001, WEB-FR-010)', () => {
  let fixture: ComponentFixture<FarmerLoginPage>;
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
    fixture = TestBed.createComponent(FarmerLoginPage);
    await fixture.whenStable();
  });

  afterEach(() => {
    http.verify();
  });

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function submitButton(): HTMLButtonElement {
    return el().querySelector<HTMLButtonElement>('button[type="submit"]')!;
  }

  async function requestFor(phone: string): Promise<ReturnType<HttpTestingController['expectOne']>> {
    const input = el().querySelector<HTMLInputElement>('#phone')!;
    input.value = phone;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    submitButton().click();
    return http.expectOne(REQUEST_URL);
  }

  function flushNotFound(request: ReturnType<HttpTestingController['expectOne']>): void {
    request.flush(
      {
        type: 'https://foshol.local/problems/err-farmer-not-found',
        title: 'Not Found',
        status: 404,
        detail: SERVER_DETAIL,
        code: 'ERR_FARMER_NOT_FOUND',
        correlationId: '01a07caa-d705-7ad0-a51b-f334668c9fab',
      },
      { status: 404, statusText: 'Not Found' },
    );
  }

  it('stays on the phone step and never opens the OTP boxes', async () => {
    flushNotFound(await requestFor(UNREGISTERED));
    await fixture.whenStable();

    expect(el().querySelector('#phone')).not.toBeNull();
    expect(el().querySelectorAll('.otp-box').length).toBe(0);
    // No challenge exists, so nothing may be verified — the old bug was reaching this call at all.
    http.expectNone(VERIFY_URL);
  });

  it('explains it in Bangla rather than echoing the server’s English detail', async () => {
    flushNotFound(await requestFor(UNREGISTERED));
    await fixture.whenStable();

    const notice = el().querySelector('[role="alert"]');
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toContain('এই নম্বরটি নিবন্ধিত নয়');
    expect(notice!.textContent).not.toContain(SERVER_DETAIL);
  });

  it('never echoes the submitted number back (WEB-SEC-006)', async () => {
    const request = await requestFor(UNREGISTERED);
    expect(request.request.url).not.toContain(UNREGISTERED);
    flushNotFound(request);
    await fixture.whenStable();

    expect(el().querySelector('[role="alert"]')!.textContent).not.toContain(UNREGISTERED);
  });

  it('keeps the correlation id copyable (WEB-FR-005)', async () => {
    flushNotFound(await requestFor(UNREGISTERED));
    await fixture.whenStable();

    expect(el().querySelector('[role="alert"]')!.textContent).toContain(
      '01a07caa-d705-7ad0-a51b-f334668c9fab',
    );
  });

  it('leaves submit enabled so the number can be corrected, and then advances on a 202', async () => {
    flushNotFound(await requestFor(UNREGISTERED));
    await fixture.whenStable();
    expect(submitButton().disabled).toBe(false);

    const retry = await requestFor(PHONE);
    expect(retry.request.body).toEqual({ phone: PHONE });
    retry.flush('{"expiresInSeconds":300,"otpDeliveryMode":"DEV_FIXED"}', {
      status: 202,
      statusText: 'Accepted',
    });
    await fixture.whenStable();

    expect(el().querySelectorAll('.otp-box').length).toBe(APP_CONFIG.auth.otpLength);
  });

  it('keeps a 400 on the phone step too, with the server’s own detail', async () => {
    (await requestFor(UNREGISTERED)).flush(
      { title: 'Bad Request', status: 400, detail: 'That number is not valid.', code: 'ERR_PHONE_INVALID' },
      { status: 400, statusText: 'Bad Request' },
    );
    await fixture.whenStable();

    expect(el().querySelectorAll('.otp-box').length).toBe(0);
    // Only ERR_FARMER_NOT_FOUND is re-worded; every other code keeps the server's wording.
    expect(el().querySelector('[role="alert"]')!.textContent).toContain('That number is not valid.');
  });

  it('keeps a 429 on the phone step and disables the request while the wait runs (WEB-FR-011)', async () => {
    (await requestFor(UNREGISTERED)).flush(
      { title: 'Too Many Requests', status: 429, code: 'ERR_OTP_RATE_LIMITED' },
      { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '600' } },
    );
    await fixture.whenStable();

    expect(el().querySelectorAll('.otp-box').length).toBe(0);
    expect(submitButton().disabled).toBe(true);
  });
});
