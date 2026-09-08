import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { APP_CONFIG } from '../../../core/config/app-config';
import { provideI18n } from '../../../core/i18n/i18n.providers';
import { BN_CATALOGUE } from '../../../core/i18n/bn-catalogue';
import adminFragment from '../../../../i18n/admin.i18n.json';
import { ApiConfiguration } from '../../../generated/api-configuration';
import { AdminService } from '../../../generated/services/admin.service';
import { ReviewService } from '../../../generated/services/review.service';
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

/**
 * One page of `/review/queue` as the running server returns it for an ADMIN token. The SLA
 * timestamps are deliberately decades away from any clock this suite could run under, so the
 * banding is a property of the fixture rather than of the day the tests are run.
 */
const QUEUE_BODY = {
  page: 0,
  size: APP_CONFIG.admin.sampleSize,
  totalElements: 40,
  totalPages: 2,
  content: [
    {
      caseId: 'c-1',
      reviewTaskId: 't-1',
      state: 'PENDING',
      analysisMode: 'REPLAY',
      decisionPath: 'UNDETERMINED',
      topConfidence: null,
      submittedAt: '2026-09-07T18:40:00Z',
      slaDueAt: '2000-01-01T00:00:00Z',
    },
    {
      caseId: 'c-2',
      reviewTaskId: 't-2',
      state: 'PENDING',
      analysisMode: 'REPLAY',
      decisionPath: 'PRIMARY',
      topConfidence: 0.91,
      submittedAt: '2026-09-07T20:22:00Z',
      slaDueAt: '2099-01-01T00:00:00Z',
    },
    {
      caseId: 'c-3',
      reviewTaskId: 't-3',
      state: 'CLAIMED',
      analysisMode: 'LIVE',
      decisionPath: 'SECONDARY',
      topConfidence: 0.6,
      submittedAt: '2026-09-08T05:07:00Z',
      slaDueAt: '2099-01-01T00:00:00Z',
    },
    {
      caseId: 'c-4',
      reviewTaskId: 't-4',
      state: 'DONE',
      analysisMode: 'REPLAY',
      decisionPath: 'PRIMARY',
      topConfidence: 0.91,
      submittedAt: '2026-09-08T09:57:00Z',
      slaDueAt: '2099-01-01T00:00:00Z',
    },
  ],
};

const EMPTY_QUEUE = { page: 0, size: APP_CONFIG.admin.sampleSize, totalElements: 0, totalPages: 0, content: [] };

const STATS_URL = `${APP_CONFIG.api.origin}${AdminService.GetAdminStatsPath}`;
const QUEUE_URL = `${APP_CONFIG.api.origin}${ReviewService.GetReviewQueuePath}`;

