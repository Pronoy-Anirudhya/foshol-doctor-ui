import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import adminFragment from '../../../../i18n/admin.i18n.json';
import { APP_CONFIG } from '../../../core/config/app-config';
import { provideI18n } from '../../../core/i18n/i18n.providers';
import { ApiConfiguration } from '../../../generated/api-configuration';
import { KpiBreachesPage } from './kpi-breaches-page';

const BREACHES_URL = `${APP_CONFIG.api.origin}/api/v1/admin/kpis/breaches`;

const ASSIGNMENT_ROW = {
  id: 'b-1',
  reviewTaskId: 't-1',
  caseId: 'c-1',
  kind: 'ASSIGNMENT',
  // Null BY DESIGN: nobody had claimed the case (this is the whole point of the page).
  officerId: null,
  officerName: null,
  farmerName: 'Karim Sheikh',
  cropCode: 'RICE',
  cropNameBn: 'ধান',
  dueAt: '2026-09-07T10:00:00Z',
  breachedAt: '2026-09-07T11:00:00Z',
};

const RESOLUTION_ROW = {
  id: 'b-2',
  reviewTaskId: 't-2',
  caseId: 'c-2',
  kind: 'RESOLUTION',
  officerId: 'o-1',
  officerName: 'Amina Khatun',
  farmerName: 'Jamal Uddin',
  cropCode: 'JUTE',
  cropNameBn: 'পাট',
  dueAt: '2026-09-07T12:00:00Z',
  breachedAt: '2026-09-07T13:30:00Z',
};

const BODY = {
  page: 0,
  size: APP_CONFIG.page.defaultSize,
  totalElements: 2,
  totalPages: 1,
  content: [ASSIGNMENT_ROW, RESOLUTION_ROW],
};

const EMPTY_BODY = {
  page: 0,
  size: APP_CONFIG.page.defaultSize,
  totalElements: 0,
  totalPages: 0,
  content: [],
};

