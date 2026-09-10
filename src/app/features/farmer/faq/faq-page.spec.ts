import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { APP_CONFIG } from '../../../core/config/app-config';
import { BN_CATALOGUE } from '../../../core/i18n/bn-catalogue';
import { provideI18n } from '../../../core/i18n/i18n.providers';
import type { DraftAudio } from '../../../core/stores/case-draft-store';
import { ApiConfiguration } from '../../../generated/api-configuration';
import { FaqService } from '../../../generated/services/faq.service';
import { KnowledgeService } from '../../../generated/services/knowledge.service';
import crops from '../../../../testing/fixtures/crops.json';
import { MIC_READY, VoiceRecorder } from '../capture/voice-recorder';
import { FaqPage } from './faq-page';
import { FaqStore } from './faq-store';

/**
 * The FAQ screen as a farmer meets it.
 *
 * Three things are asserted that the individual components cannot assert on their own: that the
 * disclaimer is always on screen, that the crop gate really does hold before any audio can be
 * sent, and that an inconclusive answer produces a way forward rather than a dead end.
 */
const CROPS_URL = `${APP_CONFIG.api.origin}${KnowledgeService.ListCropsPath}`;
const SEARCH_URL = `${APP_CONFIG.api.origin}${FaqService.VoiceSearchFaqPath}`;

function clip(): DraftAudio {
  return { blob: new Blob([new Uint8Array([1])]), durationMs: 900, mimeType: 'audio/wav' };
}

/**
 * jsdom is not a secure context, so the real `VoiceRecorder` probes to `INSECURE` and the panel
 * correctly renders no control at all. That is the right production behaviour and the wrong
 * fixture for asserting the crop gate, so the page is given a recorder that reports itself
 * usable — exactly the seam `faq-recorder-panel.spec.ts` uses.
 */
function recorderStub(): unknown {
  return {
    status: signal(MIC_READY),
    available: signal(true),
    recording: signal(false),
    preparing: signal(false),
    elapsedMs: signal(0),
    elapsedSeconds: signal(0),
    clip: signal<DraftAudio | null>(null),
    clipUrl: signal<string | null>(null),
    analyser: signal<AnalyserNode | null>(null),
    press: () => undefined,
    release: () => undefined,
    discard: () => undefined,
  };
}

describe('FaqPage', () => {
  let fixture: ComponentFixture<FaqPage>;
  let backend: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FaqPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideI18n(),
        provideRouter([]),
        { provide: ApiConfiguration, useValue: { rootUrl: APP_CONFIG.api.origin } },
      ],
    })
      .overrideComponent(FaqPage, {
        set: { providers: [{ provide: VoiceRecorder, useValue: recorderStub() }, FaqStore] },
      })
      .compileComponents();

    backend = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(FaqPage);
    // The crops `resource` loader runs inside this first cycle, so the request must be answered
    // BEFORE anything awaits stability — on a zoneless application `whenStable()` waits for it.
    fixture.detectChanges();
    backend.expectOne(CROPS_URL).flush(crops);
    await settle();
  });

  afterEach(() => {
    backend.verify({ ignoreCancelled: true });
    TestBed.resetTestingModule();
  });

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function store(): FaqStore {
    return fixture.debugElement.injector.get(FaqStore);
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** Choose the first crop, then answer the disease request that choosing one always triggers. */
  async function chooseFirstCrop(): Promise<string> {
    const first = (crops as readonly { id: string }[])[0]!;
    host().querySelector<HTMLButtonElement>('[data-testid="crop-tile"]')?.click();
    fixture.detectChanges();
    backend
      .expectOne(`${APP_CONFIG.api.origin}/api/v1/crops/${first.id}/diseases`)
      .flush([]);
    await settle();
    return first.id;
  }

  it('always says this is a catalogue entry rather than a diagnosis (ADR-0003)', () => {
    const disclaimer = host().querySelector('[data-testid="faq-disclaimer"]');

    expect(disclaimer).not.toBeNull();
    expect(disclaimer?.textContent).toContain(BN_CATALOGUE['farmer.faq.disclaimer']);
    // It points at the path that DOES diagnose a field, so the farmer is never left stuck.
    expect(disclaimer?.querySelector('a')?.getAttribute('href')).toBe('/farmer/new');
  });

  it('refuses to let a question be asked before a crop is chosen', () => {
    expect(host().querySelectorAll('[data-testid="crop-tile"]').length).toBeGreaterThan(0);
    expect(
      host().querySelector('[data-testid="faq-record-button"]')?.getAttribute('aria-disabled'),
    ).toBe('true');
    expect(host().querySelector('[data-testid="faq-recorder-hint"]')).not.toBeNull();
  });

  it('opens the question up once a crop is chosen, and loads that crop’s catalogue', async () => {
    await chooseFirstCrop();

    expect(
      host().querySelector('[data-testid="faq-record-button"]')?.getAttribute('aria-disabled'),
    ).toBeNull();
  });

  it('offers a way forward when nothing matched, and asks for no remedies', async () => {
    const cropId = await chooseFirstCrop();

    const pending = store().search(cropId, clip(), 'bn');
    backend
      .expectOne((candidate) => candidate.url === SEARCH_URL)
      .flush({
        transcription: '[transcript]',
        asrConfidence: 0.2,
        candidates: [],
        inconclusive: true,
      });
    await pending;
    await settle();

    expect(host().querySelector('[data-testid="faq-no-match"]')).not.toBeNull();
    // A dead end would be the bug; the typed catalogue opens itself.
    expect(host().querySelector('[data-testid="faq-browse"]')).not.toBeNull();
    expect(host().querySelector('[data-testid="faq-remedies"]')).toBeNull();
    expect(backend.match((candidate) => candidate.url.includes('/remedies')).length).toBe(0);
  });

  it('shows what it heard before it shows what it matched', async () => {
    const cropId = await chooseFirstCrop();

    const pending = store().search(cropId, clip(), 'bn');
    backend
      .expectOne((candidate) => candidate.url === SEARCH_URL)
      .flush({
        transcription: '[what the farmer said]',
        asrConfidence: 0.87,
        inconclusive: false,
        candidates: [
          { diseaseId: 'd-1', code: 'code_a', nameBn: '[রোগ]', score: 0.9, matcher: 'NAME' },
        ],
      });
    await pending;
    await settle();

    expect(host().querySelector('[data-testid="faq-transcription"]')?.textContent).toContain(
      '[what the farmer said]',
    );
    expect(host().querySelectorAll('[data-testid="faq-candidate"]').length).toBe(1);
    // Still nothing but a choice on screen — remedy text waits for the tap.
    expect(host().querySelector('[data-testid="faq-remedies"]')).toBeNull();
  });

  it('declares no aria-live of its own — the shell owns the only one (WEB-UX-046)', () => {
    // The recorder panel carries a single `role="status"` line for its own transient state, the
    // same shape `voice-panel.ts` uses; nothing on this page adds a competing `aria-live`.
    expect(host().querySelectorAll('[aria-live]').length).toBe(0);
    expect(host().querySelectorAll('[role="status"]').length).toBeLessThanOrEqual(1);
  });
});
