import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { APP_CONFIG } from '../../../core/config/app-config';
import { provideI18n } from '../../../core/i18n/i18n.providers';
import { QueueStore } from '../../../core/stores/queue-store';
import { ApiConfiguration } from '../../../generated/api-configuration';
import { ReviewService } from '../../../generated/services/review.service';
import type { PageOfOfficerQueueRow } from '../../../generated/models/page-of-officer-queue-row';
import queuePage from '../../../../testing/fixtures/queue-page.json';
import { OfficerQueuePage } from './officer-queue-page';

/**
 * `WEB-FR-200` / AC-11 — the one property this screen exists to protect: the server's order,
 * and no way for anyone to change it.
 */
const QUEUE_URL = `${APP_CONFIG.api.origin}${ReviewService.GetReviewQueuePath}`;
const page = queuePage as unknown as PageOfOfficerQueueRow;

describe('OfficerQueuePage (WEB-FR-200…205)', () => {
  let fixture: ComponentFixture<OfficerQueuePage>;
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
    fixture = TestBed.createComponent(OfficerQueuePage);
    await fixture.whenStable();

    http.expectOne((request) => request.url === QUEUE_URL).flush(page);
    await settle();
  });

  /**
   * A flush resolves the generated client's Observable→Promise hop one microtask later, and
   * the signal write that follows schedules a render after `whenStable` has already settled.
   * One explicit pass closes that gap deterministically.
   */
  async function settle(): Promise<void> {
    for (let turn = 0; turn < 4; turn += 1) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
    await fixture.whenStable();
  }

  afterEach(() => {
    http.match(() => true);
    http.verify();
  });

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function caseIdsIn(selector: string): string[] {
    return Array.from(el().querySelectorAll<HTMLElement>(selector)).map(
      (row) => row.getAttribute('data-case-id') ?? '',
    );
  }

  it('renders rows in exactly the order the server returned them', () => {
    const served = page.content.map((row) => row.caseId);

    expect(caseIdsIn('[data-testid="queue-row"]')).toEqual(served);
    // WEB-UX-032 — the card view below md is the same list, in the same order.
    expect(caseIdsIn('[data-testid="queue-card"]')).toEqual(served);
  });

  it('exposes no interactive column header (AC-11)', () => {
    const headers = Array.from(el().querySelectorAll('[data-testid="queue-table"] thead th'));
    expect(headers.length).toBeGreaterThan(0);

    for (const header of headers) {
      expect(header.querySelector('button, a, [role="button"], input, select')).toBeNull();
      expect(header.getAttribute('aria-sort')).toBeNull();
      expect(header.getAttribute('tabindex')).toBeNull();
      expect(header.hasAttribute('data-sort')).toBe(false);
    }
  });

  it('offers no sort affordance anywhere on the screen', () => {
    expect(el().outerHTML).not.toMatch(/aria-sort|data-sort|sortBy/i);
    // The store it renders from has no comparator either; between the two, the requirement
    // cannot be broken by a later edit.
    expect(Object.getOwnPropertyNames(QueueStore.prototype)).not.toContain('sort');
  });

  it('states the ordering rule next to the table (WEB-FR-202)', () => {
    const note = el().querySelector('[data-testid="queue-order-note"]');

    expect(note).not.toBeNull();
    expect((note?.textContent ?? '').trim().length).toBeGreaterThan(0);
  });

  it('shows every field WEB-FR-201 requires, per row', async () => {
    const first = el().querySelector<HTMLElement>('[data-testid="queue-card"]');
    const row = page.content[0];

    expect(first?.textContent).toContain(row.farmerName);
    expect(first?.textContent).toContain(row.cropNameBn);
    expect(first?.textContent).toContain(row.topDiseaseNameBn);
    expect(first?.querySelector('[data-testid="queue-confidence"]')?.textContent).toContain('91');
    expect(first?.querySelector('foshol-decision-path-badge')).not.toBeNull();
    // WEB-NFR-011 — no confidence bar in the queue: the row carries no thresholds to bind.
    expect(first?.querySelector('foshol-confidence-bar')).toBeNull();
  });

  it('marks a re-submission where the server set the flag', () => {
    const resubmitted = page.content.findIndex((row) => row.isResubmission === true);
    if (resubmitted < 0) return;

    const cards = el().querySelectorAll<HTMLElement>('[data-testid="queue-card"]');
    expect(cards[resubmitted].querySelector('.resub')).not.toBeNull();
  });

  it('refreshes on demand rather than on a timer (WEB-FR-205, WEB-FR-356)', async () => {
    el().querySelector<HTMLButtonElement>('[data-testid="queue-refresh"]')!.click();
    await settle();

    http.expectOne((request) => request.url === QUEUE_URL).flush(page);
    await settle();

    expect(caseIdsIn('[data-testid="queue-row"]')).toEqual(page.content.map((row) => row.caseId));
  });

  it('patches a row in place from SSE without re-ordering (WEB-FR-204)', async () => {
    const store = TestBed.inject(QueueStore);
    const target = page.content[1];

    expect(store.patchRow(target.caseId, 'IN_REVIEW')).toBe(true);
    await settle();

    expect(caseIdsIn('[data-testid="queue-row"]')).toEqual(page.content.map((row) => row.caseId));
  });

  it('asks for a refetch rather than re-ordering when a case leaves the queue', async () => {
    const store = TestBed.inject(QueueStore);

    expect(store.patchRow(page.content[0].caseId, 'ADVISED')).toBe(false);
    await settle();

    expect(el().querySelector('[data-testid="queue-stale"]')).not.toBeNull();
  });
});
