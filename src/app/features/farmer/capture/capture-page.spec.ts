import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { APP_CONFIG } from '../../../core/config/app-config';
import { BN_CATALOGUE } from '../../../core/i18n/bn-catalogue';
import { provideI18n } from '../../../core/i18n/i18n.providers';
import { CaseDraftStore } from '../../../core/stores/case-draft-store';
import { ApiConfiguration } from '../../../generated/api-configuration';
import { CasesService } from '../../../generated/services/cases.service';
import { KnowledgeService } from '../../../generated/services/knowledge.service';
import crops from '../../../../testing/fixtures/crops.json';
import { FakeImageRaster } from '../../../../testing/factories/fake-image-raster';
import {
  blurredImage,
  nonCropImage,
  oversizedImage,
  passingImage,
  undersizedImage,
  type SyntheticImage,
} from '../../../../testing/factories/synthetic-images';
import { CapturePage } from './capture-page';
import { IMAGE_RASTER } from './image-raster.port';

/**
 * WEB-TEST-002 — the quality-gate rejection flow, end to end through the real component.
 *
 * Each case asserts all four things the requirement names: the rejection prompt renders, the
 * HTTP testing backend recorded **zero** requests, the prompt text resolves from the Bangla
 * catalogue, and the override control is present for the vegetation case **only**.
 *
 * The canvas is the only thing faked (`IMAGE_RASTER`). Every threshold, every metric and every
 * verdict is computed by production code over pixels generated in the test (`WEB-TEST-008`).
 */
const CROPS_URL = `${APP_CONFIG.api.origin}${KnowledgeService.ListCropsPath}`;
const SUBMIT_URL = `${APP_CONFIG.api.origin}${CasesService.SubmitCasePath}`;
const CASE_ID = '01991f27-0000-7000-8000-0000000000aa';

