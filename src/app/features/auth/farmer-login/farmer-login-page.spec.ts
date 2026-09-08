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
const CODE = '123456';

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