interface Answer {
  readonly body: object;
  readonly options?: { status: number; statusText: string };
}

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
    /**
     * `public/i18n/*.json` is a committed BUILD ARTEFACT of the `src/i18n/*.i18n.json`
     * fragments, so a spec reading only the artefact goes red on every string added before the
     * next `i18n:build`. The owning fragment is merged in on top of it here.
     */
    TestBed.inject(TranslateService).setTranslation(
      APP_CONFIG.i18n.defaultLocale,
      Object.fromEntries(Object.entries(adminFragment).map(([key, value]) => [key, value.bn])),
      true,
    );
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

  function all(selector: string): HTMLElement[] {
    return [...el().querySelectorAll<HTMLElement>(selector)];
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

  /**
   * The page now reads TWO endpoints, and both are fired together — so nothing here can use
   * `expectOne`. Every open request is walked and answered by URL, which also means an
   * unexpected request fails loudly rather than being handed the wrong body.
   */
  async function answer(stats: Answer, queue: Answer): Promise<void> {
    const pending = http.match(() => true);
    expect(pending.length).toBeGreaterThan(0);
    for (const request of pending) {
      expect(request.request.method).toBe('GET');
      const answerFor =
        request.request.url === STATS_URL
          ? stats
          : request.request.url === QUEUE_URL
            ? queue
            : null;
      expect(answerFor).not.toBeNull();
      if (answerFor?.options) request.flush(answerFor.body, answerFor.options);
      else request.flush(answerFor?.body ?? {});
    }
    await settle();
  }

  /** Answers the two requests the page makes on creation. */
  async function load(body: object = LIVE_BODY, queue: object = QUEUE_BODY): Promise<void> {
    await answer({ body }, { body: queue });
  }

  /** Presses the manual refresh control and answers the requests it makes. */
  async function refreshWith(stats: Answer, queue: Answer = { body: QUEUE_BODY }): Promise<void> {
    el().querySelector<HTMLButtonElement>('[data-testid="refresh"]')!.click();
    await settle();
    await answer(stats, queue);
  }

  it('fetches the stats through the generated client on arrival', async () => {
    await load();

    expect(text('[data-testid="stat-grid"] foshol-stat-tile [data-testid="stat-value"]')).toBe('12');
  });

  it('displays all four figures (WEB-FR-301)', async () => {
    await load();

    const values = all('[data-testid="stat-value"]').map((v) => v.textContent?.trim());
    // Cases today, approval rate, median review time, model–officer agreement rate.
    expect(values).toEqual(['12', '50%', '3.5 মিনিট', '75%']);
    // The sample size always travels with the agreement rate.
    expect(text('[data-testid="stat-caption"]')).toContain('4');
  });

  it('reads the live body as MINUTES, not as the contract seconds field (D-06)', async () => {
    await load({ ...LIVE_BODY, medianReviewMinutes: 2 });

    expect(all('[data-testid="stat-value"]').map((v) => v.textContent?.trim())).toContain(
      '2 মিনিট',
    );
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

  it('names all three routing bands in text, once, page-wide (WEB-FR-302, WEB-UX-044)', async () => {
    await load();

    const bands = all('foshol-decision-path-badge').map((b) => b.getAttribute('data-path'));
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

    // Every request the page can provoke is a read — and each is answered by its own URL,
    // never by whichever body happened to be to hand.
    await answer({ body: LIVE_BODY }, { body: QUEUE_BODY });
  });

  it('renders "not enough data yet" rather than zero for a null rate', async () => {
    await load(EMPTY_BODY);

    const empties = all('[data-testid="stat-no-data"]');
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

    await refreshWith({ body: { ...LIVE_BODY, casesToday: 13 } });

    expect(text('[data-testid="stat-value"]')).toBe('13');
  });

  it('keeps the last values under a stale marker when a refresh fails (WEB-FR-305)', async () => {
    await load();

    // The live failure mode today: /admin/stats 500s once any rate is non-null.
    await refreshWith({
      body: { status: 500, error: 'Internal Server Error' },
      options: { status: 500, statusText: 'x' },
    });

    expect(el().querySelector('[data-testid="stale-marker"]')).not.toBeNull();
    expect(el().querySelector('foshol-error-panel [role="alert"]')).not.toBeNull();
    // The page is not blanked: the last good values are still there, and marked.
    expect(text('[data-testid="stat-value"]')).toBe('12');
    expect(text('[data-testid="threshold-low"]')).toBe('45%');
    expect(el().querySelector('[data-testid="stat-grid"]')?.getAttribute('data-stale')).toBe(
      'true',
    );
    expect(all('[data-testid="tile-stale-marker"]').length).toBe(4);
  });

  it('shows the failure alone when nothing has ever loaded', async () => {
    await answer(
      { body: { status: 500 }, options: { status: 500, statusText: 'x' } },
      { body: { status: 500 }, options: { status: 500, statusText: 'x' } },
    );

    expect(el().querySelector('foshol-error-panel [role="alert"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="stat-grid"]')).toBeNull();
    // Nothing was loaded, so nothing is claimed to be stale either.
    expect(el().querySelector('[data-testid="stale-marker"]')).toBeNull();
    expect(el().querySelector('[data-testid="queue-unavailable"]')).not.toBeNull();
  });

  describe('the queue-derived widgets', () => {
    it('draws all four from ONE page of /review/queue', async () => {
      await load();

      // W1 — a bar per occupied bin, a rug tick per scored case, three bands.
      expect(all('[data-testid="cl-bar"]').length).toBe(2);
      expect(all('[data-testid="cl-tick"]').length).toBe(3);
      expect(all('[data-testid="cl-band-count"]').length).toBe(3);
      // One row carries no confidence, and is counted as text rather than drawn as a zero bar.
      expect(el().querySelector('[data-testid="cl-unscored"]')).not.toBeNull();

      // W2 — four timestamps across a non-zero window is enough for a line.
      expect(el().querySelector('[data-testid="sc-line"]')).not.toBeNull();
      expect(all('[data-testid="sc-dot"]').length).toBe(APP_CONFIG.admin.cadenceBuckets);
      expect(text('[data-testid="sc-window"]')).toContain('(Dhaka)');

      // W3 — banded once, against a stated "now", with no timer anywhere.
      expect(all('[data-testid="sla-band"]').length).toBe(4);
      expect(all('[data-testid="sla-count"]').map((c) => c.textContent?.trim())).toEqual([
        '1',
        '0',
        '3',
        '0',
      ]);
      expect(text('[data-testid="sla-as-of"]')).toContain('(Dhaka)');

      // W4 — every state and both modes, zeroes included, and no decision-path badge here.
      expect(all('[data-testid="qc-state"]').length).toBe(4);
      expect(all('[data-testid="qc-mode"]').length).toBe(2);
      expect(all('foshol-analysis-mode-badge').length).toBe(2);
    });

    it('states the size of the sample, never presenting a page as a census', async () => {
      await load();

      // 4 rows loaded out of 40 — both numbers on screen, on both widgets that use them.
      expect(text('[data-testid="cl-caption"]')).toContain('40');
      expect(text('[data-testid="cl-caption"]')).toContain('4');
      expect(text('[data-testid="sc-caption"]')).toContain('40');
    });

    it('draws no cadence line at all from a queue too small to support one', async () => {
      await load(LIVE_BODY, { ...QUEUE_BODY, content: QUEUE_BODY.content.slice(0, 1) });

      expect(el().querySelector('[data-testid="sc-line"]')).toBeNull();
      expect(el().querySelector('[data-testid="sc-no-line"]')).not.toBeNull();
    });

    it('says the page is empty rather than drawing a flat histogram of nothing', async () => {
      await load(LIVE_BODY, EMPTY_QUEUE);

      expect(el().querySelector('[data-testid="cl-no-rows"]')).not.toBeNull();
      expect(el().querySelector('[data-testid="sla-empty"]')).not.toBeNull();
      expect(el().querySelector('[data-testid="qc-empty"]')).not.toBeNull();
    });

    /** Two stores, two failure domains — this is the whole reason `QueueSampleStore` exists. */
    it('keeps the four statistics when only the queue fails', async () => {
      await answer(
        { body: LIVE_BODY },
        { body: { status: 500 }, options: { status: 500, statusText: 'x' } },
      );

      expect(all('[data-testid="stat-value"]').length).toBe(4);
      expect(text('[data-testid="threshold-low"]')).toBe('45%');
      expect(el().querySelector('[data-testid="queue-unavailable"]')).not.toBeNull();
      // The bands still stand: they come from the thresholds, which came from /admin/stats.
      expect(el().querySelector('[data-testid="cl-unavailable"]')).not.toBeNull();
      expect(all('[data-testid="cl-band"]').length).toBe(3);
    });

    it('keeps the queue widgets when only the stats fail', async () => {
      await answer(
        { body: { status: 500 }, options: { status: 500, statusText: 'x' } },
        { body: QUEUE_BODY },
      );

      expect(el().querySelector('[data-testid="stat-grid"]')).toBeNull();
      expect(el().querySelector('[data-testid="thresholds-unavailable"]')).not.toBeNull();
      expect(all('[data-testid="sla-band"]').length).toBe(4);
      expect(all('[data-testid="qc-state"]').length).toBe(4);
    });
  });
});