describe('CapturePage — local quality gate (WEB-TEST-002, WEB-FR-120…125)', () => {
  let fixture: ComponentFixture<CapturePage>;
  let http: HttpTestingController;
  let raster: FakeImageRaster;
  let draft: CaseDraftStore;

  const fixtures: SyntheticImage[] = [];

  async function setUp(images: readonly SyntheticImage[]): Promise<void> {
    fixtures.length = 0;
    fixtures.push(...images);
    raster = new FakeImageRaster(fixtures);

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideI18n(),
        { provide: ApiConfiguration, useValue: { rootUrl: APP_CONFIG.api.origin } },
        { provide: IMAGE_RASTER, useValue: raster },
      ],
    });

    http = TestBed.inject(HttpTestingController);
    draft = TestBed.inject(CaseDraftStore);
    draft.discard();

    fixture = TestBed.createComponent(CapturePage);
    // The crop list is the ONE request this screen makes on load, and `whenStable()` would
    // block on it, so it is flushed as soon as the resource has issued it.
    fixture.detectChanges();
    http.expectOne(CROPS_URL).flush(crops);
    await fixture.whenStable();
  }

  afterEach(() => {
    http.verify();
  });

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  async function choose(...images: readonly SyntheticImage[]): Promise<void> {
    const input = el().querySelector<HTMLInputElement>('[data-testid="capture-file-input"]');
    Object.defineProperty(input, 'files', {
      value: images.map((image) => image.blob),
      configurable: true,
    });
    input!.dispatchEvent(new Event('change'));
    // The pipeline is asynchronous; let its microtasks drain before asserting the DOM.
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  }

  /** Every request the backend saw since the crop list was flushed. */
  function requestsSincePick(): string[] {
    return http.match(() => true).map((request) => request.request.urlWithParams);
  }

  function reason(): string {
    return (
      el().querySelector('[data-testid="quality-reason"]')?.textContent?.trim() ?? '<absent>'
    );
  }

  function overrideControl(): Element | null {
    return el().querySelector('[data-testid="quality-override"]');
  }

  it('renders crops as icon tiles and NO <select> anywhere (AC-02, WEB-FR-100)', async () => {
    await setUp([passingImage()]);

    expect(el().querySelectorAll('[data-testid="crop-tile"]').length).toBe(crops.length);
    expect(el().querySelector('select')).toBeNull();
    expect(el().querySelector('[role="radiogroup"]')).not.toBeNull();
  });

  it('rejects a below-minimum-edge photo locally, with no request and no override', async () => {
    const image = undersizedImage();
    await setUp([image]);
    await choose(image);

    expect(el().querySelector('[data-testid="quality-reject"]')).not.toBeNull();
    // WEB-FR-123 — nothing was uploaded; the verdict is the client's own.
    expect(requestsSincePick()).toEqual([]);
    expect(reason()).toBe(BN_CATALOGUE['farmer.capture.quality.reason.TOO_SMALL']);
    // WEB-FR-124 — a size rejection gets no "send anyway"; the server would reject it too.
    expect(overrideControl()).toBeNull();
    // Nothing was even encoded, let alone sent.
    expect(raster.encodeCalls).toEqual([]);
  });

  it('rejects a blurred photo naming blur, with no request and no override', async () => {
    const image = blurredImage();
    await setUp([image]);
    await choose(image);

    expect(el().querySelector('[data-testid="quality-reject"]')).not.toBeNull();
    expect(requestsSincePick()).toEqual([]);
    expect(reason()).toBe(BN_CATALOGUE['farmer.capture.quality.reason.BLURRY']);
    expect(overrideControl()).toBeNull();
    expect(raster.encodeCalls).toEqual([]);
  });

  it('offers "send anyway" for the vegetation heuristic ONLY (WEB-FR-124, AC-05)', async () => {
    const image = nonCropImage();
    await setUp([image]);
    await choose(image);

    expect(el().querySelector('[data-testid="quality-reject"]')).not.toBeNull();
    expect(requestsSincePick()).toEqual([]);
    expect(reason()).toBe(BN_CATALOGUE['farmer.capture.quality.reason.NOT_CROP']);
    expect(overrideControl()).not.toBeNull();
  });

  it('accepts a sharp, large, green photo and still issues no request', async () => {
    const image = passingImage();
    await setUp([image]);
    await choose(image);

    expect(el().querySelector('[data-testid="quality-reject"]')).toBeNull();
    expect(el().querySelectorAll('[data-testid="strip-item"]').length).toBe(1);
    // WEB-FR-111/112 — the preview and the re-encode both happen before any upload.
    expect(raster.encodeCalls[0]).toEqual({
      maxEdgePx: APP_CONFIG.capture.maxEdgePx,
      quality: APP_CONFIG.capture.jpegQuality,
    });
    expect(requestsSincePick()).toEqual([]);
    expect(draft.imageCount()).toBe(1);
  });

  it('accepts the vegetation case after the override, and only then encodes it', async () => {
    const image = nonCropImage();
    await setUp([image]);
    await choose(image);
    expect(raster.encodeCalls).toEqual([]);

    el().querySelector<HTMLButtonElement>('[data-testid="quality-override"]')!.click();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();

    expect(el().querySelector('[data-testid="quality-reject"]')).toBeNull();
    expect(draft.imageCount()).toBe(1);
    expect(raster.encodeCalls.length).toBe(1);
    expect(requestsSincePick()).toEqual([]);
  });

  it('allows removal and reordering of previews before submission (WEB-FR-115)', async () => {
    const first = passingImage();
    const second = passingImage();
    const third = passingImage();
    await setUp([first, second, third]);
    await choose(first, second, third);

    const order = () => draft.images().map((image) => image.id);
    const before = order();
    expect(before.length).toBe(APP_CONFIG.intake.maxImages);

    // Move the last preview one place earlier.
    el()
      .querySelectorAll<HTMLButtonElement>('[data-testid="strip-move-back"]')[2]!
      .click();
    await fixture.whenStable();
    expect(order()).toEqual([before[0], before[2], before[1]]);

    el().querySelectorAll<HTMLButtonElement>('[data-testid="strip-remove"]')[0]!.click();
    await fixture.whenStable();
    expect(order()).toEqual([before[2], before[1]]);
    expect(requestsSincePick()).toEqual([]);
  });

  it('refuses a photo beyond the cap in place, keeping the ones already chosen', async () => {
    const images = [passingImage(), passingImage(), passingImage(), passingImage()];
    await setUp(images);
    await choose(...images);

    // WEB-DATA-004 — the fourth is refused, and none of the first three is evicted for it.
    expect(draft.imageCount()).toBe(APP_CONFIG.intake.maxImages);
    expect(el().querySelector('[data-testid="capture-refusal"]')).not.toBeNull();
    expect(requestsSincePick()).toEqual([]);
  });

  it('steps down the quality ladder, then the edge, before rejecting for size', async () => {
    const image = oversizedImage(APP_CONFIG.intake.maxImageBytes);
    await setUp([image]);
    await choose(image);

    expect(raster.encodeCalls.map((call) => call.quality)).toEqual([
      ...APP_CONFIG.capture.qualityLadder,
      APP_CONFIG.capture.qualityLadder[APP_CONFIG.capture.qualityLadder.length - 1],
    ]);
    expect(raster.encodeCalls[raster.encodeCalls.length - 1]?.maxEdgePx).toBe(
      APP_CONFIG.capture.fallbackEdgePx,
    );
    expect(reason()).toBe(BN_CATALOGUE['farmer.capture.quality.reason.TOO_LARGE']);
    expect(requestsSincePick()).toEqual([]);
  });
});

