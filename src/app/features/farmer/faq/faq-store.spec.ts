import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { APP_CONFIG } from '../../../core/config/app-config';
import { CORRELATION_ID_HEADER } from '../../../core/errors/problem';
import { requestAttemptInterceptor } from '../../../core/http/request-attempt.interceptor';
import type { DraftAudio } from '../../../core/stores/case-draft-store';
import { ApiConfiguration } from '../../../generated/api-configuration';
import { FaqService } from '../../../generated/services/faq.service';
import { KnowledgeService } from '../../../generated/services/knowledge.service';
import type { VoiceSearchResult } from '../../../generated/models/voice-search-result';
import { FaqStore } from './faq-store';

/**
 * The FAQ flow's two load-bearing promises, asserted against the real generated client.
 *
 * The first is a safety promise and gets the most attention here: **no remedy request may leave
 * the browser until the farmer confirms a candidate.** A voice interface mishears, and the
 * top-ranked candidate of a mishearing still looks confident; auto-revealing its chemical
 * dosage would be a safety bug rather than a cosmetic one. `backend.verify()` in `afterEach`
 * plus an explicit "zero matching requests" assertion is what keeps that honest.
 *
 * The second is that this path never touches the case machinery. ADR-0003 routes every real
 * diagnosis through `POST /cases` and an officer; a FAQ lookup that quietly submitted one would
 * be a farmer receiving unreviewed advice. Asserted by URL, not by intent.
 */
const SEARCH_URL = `${APP_CONFIG.api.origin}${FaqService.VoiceSearchFaqPath}`;
const DISEASE_ID = '01800000-0000-7000-8000-000000000103';
const REMEDIES_URL = `${APP_CONFIG.api.origin}/api/v1/diseases/${DISEASE_ID}/remedies`;
const CROP_ID = '01800000-0000-7000-8000-000000000001';

/** Deliberately not agronomic text: this file must never be a place agronomy is authored. */
const ANSWERED: VoiceSearchResult = {
  transcription: '[transcript]',
  asrConfidence: 0.91,
  inconclusive: false,
  candidates: [
    { diseaseId: DISEASE_ID, code: 'code_a', nameBn: '[রোগ ক]', score: 0.88, matcher: 'NAME' },
    { diseaseId: 'other-id', code: 'code_b', nameBn: '[রোগ খ]', score: 0.41, matcher: 'FUZZY' },
  ],
};

function clip(): DraftAudio {
  return {
    blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/wav' }),
    durationMs: 1_800,
    mimeType: 'audio/wav',
  };
}

