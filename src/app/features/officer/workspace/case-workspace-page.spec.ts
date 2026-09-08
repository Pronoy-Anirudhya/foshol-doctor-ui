import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SessionStore } from '../../../core/auth/session-store';
import { APP_CONFIG } from '../../../core/config/app-config';
import { BN_CATALOGUE } from '../../../core/i18n/bn-catalogue';
import { provideI18n } from '../../../core/i18n/i18n.providers';
import { CaseReviewStore } from '../../../core/stores/case-review-store';
import { ApiConfiguration } from '../../../generated/api-configuration';
import type { Principal } from '../../../generated/models/principal';
import type { ReviewTask } from '../../../generated/models/review-task';
import analysisPrimary from '../../../../testing/fixtures/analysis-primary.json';
import analysisUndetermined from '../../../../testing/fixtures/analysis-undetermined.json';
import caseDetail from '../../../../testing/fixtures/case-detail-primary.json';
import diseasesRice from '../../../../testing/fixtures/diseases-rice.json';
import principalOfficer from '../../../../testing/fixtures/principal-officer.json';
import remediesBlast from '../../../../testing/fixtures/remedies-blast.json';
import reviewTaskLive from '../../../../testing/fixtures/review-task-live-shape.json';
import { CaseWorkspacePage } from './case-workspace-page';

/**
 * The three promises this console makes, asserted against the DOM:
 *
 *  - AC-14 / `WEB-FR-242` — when the claim runs out, the banner appears, the four actions go
 *    dead, **and every word the officer typed is still in the form**.
 *  - `WEB-FR-235` — a `409` says so, refreshes the case, and preserves the editor content.
 *  - `WEB-FR-219` / AC-13 — a degraded analysis names its code and keeps all four actions.
 */
const TASK_ID = '01a07ca3-bbd0-73b6-b530-dfa384487234';
const CASE_ID = '01a07ca3-bb8a-7a62-9b8f-ba7a7c281b70';
const CROP_ID = '01800000-0000-7000-8000-000000000001';
const DISEASE_ID = '01800000-0000-7000-8000-000000000103';
const OTHER_DISEASE_ID = '01800000-0000-7000-8000-000000000101';
const ORIGIN = APP_CONFIG.api.origin;
const OFFICER = principalOfficer as unknown as Principal;

const NOTE = 'কর্মকর্তার নিজের লেখা মন্তব্য';

function claimedTask(overrides: Partial<ReviewTask> = {}): ReviewTask {
  return {
    taskId: TASK_ID,
    caseId: CASE_ID,
    state: 'CLAIMED',
    officerId: OFFICER.id,
    claimedAt: new Date().toISOString(),
    claimExpiresAt: new Date(Date.now() + APP_CONFIG.review.claimTtlMs).toISOString(),
    slaDueAt: new Date(Date.now() + APP_CONFIG.review.claimTtlMs).toISOString(),
    requeueCount: 0,
    version: 3,
    ...overrides,
  };
}

