import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { APP_CONFIG } from '../../../core/config/app-config';
import { provideI18n } from '../../../core/i18n/i18n.providers';
import { BN_CATALOGUE } from '../../../core/i18n/bn-catalogue';
import { ApiConfiguration } from '../../../generated/api-configuration';
import { AdminService } from '../../../generated/services/admin.service';
import { AdminStatsPage } from './admin-stats-page';

/** The body the running server actually sends (LIVE-API-NOTES.md Divergence 2). */
const LIVE_BODY = {
  casesToday: 12,
  approvalRate: 0.5,
  medianReviewMinutes: 3.5,
  agreementRate: 0.75,
  agreementSampleSize: 4,
  confidenceHigh: 0.75,
  confidenceLow: 0.45,
};

const EMPTY_BODY = {
  casesToday: 0,
  approvalRate: null,
  medianReviewMinutes: null,
  agreementRate: null,
  agreementSampleSize: 0,
  confidenceHigh: 0.75,
  confidenceLow: 0.45,
};

const STATS_URL = `${APP_CONFIG.api.origin}${AdminService.GetAdminStatsPath}`;

describe('AdminStatsPage (WEB-FR-300…305)', () => {
  let fixture: ComponentFixture<AdminStatsPage>;
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
    fixture = TestBed.createComponent(AdminStatsPage);
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

  /**
   * The store `await`s the generated client's promise, so a response has to travel out of the
   * HTTP layer and back through the task queue before the signals it sets reach the DOM. One
   * turn of the event loop, then one change-detection pass.
   */
  async function settle(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  }

  /** Answers the request the page makes on creation. */
  async function load(body: object = LIVE_BODY): Promise<void> {
    http.expectOne({ method: 'GET', url: STATS_URL }).flush(body);
    await settle();
  }

  /** Presses the manual refresh control and answers the request it makes. */
  async function refreshWith(
    body: object,
    options?: { status: number; statusText: string },
  ): Promise<void> {
    el().querySelector<HTMLButtonElement>('[data-testid="refresh"]')!.click();
    await settle();
    const request = http.expectOne({ method: 'GET', url: STATS_URL });
    if (options) request.flush(body, options);
    else request.flush(body);
    await settle();
  }

  it('fetches the stats through the generated client on arrival', async () => {
    await load();

    expect(text('[data-testid="stat-grid"] foshol-stat-tile [data-testid="stat-value"]')).toBe('12');
  });

  it('displays all four figures (WEB-FR-301)', async () => {
    await load();

    const values = [...el().querySelectorAll('[data-testid="stat-value"]')].map((v) =>
      v.textContent?.trim(),
    );
    // Cases today, approval rate, median review time, model–officer agreement rate.
    expect(values).toEqual(['12', '50%', '3.5 মিনিট', '75%']);
    // The sample size always travels with the agreement rate.
    expect(text('[data-testid="stat-caption"]')).toContain('4');
  });

  it('reads the live body as MINUTES, not as the contract seconds field (D-06)', async () => {
    await load({ ...LIVE_BODY, medianReviewMinutes: 2 });

    expect(
      [...el().querySelectorAll('[data-testid="stat-value"]')].map((v) => v.textContent?.trim()),
    ).toContain('2 মিনিট');
  });

  it('displays both routing thresholds as read-only values (WEB-FR-302, AC-24)', async () => {
    await load();

    expect(text('[data-testid="threshold-low"]')).toBe('45%');
    expect(text('[data-testid="threshold-high"]')).toBe('75%');
    // Labelled as the routing thresholds, not as bare numbers.
    expect(el().textContent).toContain(BN_CATALOGUE['admin.stats.thresholds.title']);
    expect(el().textContent).toContain(BN_CATALOGUE['admin.stats.thresholds.low']);
    expect(el().textContent).toContain(BN_CATALOGUE['admin.stats.thresholds.high']);
    // Read-only is stated on screen, not merely implied by the absence of a control.
    expect(text('[data-testid="read-only-chip"]')).toBe(BN_CATALOGUE['admin.stats.readOnly']);
  });

  it('names all three routing bands in text (WEB-FR-302, WEB-UX-044)', async () => {
    await load();

    const bands = [...el().querySelectorAll('foshol-decision-path-badge')].map((b) =>
      b.getAttribute('data-path'),
    );
    expect(bands).toEqual(['UNDETERMINED', 'SECONDARY', 'PRIMARY']);
  });

  it('contains no control that writes to the server (WEB-FR-303, AC-24)', async () => {
    await load();

    // Nothing that could carry a payload exists on the page at all.
    expect(el().querySelector('form')).toBeNull();
    expect(el().querySelector('input')).toBeNull();
    expect(el().querySelector('textarea')).toBeNull();
    expect(el().querySelector('select')).toBeNull();

    for (const button of el().querySelectorAll('button')) {
      expect(button.getAttribute('type')).toBe('button');
      button.click();
    }
    await fixture.whenStable();

    // Every request the page can provoke is a read.
    for (const request of http.match(() => true)) {
      expect(request.request.method).toBe('GET');
      request.flush(LIVE_BODY);
    }
  });

  it('renders "not enough data yet" rather than zero for a null rate', async () => {
    await load(EMPTY_BODY);

    const empties = el().querySelectorAll('[data-testid="stat-no-data"]');
    // Approval rate, median review time and agreement rate are all null before there is data.
    expect(empties.length).toBe(3);
    expect(empties[0]?.textContent?.trim()).toBe(BN_CATALOGUE['admin.stats.noData']);
    // A measured count of zero IS a fact, and is still shown as a number.
    expect(text('[data-testid="stat-value"]')).toBe('0');
    // …but no rate is ever reported as 0%, which would claim a measurement nobody made.
    expect(text('[data-testid="stat-grid"]')).not.toContain('0%');
    // No published advisories means the agreement rate rests on nothing, and says so.
    expect(text('[data-testid="stat-caption"]')).toBe(
      BN_CATALOGUE['admin.stats.agreement.noSample'],
    );
  });

  it('shows the timestamp of the data and refreshes on demand (WEB-FR-304)', async () => {
    await load();

    expect(text('[data-testid="loaded-at"]')).toContain('(Dhaka)');

    await refreshWith({ ...LIVE_BODY, casesToday: 13 });

    expect(text('[data-testid="stat-value"]')).toBe('13');
  });

  it('keeps the last values under a stale marker when a refresh fails (WEB-FR-305)', async () => {
    await load();

    // The live failure mode today: /admin/stats 500s once any rate is non-null.
    await refreshWith(
      { status: 500, error: 'Internal Server Error' },
      { status: 500, statusText: 'x' },
    );

    expect(el().querySelector('[data-testid="stale-marker"]')).not.toBeNull();
    expect(el().querySelector('foshol-error-panel [role="alert"]')).not.toBeNull();
    // The page is not blanked: the last good values are still there, and marked.
    expect(text('[data-testid="stat-value"]')).toBe('12');
    expect(text('[data-testid="threshold-low"]')).toBe('45%');
    expect(el().querySelector('[data-testid="stat-grid"]')?.getAttribute('data-stale')).toBe(
      'true',
    );
    expect(el().querySelectorAll('[data-testid="tile-stale-marker"]').length).toBe(4);
  });

  it('shows the failure alone when nothing has ever loaded', async () => {
    http
      .expectOne({ method: 'GET', url: STATS_URL })
      .flush({ status: 500 }, { status: 500, statusText: 'x' });
    await fixture.whenStable();

    expect(el().querySelector('foshol-error-panel [role="alert"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="stat-grid"]')).toBeNull();
    // Nothing was loaded, so nothing is claimed to be stale either.
    expect(el().querySelector('[data-testid="stale-marker"]')).toBeNull();
  });
});