describe('KpiBreachesPage', () => {
  let fixture: ComponentFixture<KpiBreachesPage>;
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
    TestBed.inject(TranslateService).setTranslation(
      APP_CONFIG.i18n.defaultLocale,
      Object.fromEntries(Object.entries(adminFragment).map(([key, value]) => [key, value.bn])),
      true,
    );
    fixture = TestBed.createComponent(KpiBreachesPage);
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

  /** Answers every open request with the same body; returns the last one for its parameters. */
  async function answer(
    body: object,
    options?: { status: number; statusText: string },
  ): Promise<TestRequest> {
    const pending = http.match(() => true);
    expect(pending.length).toBeGreaterThan(0);
    for (const request of pending) {
      expect(request.request.method).toBe('GET');
      expect(request.request.url).toBe(BREACHES_URL);
      if (options) request.flush(body, options);
      else request.flush(body);
    }
    await settle();
    return pending[pending.length - 1] as TestRequest;
  }

  it('asks for one page and never sends a district', async () => {
    fixture.detectChanges();
    const request = await answer(BODY);

    expect(request.request.params.get('page')).toBe('0');
    expect(request.request.params.get('size')).toBe(String(APP_CONFIG.page.defaultSize));
    expect(request.request.params.keys().sort()).toEqual(['page', 'size']);
    // No district parameter exists, under any name, and no control offers one.
    expect(request.request.urlWithParams.toLowerCase()).not.toContain('district');
    expect(el().querySelector('select')).toBeNull();
    expect(el().querySelector('input')).toBeNull();
    expect(el().querySelector('form')).toBeNull();
  });

  it('gives assignment breaches a district table with NO officer column', async () => {
    fixture.detectChanges();
    await answer(BODY);

    const table = el().querySelector<HTMLElement>('[data-testid="assignment-table"]');
    expect(table).not.toBeNull();

    const headers = [...(table?.querySelectorAll('th') ?? [])].map((h) => h.textContent?.trim());
    expect(headers).not.toContain(adminFragment['admin.kpi.breaches.column.officer'].bn);

    const section = el().querySelector<HTMLElement>('[data-testid="assignment-section"]');
    // No name, no blank name cell, no "unassigned officer" stand-in anywhere near these rows.
    expect(section?.textContent).not.toContain('Amina Khatun');
    expect(section?.textContent).not.toContain(adminFragment['admin.kpi.breaches.officerUnnamed'].bn);
    expect(section?.querySelector('[data-testid="resolution-officer"]')).toBeNull();
    // The heading names the district instead, which is what actually failed.
    expect(section?.querySelector('foshol-region-chip')).not.toBeNull();
  });

  it('names the officer on resolution rows and links both kinds through to the console', async () => {
    fixture.detectChanges();
    await answer(BODY);

    expect(text('[data-testid="resolution-officer"]')).toContain('Amina Khatun');
    expect(all('[data-testid="assignment-row"]').length).toBe(1);
    expect(all('[data-testid="resolution-row"]').length).toBe(1);

    const links = all('[data-testid="open-task"]').map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/officer/queue/tasks/t-1', '/officer/queue/tasks/t-2']);
  });

  it('renders crop and timestamps as the server sent them, in Asia/Dhaka', async () => {
    fixture.detectChanges();
    await answer(BODY);

    // Server content, verbatim — never translated (COMMON-CON-003).
    expect(text('[data-testid="assignment-row"]')).toContain('ধান');
    expect(text('[data-testid="assignment-row"]')).toContain('(Dhaka)');
  });

  it('filters by kind through the query parameter', async () => {
    fixture.detectChanges();
    await answer(BODY);

    fixture.componentRef.setInput('kind', 'ASSIGNMENT');
    await settle();
    const request = await answer({ ...BODY, content: [ASSIGNMENT_ROW], totalElements: 1 });

    expect(request.request.params.get('kind')).toBe('ASSIGNMENT');
    expect(el().querySelector('[data-testid="resolution-section"]')).toBeNull();
  });

  it('an officer filter forces RESOLUTION, because assignment breaches have no officer', async () => {
    fixture.componentRef.setInput('officerId', 'o-1');
    fixture.componentRef.setInput('kind', 'ASSIGNMENT');
    fixture.detectChanges();
    const request = await answer({ ...BODY, content: [RESOLUTION_ROW], totalElements: 1 });

    expect(request.request.params.get('officerId')).toBe('o-1');
    expect(request.request.params.get('kind')).toBe('RESOLUTION');
    expect(text('[data-testid="officer-filter"]')).toContain('Amina Khatun');
  });

  it('ignores a kind that is not one of the contract values', async () => {
    fixture.componentRef.setInput('kind', 'BOTH');
    fixture.detectChanges();
    const request = await answer(BODY);

    expect(request.request.params.has('kind')).toBeFalsy();
  });

  it('an empty page is a counted result, not a blank screen', async () => {
    fixture.detectChanges();
    await answer(EMPTY_BODY);

    expect(text('foshol-empty-state')).toContain(adminFragment['admin.kpi.breaches.none.title'].bn);
    expect(el().querySelector('[data-testid="assignment-table"]')).toBeNull();
    expect(el().querySelector('[data-testid="resolution-table"]')).toBeNull();
  });

  it('WEB-FR-305 — a 500 keeps the last page under a stale marker', async () => {
    fixture.detectChanges();
    await answer(BODY);

    el().querySelector<HTMLButtonElement>('[data-testid="refresh"]')?.click();
    await settle();
    await answer({}, { status: 500, statusText: 'Server Error' });

    expect(el().querySelector('[data-testid="stale-marker"]')).not.toBeNull();
    expect(el().querySelector('foshol-error-panel [role="alert"]')).not.toBeNull();
    expect(all('[data-testid="assignment-row"]').length).toBe(1);
    expect(all('[data-testid="resolution-row"]').length).toBe(1);
  });

  it('a 500 with nothing loaded shows the failure and no table at all', async () => {
    fixture.detectChanges();
    await answer({}, { status: 500, statusText: 'Server Error' });

    expect(el().querySelector('foshol-error-panel [role="alert"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="assignment-table"]')).toBeNull();
    expect(el().querySelector('foshol-paginator')?.textContent?.trim()).toBeFalsy();
  });

  it('every control is a button of type button', async () => {
    fixture.detectChanges();
    await answer(BODY);

    for (const button of el().querySelectorAll('button')) {
      expect(button.getAttribute('type')).toBe('button');
    }
  });
});
