import { provideHttpClient, type HttpRequest } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { APP_CONFIG } from '../../../core/config/app-config';
import { provideI18n } from '../../../core/i18n/i18n.providers';
import { ApiConfiguration } from '../../../generated/api-configuration';
import type { Advisory } from '../../../generated/models/advisory';
import type { Disease } from '../../../generated/models/disease';
import { KnowledgeService } from '../../../generated/services/knowledge.service';
import { ReviewService } from '../../../generated/services/review.service';
import advisoryV1Json from '../../../../testing/fixtures/advisory-v1.json';
import advisoryV2Json from '../../../../testing/fixtures/advisory-v2-revised.json';
import { AdvisoryCard } from './advisory-card';

const ADVISORY_V1 = advisoryV1Json as unknown as Advisory;
const ADVISORY_V2 = advisoryV2Json as unknown as Advisory;

const DISEASE: Disease = {
  id: ADVISORY_V1.diseaseId ?? '',
  cropId: '01800000-0000-7000-8000-000000000001',
  code: '[code]',
  nameBn: '[nameBn]',
  healthy: false,
  severity: 'HIGH',
};

const DISEASE_URL = `${APP_CONFIG.api.origin}${KnowledgeService.GetDiseasePath.replace(
  '{diseaseId}',
  ADVISORY_V1.diseaseId ?? '',
)}`;

const HISTORY_URL = `${APP_CONFIG.api.origin}${ReviewService.GetAdvisoryHistoryPath.replace(
  '{caseId}',
  ADVISORY_V2.caseId,
)}`;

const SETTLE_ATTEMPTS = 25;

/** Exactly what `TestRequest.flush` accepts, taken from the type rather than restated. */
type FlushBody = Parameters<TestRequest['flush']>[0];

describe('AdvisoryCard (WEB-FR-155…158, AC-22)', () => {
  let fixture: ComponentFixture<AdvisoryCard>;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideI18n(),
        { provide: ApiConfiguration, useValue: { rootUrl: APP_CONFIG.api.origin } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  /**
   * A `resource()` issues its request from an effect, so the request does not exist at the
   * moment the component is created and `whenStable()` would block on the pending load. This
   * turns the wheel until the request appears, answers it, then turns it again.
   */
  async function respond(
    match: (request: HttpRequest<unknown>) => boolean,
    body: FlushBody,
  ): Promise<void> {
    for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt += 1) {
      fixture.detectChanges();
      const requests = http.match(match);
      if (requests.length > 0) {
        for (const request of requests) request.flush(body);
        await fixture.whenStable();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error('no matching request was issued');
  }

  async function render(advisory: Advisory): Promise<void> {
    fixture = TestBed.createComponent(AdvisoryCard);
    fixture.componentRef.setInput('advisory', advisory);
    // The severity lives on Disease, not on Advisory, so the card reads it rather than
    // inferring one (WEB-NFR-001).
    await respond((request) => request.url === DISEASE_URL, DISEASE);
  }

  function texts(selector: string): string[] {
    return Array.from(el().querySelectorAll(selector)).map((node) =>
      (node.textContent ?? '').trim(),
    );
  }

  it('names the officer inside a visible verified stamp (WEB-FR-155, AC-22)', async () => {
    await render(ADVISORY_V1);

    expect(el().querySelector('[data-testid="verified-stamp"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="verified-officer-name"]')?.textContent?.trim()).toBe(
      ADVISORY_V1.officerName,
    );
    // WEB-DATA-006 — the published time is shown, in Asia/Dhaka.
    expect(el().querySelector('time')?.getAttribute('datetime')).toBe(ADVISORY_V1.publishedAt);
  });

  it('renders the disease name and its severity with text, not only colour', async () => {
    await render(ADVISORY_V1);

    expect(el().querySelector('[data-testid="advisory-disease"]')?.textContent?.trim()).toBe(
      ADVISORY_V1.diseaseNameBn,
    );
    const badge = el().querySelector('[data-testid="severity-badge"]');
    expect(badge?.getAttribute('data-severity')).toBe(DISEASE.severity);
    expect(badge?.querySelector('.sv-text')?.textContent?.trim().length).toBeGreaterThan(0);
  });

  it('renders every step as a numbered list item, in the order received (WEB-FR-156)', async () => {
    await render(ADVISORY_V1);

    expect(texts('[data-testid="advisory-steps"] li')).toEqual([
      ...ADVISORY_V1.remedies[0]!.stepsBn,
    ]);
    expect(el().querySelector('[data-testid="advisory-steps"]')?.tagName).toBe('OL');
  });

  it('draws one pictogram per remedy, keyed by its type', async () => {
    await render(ADVISORY_V2);

    const remedies = el().querySelectorAll('[data-testid="advisory-remedy"]');
    expect(remedies.length).toBe(ADVISORY_V2.remedies.length);
    for (const remedy of remedies) {
      expect(remedy.querySelector('foshol-remedy-type-icon svg')).not.toBeNull();
    }
  });

  it('shows phiDays as a labelled field, and omits the row where there is none (WEB-FR-157)', async () => {
    await render(ADVISORY_V2);

    const phi = el().querySelectorAll('[data-testid="advisory-phi"]');
    // Only the CHEMICAL remedy in the fixture carries one.
    expect(phi.length).toBe(1);
    expect(phi[0]?.querySelector('dt')?.textContent?.trim().length).toBeGreaterThan(0);
    expect(phi[0]?.querySelector('dd')?.textContent).toContain(
      String(ADVISORY_V2.remedies[1]!.phiDays),
    );
  });

  it('authors nothing for a null field — v1 carries no dosage and no interval', async () => {
    await render(ADVISORY_V1);

    expect(el().querySelectorAll('[data-testid="advisory-phi"]').length).toBe(0);
    expect(el().textContent).not.toContain('null');
  });

  it('marks a revised advisory and offers the prior version (WEB-FR-158)', async () => {
    await render(ADVISORY_V2);

    const marker = el().querySelector('[data-testid="advisory-revised"]');
    expect(marker).not.toBeNull();
    expect(marker?.textContent).toContain(String(ADVISORY_V2.version));

    const toggle = el().querySelector<HTMLButtonElement>('[data-testid="advisory-history-toggle"]');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');

    toggle!.click();
    await respond((request) => request.url === HISTORY_URL, [ADVISORY_V2, ADVISORY_V1]);

    const prior = el().querySelectorAll('[data-testid="advisory-prior-version"]');
    expect(prior.length).toBe(1);
    expect(prior[0]?.textContent).toContain(ADVISORY_V1.officerName);
    expect(prior[0]?.textContent).toContain(ADVISORY_V1.remedies[0]!.stepsBn[0]!);
  });

  it('does not fetch the history until the farmer asks for it', async () => {
    await render(ADVISORY_V2);
    // afterEach's verify() is the assertion: nothing outstanding means nothing was requested.
    expect(el().querySelector('[data-testid="advisory-prior-version"]')).toBeNull();
  });
});
