import { provideHttpClient, type HttpRequest } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { APP_CONFIG } from '../../../core/config/app-config';
import { provideI18n } from '../../../core/i18n/i18n.providers';
import { SseDispatcher } from '../../../core/sse/sse-dispatcher';
import { SSE_EVENT } from '../../../core/sse/sse-events';
import { CaseDraftStore } from '../../../core/stores/case-draft-store';
import { ApiConfiguration } from '../../../generated/api-configuration';
import type { CaseDetail } from '../../../generated/models/case-detail';
import type { CaseStatus } from '../../../generated/models/case-status';
import { CasesService } from '../../../generated/services/cases.service';
import { ReviewService } from '../../../generated/services/review.service';
import advisoryV1Json from '../../../../testing/fixtures/advisory-v1.json';
import caseDetailJson from '../../../../testing/fixtures/case-detail-primary.json';
import historyPageJson from '../../../../testing/fixtures/case-history-page.json';
import { FARMER_PATHS } from '../capture/farmer-paths';
import { CaseStatusPage } from './case-status-page';

const BASE_DETAIL = caseDetailJson as unknown as CaseDetail;
/** The rejected row in the history fixture, so the panel has a real message to quote. */
const REJECTED_ROW = historyPageJson.content[1]!;

const LIST_URL = `${APP_CONFIG.api.origin}${CasesService.ListMyCasesPath}`;
const PRESIGNED = { url: 'http://127.0.0.1:9000/x', expiresAt: '2026-09-07T18:00:00Z' };
const DISEASE = {
  id: '01800000-0000-7000-8000-000000000103',
  cropId: BASE_DETAIL.cropId,
  code: '[code]',
  nameBn: '[nameBn]',
  healthy: false,
  severity: 'HIGH',
};

const SETTLE_ATTEMPTS = 25;
const SETTLE_TURNS = 3;

type FlushBody = Parameters<TestRequest['flush']>[0];

function caseUrl(caseId: string): string {
  return `${APP_CONFIG.api.origin}${CasesService.GetCasePath.replace('{caseId}', caseId)}`;
}

function advisoryUrl(caseId: string): string {
  return `${APP_CONFIG.api.origin}${ReviewService.GetCaseAdvisoryPath.replace('{caseId}', caseId)}`;
}

describe('CaseStatusPage (WEB-FR-151…160, AC-21, AC-23)', () => {
  let fixture: ComponentFixture<CaseStatusPage>;
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
  });

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  /** Turn the wheel a few times so effects, resources and their promises all land. */
  async function settle(): Promise<void> {
    for (let turn = 0; turn < SETTLE_TURNS; turn += 1) {
      fixture.detectChanges();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    fixture.detectChanges();
  }

  /**
   * A `resource()` issues its request from an effect, so the request does not exist yet at the
   * moment the component is created. This waits for it, answers it, then settles.
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
        await settle();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error('no matching request was issued');
  }

  /** Presigned-URL lookups for the photographs are not what any of these tests are about. */
  async function drainMedia(): Promise<void> {
    for (let turn = 0; turn < SETTLE_TURNS; turn += 1) {
      fixture.detectChanges();
      for (const request of http.match((r) => r.url.includes('/images/'))) {
        request.flush(PRESIGNED);
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    fixture.detectChanges();
  }

  async function render(detail: CaseDetail): Promise<void> {
    fixture = TestBed.createComponent(CaseStatusPage);
    fixture.componentRef.setInput('caseId', detail.caseId);
    await respond((request) => request.url === caseUrl(detail.caseId), detail);
    await drainMedia();
  }

  function stepStates(): (string | null)[] {
    return Array.from(el().querySelectorAll('[data-testid="ss-step"]')).map((step) =>
      step.getAttribute('data-state'),
    );
  }

  it('shows the crop, the submitted photographs and the note as sent', async () => {
    await render(BASE_DETAIL);
    http.verify();

    expect(el().textContent).toContain(BASE_DETAIL.cropNameBn);
    expect(el().textContent).toContain(BASE_DETAIL.noteBn);
    expect(el().querySelectorAll('foshol-secure-image').length).toBe(BASE_DETAIL.images.length);
  });

  it('advances the stepper from an SSE frame with no additional request (AC-21)', async () => {
    await render(BASE_DETAIL);
    // Nothing is outstanding here, so any request the frame provokes would be caught by the
    // verify() below — which is the whole assertion (WEB-FR-353, WEB-FR-356).
    http.verify();
    expect(stepStates()).toEqual(['done', 'current', 'upcoming', 'upcoming', 'upcoming']);

    const nextStatus: CaseStatus = 'IN_REVIEW';
    TestBed.inject(SseDispatcher).dispatch(
      SSE_EVENT.caseStatus,
      JSON.stringify({ caseId: BASE_DETAIL.caseId, fromStatus: 'ANALYSED', toStatus: nextStatus }),
    );
    await settle();

    expect(stepStates()).toEqual(['done', 'done', 'done', 'current', 'upcoming']);
    // The wait is the product working, and it says so rather than apologising.
    expect(el().querySelector('[data-testid="review-wait"]')).not.toBeNull();
    http.verify();
  });

  it('loads and shows the advisory when the case reaches ADVISED (WEB-FR-155)', async () => {
    await render({ ...BASE_DETAIL, status: 'ADVISED' });

    await respond((request) => request.url === advisoryUrl(BASE_DETAIL.caseId), advisoryV1Json);
    await respond((request) => request.url.includes('/diseases/'), DISEASE);

    expect(el().querySelector('[data-testid="advisory-card"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="verified-officer-name"]')?.textContent?.trim()).toBe(
      advisoryV1Json.officerName,
    );
    http.verify();
  });

  it('shows the officer rejection and opens a draft carrying parentCaseId (AC-23)', async () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    await render({ ...BASE_DETAIL, caseId: REJECTED_ROW.caseId, status: 'REJECTED' });
    // Handover §7.7 — the farmer-visible rejection message rides on the history row.
    await respond((request) => request.url === LIST_URL, historyPageJson);

    expect(el().querySelector('[data-testid="rejection-message"]')?.textContent?.trim()).toBe(
      REJECTED_ROW.rejectionMessageBn,
    );

    el().querySelector<HTMLButtonElement>('[data-testid="rejection-new-case"]')!.click();
    await settle();

    const draft = TestBed.inject(CaseDraftStore);
    expect(draft.parentCaseId()).toBe(REJECTED_ROW.caseId);
    expect(draft.cropId()).toBe(BASE_DETAIL.cropId);
    expect(navigate).toHaveBeenCalledWith(FARMER_PATHS.newCase);
    http.verify();
  });

  it('re-reads the case when an advisory frame marks it dirty (WEB-FR-354)', async () => {
    await render(BASE_DETAIL);
    http.verify();

    TestBed.inject(SseDispatcher).dispatch(
      SSE_EVENT.advisory,
      JSON.stringify({
        caseId: BASE_DETAIL.caseId,
        type: 'ADVISORY_PUBLISHED',
        titleBn: null,
        bodyBn: null,
      }),
    );

    await respond((request) => request.url === caseUrl(BASE_DETAIL.caseId), {
      ...BASE_DETAIL,
      status: 'ADVISED',
    });
    await respond((request) => request.url === advisoryUrl(BASE_DETAIL.caseId), advisoryV1Json);
    await respond((request) => request.url.includes('/diseases/'), DISEASE);
    await drainMedia();

    expect(el().querySelector('[data-testid="advisory-card"]')).not.toBeNull();
    http.verify();
  });
});
