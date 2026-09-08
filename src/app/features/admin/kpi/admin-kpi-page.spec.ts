import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import adminFragment from '../../../../i18n/admin.i18n.json';
import { APP_CONFIG } from '../../../core/config/app-config';
import { provideI18n } from '../../../core/i18n/i18n.providers';
import { ApiConfiguration } from '../../../generated/api-configuration';
import { AdminKpiPage } from './admin-kpi-page';

const KPI_URL = `${APP_CONFIG.api.origin}/api/v1/admin/kpis`;

const BODY = {
  assignmentFailures: 5,
  resolutionFailures: 7,
  officers: [
    { officerId: 'o-1', officerName: 'Amina Khatun', resolutionFailures: 4 },
    { officerId: 'o-2', officerName: 'Babul Mia', resolutionFailures: 2 },
  ],
};

/** Both counted zeros. Legitimate, and NOT the same as "no data" (see the assertions). */
const ZERO_BODY = { assignmentFailures: 0, resolutionFailures: 0, officers: [] };

describe('AdminKpiPage', () => {
  let fixture: ComponentFixture<AdminKpiPage>;
  let http: HttpTestingController;

  beforeEach(() => {
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
    // The committed public/i18n artefact lags the fragment; merge the owning fragment on top.
    TestBed.inject(TranslateService).setTranslation(
      APP_CONFIG.i18n.defaultLocale,
      Object.fromEntries(Object.entries(adminFragment).map(([key, value]) => [key, value.bn])),
      true,
    );
    fixture = TestBed.createComponent(AdminKpiPage);
  });

  afterEach(() => {
    http.verify();
  });

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(selector: string): string {
    return el().querySelector(selector)?.textContent?.trim() ?? '';
  }

  function all(selector: string): HTMLElement[] {
    return [...el().querySelectorAll<HTMLElement>(selector)];
  }

  async function settle(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function answer(body: object, options?: { status: number; statusText: string }) {
    const request = http.expectOne(KPI_URL);
    expect(request.request.method).toBe('GET');
    if (options) request.flush(body, options);
    else request.flush(body);
    await settle();
  }

  it('reads the summary with a GET and never sends a district', async () => {
    fixture.detectChanges();
    const request = http.expectOne(KPI_URL);
    expect(request.request.method).toBe('GET');
    expect(request.request.params.keys()).toEqual([]);
    request.flush(BODY);
    await settle();

    expect(el().querySelector('form')).toBeNull();
    expect(el().querySelector('input')).toBeNull();
    expect(el().querySelector('select')).toBeNull();
    for (const button of el().querySelectorAll('button')) {
      expect(button.getAttribute('type')).toBe('button');
    }
  });

  it('shows the assignment total under a district heading with no officer named beside it', async () => {
    fixture.detectChanges();
    await answer(BODY);

    const district = el().querySelector<HTMLElement>('[data-testid="district-section"]');
    expect(district).not.toBeNull();
    expect(district?.textContent).toContain('5');
    // The single most important assertion on this page: a pool failure names nobody.
    expect(district?.textContent).not.toContain('Amina Khatun');
    expect(district?.textContent).not.toContain('Babul Mia');
    expect(district?.querySelector('foshol-officer-failure-chart')).toBeNull();
    expect(text('[data-testid="district-section"] [data-testid="kpi-tile-scope"]')).toBe(
      adminFragment['admin.kpi.assignment.scope'].bn,
    );
  });

  it('names officers only for resolution failures', async () => {
    fixture.detectChanges();
    await answer(BODY);

    const rows = all('[data-testid="officer-row"]');
    expect(rows.length).toBe(2);
    expect(rows[0]?.textContent).toContain('Amina Khatun');
    expect(all('[data-testid="officer-count"]').map((c) => c.textContent?.trim())).toEqual([
      '4',
      '2',
    ]);

    // Every bar carries an accessible name AND its count as text (WEB-UX-044).
    for (const track of all('[data-testid="officer-section"] [role="img"]')) {
      expect(track.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('states the resolution failures the server attached no officer to', async () => {
    fixture.detectChanges();
    await answer({
      assignmentFailures: 0,
      resolutionFailures: 9,
      officers: [{ officerId: 'o-1', officerName: 'Amina Khatun', resolutionFailures: 4 }],
    });

    expect(text('[data-testid="officer-unattributed"]')).toContain('5');
  });

  it('prints a counted zero as a zero, never as "not enough data yet"', async () => {
    fixture.detectChanges();
    await answer(ZERO_BODY);

    expect(all('[data-testid="kpi-count"]').map((c) => c.textContent?.trim())).toEqual(['0', '0']);
    expect(el().querySelector('[data-testid="kpi-no-data"]')).toBeNull();
    expect(el().querySelector('[data-testid="all-clear"]')).not.toBeNull();
    // The tile says which kind of zero it is showing.
    expect(text('[data-testid="kpi-tile-counted"]')).toBe(adminFragment['admin.kpi.tile.counted'].bn);
    expect(text('[data-testid="officers-none"]')).toBe(adminFragment['admin.kpi.officers.none'].bn);
  });

  it('WEB-FR-305 — a 500 keeps the last good values under a stale marker', async () => {
    fixture.detectChanges();
    await answer(BODY);

    el().querySelector<HTMLButtonElement>('[data-testid="refresh"]')?.click();
    await settle();
    await answer({}, { status: 500, statusText: 'Server Error' });

    expect(el().querySelector('[data-testid="stale-marker"]')).not.toBeNull();
    expect(el().querySelector('foshol-error-panel [role="alert"]')).not.toBeNull();
    // The numbers are still on screen, and every tile says they are not current.
    expect(all('[data-testid="kpi-count"]').map((c) => c.textContent?.trim())).toEqual(['5', '7']);
    expect(all('[data-testid="kpi-tile-stale-marker"]').length).toBe(2);
    expect(el().querySelector('[data-testid="officers-stale-marker"]')).not.toBeNull();
  });

  it('a 500 with nothing loaded shows the failure and invents no figures', async () => {
    fixture.detectChanges();
    await answer({}, { status: 500, statusText: 'Server Error' });

    expect(el().querySelector('foshol-error-panel [role="alert"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="kpi-count"]')).toBeNull();
    expect(el().querySelector('[data-testid="stale-marker"]')).toBeNull();
    expect(el().querySelector('[data-testid="all-clear"]')).toBeNull();
  });

  it('shows the load timestamp in Asia/Dhaka', async () => {
    fixture.detectChanges();
    await answer(BODY);

    expect(text('[data-testid="loaded-at"]')).toContain('(Dhaka)');
  });
});