describe('FaqStore — the confirmation gate', () => {
  let store: FaqStore;
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([requestAttemptInterceptor])),
        provideHttpClientTesting(),
        { provide: ApiConfiguration, useValue: { rootUrl: APP_CONFIG.api.origin } },
        FaqStore,
      ],
    });
    store = TestBed.inject(FaqStore);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it('sends the clip as multipart with the language hint, and asks for nothing else', async () => {
    const pending = store.search(CROP_ID, clip());

    const request = backend.expectOne((candidate) => candidate.url === SEARCH_URL);
    expect(request.request.method).toBe('POST');
    expect(request.request.params.get('preferred_language')).toBe('bn');

    const body = request.request.body as FormData;
    expect(body.get('cropId')).toBe(CROP_ID);
    expect(body.get('audio')).toBeInstanceOf(Blob);

    request.flush(ANSWERED);
    await pending;

    // The whole point: candidates are on screen and NOT one byte of remedy text was requested.
    expect(store.candidates().length).toBe(2);
    expect(backend.match(REMEDIES_URL).length).toBe(0);
  });

  it('carries a correlation id of its own and a finite timeout', async () => {
    const pending = store.search(CROP_ID, clip());
    const request = backend.expectOne((candidate) => candidate.url === SEARCH_URL);

    // WEB-FR-005 — the id printed on a failure panel must belong to THIS attempt.
    expect(request.request.headers.get(CORRELATION_ID_HEADER)).toMatch(/^[0-9a-f-]{36}$/);
    expect(request.request.timeout).toBe(APP_CONFIG.faq.requestTimeoutMs);

    request.flush(ANSWERED);
    await pending;
  });

  it('sends the SPOKEN language as the ASR hint, never the UI toggle', async () => {
    const pending = store.search(CROP_ID, clip());
    const request = backend.expectOne((candidate) => candidate.url === SEARCH_URL);

    // A farmer reading the interface in English still speaks Bangla into the microphone, and
    // the response carries both locales regardless — so the toggle has no say here.
    expect(request.request.params.get('preferred_language')).toBe(APP_CONFIG.i18n.defaultLocale);

    request.flush(ANSWERED);
    await pending;
  });

  it('fetches remedies only once a candidate is confirmed', async () => {
    const search = store.search(CROP_ID, clip());
    backend.expectOne((candidate) => candidate.url === SEARCH_URL).flush(ANSWERED);
    await search;

    expect(store.remedies()).toBeNull();
    expect(store.remedyPhase()).toBe('idle');

    const confirm = store.confirm({ diseaseId: DISEASE_ID, code: 'code_a', nameBn: '[রোগ ক]' });
    const remedies = backend.expectOne(REMEDIES_URL);
    expect(remedies.request.method).toBe('GET');
    remedies.flush([]);
    await confirm;

    expect(store.remedyPhase()).toBe('loaded');
    expect(store.selection()?.diseaseId).toBe(DISEASE_ID);
  });

  it('retracts a confirmation when a new question is asked, remedies and all', async () => {
    const search = store.search(CROP_ID, clip());
    backend.expectOne((candidate) => candidate.url === SEARCH_URL).flush(ANSWERED);
    await search;

    const confirm = store.confirm({ diseaseId: DISEASE_ID, code: 'code_a', nameBn: '[রোগ ক]' });
    backend.expectOne(REMEDIES_URL).flush([]);
    await confirm;
    expect(store.remedies()).not.toBeNull();

    const second = store.search(CROP_ID, clip());
    // The previous answer must not still be on screen describing a question nobody asked.
    expect(store.selection()).toBeNull();
    expect(store.remedies()).toBeNull();
    backend.expectOne((candidate) => candidate.url === SEARCH_URL).flush(ANSWERED);
    await second;
  });

  it('treats an inconclusive answer as a state, never as an error', async () => {
    const pending = store.search(CROP_ID, clip());
    backend
      .expectOne((candidate) => candidate.url === SEARCH_URL)
      .flush({ ...ANSWERED, inconclusive: true, candidates: [] });
    await pending;

    expect(store.inconclusive()).toBe(true);
    expect(store.phase()).toBe('answered');
    expect(store.problem()).toBeNull();
  });

  it('counts an empty candidate list as inconclusive even when the flag says otherwise', async () => {
    const pending = store.search(CROP_ID, clip());
    backend
      .expectOne((candidate) => candidate.url === SEARCH_URL)
      .flush({ ...ANSWERED, inconclusive: false, candidates: [] });
    await pending;

    expect(store.inconclusive()).toBe(true);
  });

  it('flags a 503 so the page can fall back to the typed catalogue rather than die', async () => {
    const pending = store.search(CROP_ID, clip());
    backend
      .expectOne((candidate) => candidate.url === SEARCH_URL)
      .flush(
        { code: 'ERR_ASR_UNAVAILABLE', title: 'Unavailable' },
        { status: 503, statusText: 'Service Unavailable' },
      );
    await pending;

    expect(store.phase()).toBe('failed');
    expect(store.sidecarUnavailable()).toBe(true);
  });

  it('reports a 401 rather than showing remedies (the interceptor owns the sign-out)', async () => {
    const pending = store.search(CROP_ID, clip());
    backend
      .expectOne((candidate) => candidate.url === SEARCH_URL)
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    await pending;

    expect(store.phase()).toBe('failed');
    expect(store.remedies()).toBeNull();
    expect(backend.match(REMEDIES_URL).length).toBe(0);
  });

  it('drops a slow first answer when a second question has already been asked', async () => {
    const first = store.search(CROP_ID, clip());
    const firstRequest = backend.expectOne((candidate) => candidate.url === SEARCH_URL);

    const second = store.search(CROP_ID, clip());
    const secondRequest = backend.expectOne((candidate) => candidate.url === SEARCH_URL);

    secondRequest.flush({ ...ANSWERED, transcription: '[second]' });
    await second;
    firstRequest.flush({ ...ANSWERED, transcription: '[first]' });
    await first;

    expect(store.result()?.transcription).toBe('[second]');
  });

  it('never submits a case from this flow (ADR-0003)', async () => {
    const search = store.search(CROP_ID, clip());
    backend.expectOne((candidate) => candidate.url === SEARCH_URL).flush(ANSWERED);
    await search;

    const confirm = store.confirm({ diseaseId: DISEASE_ID, code: 'code_a', nameBn: '[রোগ ক]' });
    backend.expectOne(REMEDIES_URL).flush([]);
    await confirm;

    expect(backend.match(`${APP_CONFIG.api.origin}${'/api/v1/cases'}`).length).toBe(0);
  });

  it('reaches the same gate from the typed fallback as from a voice candidate', async () => {
    const confirm = store.confirm({ diseaseId: DISEASE_ID, code: 'code_a', nameBn: '[রোগ ক]' });
    backend.expectOne(REMEDIES_URL).flush([]);
    await confirm;

    expect(store.remedyPhase()).toBe('loaded');
    // Reached without a search, so KnowledgeService is the only thing that was asked.
    expect(backend.match((candidate) => candidate.url === SEARCH_URL).length).toBe(0);
  });

  it('is wired to the contract operation, not a hand-written URL (WEB-API-001)', () => {
    expect(FaqService.VoiceSearchFaqPath).toBe('/api/v1/faq/voice-search');
    expect(KnowledgeService.ListRemediesPath).toBe('/api/v1/diseases/{diseaseId}/remedies');
  });
});