describe('CapturePage — submission (WEB-FR-150, WEB-FR-403)', () => {
  let fixture: ComponentFixture<CapturePage>;
  let http: HttpTestingController;
  let draft: CaseDraftStore;

  async function setUpWithOneImage(): Promise<void> {
    const image = passingImage();

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideI18n(),
        { provide: ApiConfiguration, useValue: { rootUrl: APP_CONFIG.api.origin } },
        { provide: IMAGE_RASTER, useValue: new FakeImageRaster([image]) },
      ],
    });

    http = TestBed.inject(HttpTestingController);
    draft = TestBed.inject(CaseDraftStore);
    draft.discard();

    fixture = TestBed.createComponent(CapturePage);
    fixture.detectChanges();
    http.expectOne(CROPS_URL).flush(crops);
    await fixture.whenStable();

    draft.chooseCrop(crops[0]!.id);
    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      '[data-testid="capture-file-input"]',
    );
    Object.defineProperty(input, 'files', { value: [image.blob], configurable: true });
    input!.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  }

  afterEach(() => {
    http.verify();
  });

  function submitButton(): HTMLButtonElement {
    return (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[data-testid="capture-submit"]',
    )!;
  }

  it('sends one multipart request carrying the crop, the image and the idempotency key', async () => {
    await setUpWithOneImage();
    const key = draft.idempotencyKey();

    submitButton().click();
    await fixture.whenStable();

    const request = http.expectOne(SUBMIT_URL);
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('Idempotency-Key')).not.toBeNull();
    const body = request.request.body as FormData;
    expect(body.get('cropId')).toBe(crops[0]!.id);
    expect(body.getAll('images').length).toBe(1);
    // WEB-DATA-005 — the key was minted for this attempt, not before the content settled.
    expect(key).toBeNull();

    request.flush({ caseId: CASE_ID, status: 'SUBMITTED' }, { status: 202, statusText: 'Accepted' });
    await fixture.whenStable();
  });

  it('reuses the SAME Idempotency-Key on a retry after a failure (AC-28)', async () => {
    await setUpWithOneImage();

    submitButton().click();
    await fixture.whenStable();
    const first = http.expectOne(SUBMIT_URL);
    first.flush(null, { status: 0, statusText: 'Network error' });
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();

    submitButton().click();
    await fixture.whenStable();
    const second = http.expectOne(SUBMIT_URL);
    expect(second.request.headers.get('Idempotency-Key')).toBe(
      first.request.headers.get('Idempotency-Key'),
    );

    second.flush({ caseId: CASE_ID, status: 'SUBMITTED' }, { status: 202, statusText: 'Accepted' });
    await fixture.whenStable();
  });

  it('maps a 422 rejectedImages[].position (0-based) onto the right preview', async () => {
    await setUpWithOneImage();

    submitButton().click();
    await fixture.whenStable();

    http.expectOne(SUBMIT_URL).flush(
      {
        type: 'https://foshol.local/problems/err-image-quality-rejected',
        title: 'Unprocessable Entity',
        status: 422,
        detail: '[server detail]',
        code: 'ERR_IMAGE_QUALITY_REJECTED',
        correlationId: '01a07caa-d705-7ad0-a51b-f334668c9fab',
        rejectedImages: [
          { position: 0, reason: 'BLURRY', messageBn: 'ছবি ঝাপসা। অনুগ্রহ করে স্পষ্ট করে আবার তুলুন।' },
        ],
      },
      { status: 422, statusText: 'Unprocessable Entity' },
    );
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    const marked = el.querySelector('[data-testid="strip-server-reject"]');
    expect(marked).not.toBeNull();
    // WEB-UX-016 — the server's own Bangla sentence renders verbatim, never re-worded here.
    expect(marked?.textContent?.trim()).toBe('ছবি ঝাপসা। অনুগ্রহ করে স্পষ্ট করে আবার তুলুন।');
    // WEB-FR-005 — the server's own Bangla detail is preferred over a generic fallback.
    expect(el.textContent).toContain('[server detail]');
  });
});
