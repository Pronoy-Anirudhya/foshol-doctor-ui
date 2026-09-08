import { provideHttpClient, type HttpRequest } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { APP_CONFIG } from '../../../core/config/app-config';
import { provideI18n } from '../../../core/i18n/i18n.providers';
import { SseDispatcher } from '../../../core/sse/sse-dispatcher';
import { SSE_EVENT } from '../../../core/sse/sse-events';
import { ApiConfiguration } from '../../../generated/api-configuration';
import { CasesService } from '../../../generated/services/cases.service';
import historyPageJson from '../../../../testing/fixtures/case-history-page.json';
import { CaseHistoryPage } from './case-history-page';

const LIST_URL = `${APP_CONFIG.api.origin}${CasesService.ListMyCasesPath}`;
const PRESIGNED = { url: 'http://127.0.0.1:9000/x', expiresAt: '2026-09-07T18:00:00Z' };

const SETTLE_ATTEMPTS = 25;
const SETTLE_TURNS = 3;

type FlushBody = Parameters<TestRequest['flush']>[0];

describe('CaseHistoryPage (WEB-FR-153)', () => {
  let fixture: ComponentFixture<CaseHistoryPage>;
  let http: HttpTestingController;

  async function settle(): Promise<void> {
    for (let turn = 0; turn < SETTLE_TURNS; turn += 1) {
      fixture.detectChanges();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    fixture.detectChanges();
  }

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

    fixture = TestBed.createComponent(CaseHistoryPage);
    await respond((request) => request.url === LIST_URL, historyPageJson);
    await drainMedia();
  });

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function rows(): HTMLElement[] {
    return Array.from(el().querySelectorAll<HTMLElement>('[data-testid="case-history-row"]'));
  }

  it('renders one row per case, in the order the server returned them', () => {
    expect(rows().length).toBe(historyPageJson.content.length);
    const linked = rows().map((row) => row.getAttribute('href'));
    for (const [index, row] of historyPageJson.content.entries()) {
      expect(linked[index]).toContain(row.caseId);
    }
  });

  it('shows crop, status and submitted time on every row', () => {
    const first = rows()[0]!;
    expect(first.textContent).toContain(historyPageJson.content[0]!.cropNameBn);
    expect(first.getAttribute('data-status')).toBe(historyPageJson.content[0]!.status);
    expect(first.querySelector('time')?.getAttribute('datetime')).toBe(
      historyPageJson.content[0]!.submittedAt,
    );
  });

  it('renders a thumbnail only where the row carries one (WEB-FR-153)', () => {
    expect(rows()[0]!.querySelector('foshol-secure-image')).not.toBeNull();
    expect(rows()[1]!.querySelector('foshol-secure-image')).toBeNull();
  });

  it('binds the paginator to the envelope the server sent (WEB-API-003)', () => {
    expect(el().querySelector('foshol-paginator')?.textContent).toContain(
      String(historyPageJson.totalElements),
    );
  });

  it('filters the loaded rows by crop or disease name, client-side', async () => {
    const searchInput = el().querySelector<HTMLInputElement>('[data-testid="case-search-input"]')!;
    searchInput.value = historyPageJson.content[0]!.diseaseNameBn!;
    searchInput.dispatchEvent(new Event('input'));
    // Activating a filter widens the fetch to the server's max page size.
    await respond((request) => request.url === LIST_URL, historyPageJson);

    expect(rows().length).toBe(1);
    expect(rows()[0]!.getAttribute('href')).toContain(historyPageJson.content[0]!.caseId);
  });

  it('filters the loaded rows by status', async () => {
    const select = el().querySelector<HTMLSelectElement>('[data-testid="case-status-filter"]')!;
    select.value = 'REJECTED';
    select.dispatchEvent(new Event('change'));
    await respond((request) => request.url === LIST_URL, historyPageJson);

    expect(rows().length).toBe(1);
    expect(rows()[0]!.getAttribute('data-status')).toBe('REJECTED');
  });

  it('shows a distinct empty state when a search matches nothing', async () => {
    const searchInput = el().querySelector<HTMLInputElement>('[data-testid="case-search-input"]')!;
    searchInput.value = 'no such crop or disease exists';
    searchInput.dispatchEvent(new Event('input'));
    await respond((request) => request.url === LIST_URL, historyPageJson);

    expect(rows().length).toBe(0);
    expect(el().querySelector('foshol-empty-state')).not.toBeNull();
  });

  it('patches a row from an SSE frame without asking the server again', async () => {
    const target = historyPageJson.content[2]!;
    expect(rows()[2]!.getAttribute('data-status')).toBe(target.status);

    TestBed.inject(SseDispatcher).dispatch(
      SSE_EVENT.caseStatus,
      JSON.stringify({ caseId: target.caseId, fromStatus: target.status, toStatus: 'ADVISED' }),
    );
    await settle();

    expect(rows()[2]!.getAttribute('data-status')).toBe('ADVISED');
    // WEB-FR-353 / WEB-FR-356 — the patch cost nothing on the wire.
    http.verify();
  });
});