describe('CaseWorkspacePage (WEB-FR-210…244)', () => {
  let fixture: ComponentFixture<CaseWorkspacePage>;
  let http: HttpTestingController;
  let store: CaseReviewStore;

  /**
   * `whenStable()` waits for the application to have no pending work, and this screen always
   * has some: the presigned-image and Grad-CAM reads stay open for the life of the test. So
   * the suite drains microtasks and renders explicitly instead — the generated client's
   * Observable→Promise hop takes a couple of turns to land.
   */
  async function settle(): Promise<void> {
    for (let turn = 0; turn < 6; turn += 1) {
      await Promise.resolve();
    }
    fixture.detectChanges();
    for (let turn = 0; turn < 6; turn += 1) {
      await Promise.resolve();
    }
    fixture.detectChanges();
  }

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function byId<T extends HTMLElement>(id: string): T | null {
    return el().querySelector<T>(`[data-testid="${id}"]`);
  }

  function url(path: string): string {
    return `${ORIGIN}${path}`;
  }

  /** Answers the five contract-shaped calls the facade composes the workspace from (D-05). */
  async function openCase(analysis: object = analysisPrimary): Promise<void> {
    http.expectOne(url(`/api/v1/review/tasks/${TASK_ID}`)).flush(reviewTaskLive);
    await settle();

    http.expectOne(url(`/api/v1/cases/${CASE_ID}`)).flush(caseDetail);
    http.expectOne(url(`/api/v1/cases/${CASE_ID}/analysis`)).flush(analysis);
    await settle();

    http.expectOne(url(`/api/v1/crops/${CROP_ID}/diseases`)).flush(diseasesRice);
    http.expectOne(url(`/api/v1/diseases/${DISEASE_ID}/remedies`)).flush(remediesBlast);
    await settle();
  }

  async function claim(task: ReviewTask = claimedTask()): Promise<void> {
    byId<HTMLButtonElement>('claim-take')!.click();
    await settle();
    http.expectOne(url(`/api/v1/review/tasks/${TASK_ID}/claim`)).flush(task);
    await settle();
  }

  async function typeNote(text: string): Promise<void> {
    const note = byId<HTMLTextAreaElement>('officer-note')!;
    note.value = text;
    note.dispatchEvent(new Event('input'));
    await settle();
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideI18n(),
        { provide: ApiConfiguration, useValue: { rootUrl: ORIGIN } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(CaseReviewStore);
    // The claim is "mine" only when the task's officerId matches this session's subject.
    TestBed.inject(SessionStore).signIn('test-token', OFFICER, new Date(Date.now() + 1));

    fixture = TestBed.createComponent(CaseWorkspacePage);
    fixture.componentRef.setInput('taskId', TASK_ID);
    await settle();
  });

  afterEach(() => {
    // Media requests (presigned image URLs, the Grad-CAM overlay) are out of scope here and
    // are drained rather than asserted; every API call this suite cares about is expected.
    http.match(() => true);
    http.verify();
  });

  it('composes the workspace from the contract-shaped endpoints (D-05)', async () => {
    await openCase();

    expect(el().textContent).toContain('Demo Farmer');
    expect(el().querySelector('foshol-decision-path-badge')).not.toBeNull();
    // WEB-FR-216 / AC-12 — the REPLAY badge, on every case.
    expect(el().querySelector('foshol-analysis-mode-badge')?.getAttribute('data-mode')).toBe('REPLAY');
    // WEB-NFR-011 — one bar per candidate, thresholds bound from the analysis payload.
    expect(el().querySelectorAll('foshol-confidence-bar').length).toBe(
      analysisPrimary.candidates.length,
    );
    expect(byId('unmapped-count')).not.toBeNull();
  });

  it('enables no action until the case is claimed (WEB-FR-240)', async () => {
    await openCase();

    for (const action of ['approve', 'edit', 'replace', 'reject']) {
      expect(byId<HTMLButtonElement>(`action-${action}`)!.disabled).toBe(true);
    }

    await claim();

    expect(byId<HTMLButtonElement>('action-approve')!.disabled).toBe(false);
    expect(byId<HTMLButtonElement>('action-reject')!.disabled).toBe(false);
    expect(byId('claim-release')).not.toBeNull();
  });

  it('survives release answering 204 with no body, and can re-claim afterwards', async () => {
    await openCase();
    await claim();

    byId<HTMLButtonElement>('claim-release')!.click();
    await settle();
    // The live server answers 204 here, not the contract's 200 ReviewTask. Adopting the null
    // body would blank the task and strand the officer with no way back in.
    http
      .expectOne(url(`/api/v1/review/tasks/${TASK_ID}/release`))
      .flush(null, { status: 204, statusText: 'No Content' });
    await settle();

    http.expectOne(url(`/api/v1/review/tasks/${TASK_ID}`)).flush(reviewTaskLive);
    await settle();
    http.expectOne(url(`/api/v1/cases/${CASE_ID}`)).flush(caseDetail);
    http.expectOne(url(`/api/v1/cases/${CASE_ID}/analysis`)).flush(analysisPrimary);
    await settle();

    expect(store.task()).not.toBeNull();
    expect(byId('claim-take')).not.toBeNull();
    expect(byId<HTMLButtonElement>('action-approve')!.disabled).toBe(true);
  });

  it('keeps the officer’s unsaved edits when the claim expires (AC-14, WEB-FR-242)', async () => {
    await openCase();
    await claim();
    await typeNote(NOTE);

    // The store owns no timer, so the expiry is driven exactly, with no wall clock involved.
    store.tick(Date.now() + APP_CONFIG.review.claimTtlMs + APP_CONFIG.ui.msPerSecond);
    await settle();

    expect(byId('claim-expired')).not.toBeNull();
    for (const action of ['approve', 'edit', 'replace', 'reject']) {
      expect(byId<HTMLButtonElement>(`action-${action}`)!.disabled).toBe(true);
    }
    // The whole point: the typing survives a background timer.
    expect(byId<HTMLTextAreaElement>('officer-note')!.value).toBe(NOTE);
    expect(store.remedyDraft().officerNoteBn).toBe(NOTE);
    // …and a re-claim is offered.
    expect(byId('claim-take')).not.toBeNull();
  });

  it('goes read-only, keeping the text, when a re-claim loses to another officer (AC-15)', async () => {
    await openCase();
    await claim();
    await typeNote(NOTE);

    store.tick(Date.now() + APP_CONFIG.review.claimTtlMs + APP_CONFIG.ui.msPerSecond);
    await settle();

    byId<HTMLButtonElement>('claim-take')!.click();
    await settle();
    http.expectOne(url(`/api/v1/review/tasks/${TASK_ID}/claim`)).flush(
      { status: 409, title: 'Conflict', code: 'ERR_TASK_CLAIMED', correlationId: 'c-9' },
      {
        status: 409,
        statusText: 'Conflict',
      },
    );
    await settle();

    // The facade re-reads the case after a conflict; answer that read.
    http.expectOne(url(`/api/v1/review/tasks/${TASK_ID}`)).flush(reviewTaskLive);
    await settle();
    http.expectOne(url(`/api/v1/cases/${CASE_ID}`)).flush(caseDetail);
    http.expectOne(url(`/api/v1/cases/${CASE_ID}/analysis`)).flush(analysisPrimary);
    await settle();

    expect(byId('claim-readonly')).not.toBeNull();
    expect(byId<HTMLTextAreaElement>('officer-note')!.value).toBe(NOTE);
    expect(byId<HTMLButtonElement>('action-approve')!.disabled).toBe(true);
  });

  it('preserves the editor content on a 409 and never retries (WEB-FR-235, WEB-FR-244)', async () => {
    await openCase();
    await claim();
    await typeNote(NOTE);

    byId<HTMLButtonElement>('action-approve')!.click();
    await settle();

    const publish = http.expectOne(url(`/api/v1/review/tasks/${TASK_ID}/approve`));
    // The server derives the action; expectedVersion is the one `claim` returned, not the
    // number the flat task body carried (D-05).
    expect(publish.request.body.expectedVersion).toBe(3);
    expect(publish.request.body.officerNoteBn).toBe(NOTE);
    expect(publish.request.body.diseaseId).toBe(DISEASE_ID);
    expect(publish.request.body.remedyIds.length).toBeGreaterThan(0);

    publish.flush(
      { status: 409, title: 'Conflict', code: 'ERR_VERSION_CONFLICT', correlationId: 'c-7' },
      {
        status: 409,
        statusText: 'Conflict',
      },
    );
    await settle();

    // WEB-FR-235 — refreshed, not retried.
    http.expectOne(url(`/api/v1/review/tasks/${TASK_ID}`)).flush(reviewTaskLive);
    await settle();
    http.expectOne(url(`/api/v1/cases/${CASE_ID}`)).flush(caseDetail);
    http.expectOne(url(`/api/v1/cases/${CASE_ID}/analysis`)).flush(analysisPrimary);
    await settle();

    http.expectNone(url(`/api/v1/review/tasks/${TASK_ID}/approve`));
    expect(byId('action-problem')).not.toBeNull();
    expect(byId<HTMLTextAreaElement>('officer-note')!.value).toBe(NOTE);
    expect(store.remedyDraft().officerNoteBn).toBe(NOTE);
  });

  it('requires a reason AND a Bangla message before Reject can be sent (WEB-FR-233)', async () => {
    await openCase();
    await claim();

    byId<HTMLButtonElement>('action-reject')!.click();
    await settle();

    byId<HTMLButtonElement>('reject-confirm')!.click();
    await settle();
    http.expectNone(url(`/api/v1/review/tasks/${TASK_ID}/reject`));

    const reason = byId<HTMLSelectElement>('reject-reason')!;
    reason.value = 'BLURRY_IMAGE';
    reason.dispatchEvent(new Event('change'));
    const message = byId<HTMLTextAreaElement>('reject-message')!;
    message.value = 'আরও স্পষ্ট ছবি দিন';
    message.dispatchEvent(new Event('input'));
    await settle();

    byId<HTMLButtonElement>('reject-confirm')!.click();
    await settle();

    const request = http.expectOne(url(`/api/v1/review/tasks/${TASK_ID}/reject`));
    expect(request.request.body.reasonCode).toBe('BLURRY_IMAGE');
    expect(request.request.body.messageBn).toBe('আরও স্পষ্ট ছবি দিন');
  });

  it('names the error code and keeps all four actions on a degraded analysis (AC-13)', async () => {
    await openCase(analysisUndetermined);
    await claim();

    const banner = byId('degraded-banner');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain('ERR_SIDECAR_UNAVAILABLE');

    // WEB-FR-219 — the four actions remain available; only Approve/Edit need a chosen disease.
    for (const action of ['approve', 'edit', 'replace', 'reject']) {
      expect(byId(`action-${action}`)).not.toBeNull();
    }
    expect(byId<HTMLButtonElement>('action-reject')!.disabled).toBe(false);
    expect(byId<HTMLButtonElement>('action-replace')!.disabled).toBe(false);
  });

  it('hides the Grad-CAM toggle entirely where there is no overlay (WEB-FR-212)', async () => {
    await openCase(analysisUndetermined);

    expect(el().querySelector('foshol-gradcam-view .toggle')).toBeNull();
  });

  // The farmer-reported metrics the server reckons a dose from, and where they came from.
  it('shows the field metrics and their source', async () => {
    await openCase();

    expect(byId('metrics-field-area')?.textContent).toContain('2');
    expect(byId('metrics-field-area')?.textContent).toContain(
      BN_CATALOGUE['shared.unit.area.DECIMAL'],
    );
    expect(byId('metrics-source')?.textContent?.trim()).toBe(
      BN_CATALOGUE['officer.case.metrics.source.FORM'],
    );
    // The fixture carries no crop quantity, and an absent optional metric renders as nothing.
    expect(byId('metrics-crop-quantity')).toBeNull();
  });

  /**
   * The dose is computed by the server for the RANK-1 disease from the case's field area. It is
   * joined onto the knowledge-catalogue remedies for display, and must vanish the moment the
   * officer moves to a different disease — a dose shown against the wrong diagnosis is not a
   * stale number, it is a wrong instruction (`COMMON-CON-003`).
   */
  it('shows the computed dose on the rank-1 remedy and drops it when the disease is replaced', async () => {
    await openCase();
    await claim();

    const dose = byId('computed-dose');
    expect(dose).not.toBeNull();
    expect(dose?.textContent).toContain('5');
    expect(dose?.textContent).toContain(BN_CATALOGUE['shared.unit.dose.ML']);
    expect(dose?.textContent).toContain(BN_CATALOGUE['shared.unit.basis.PER_DECIMAL']);
    // Provenance: the area the server reckoned from, so the officer can check the sum's input.
    expect(dose?.textContent).toContain(BN_CATALOGUE['shared.unit.area.DECIMAL']);
    // Only the one remedy the server could compute for; the others carry no rates yet.
    expect(el().querySelectorAll('[data-testid="computed-dose"]').length).toBe(1);

    byId<HTMLButtonElement>('action-replace')!.click();
    await settle();
    const other = el().querySelector<HTMLInputElement>(
      `input[name="replace-disease"][value="${OTHER_DISEASE_ID}"]`,
    )!;
    other.click();
    await settle();
    http.expectOne(url(`/api/v1/diseases/${OTHER_DISEASE_ID}/remedies`)).flush(remediesBlast);
    await settle();

    expect(byId('computed-dose')).toBeNull();
  });
});
