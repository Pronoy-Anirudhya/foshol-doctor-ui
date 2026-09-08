import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
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
import { FARMER_PATHS } from './farmer-paths';
import { IMAGE_RASTER } from './image-raster.port';
import { VoiceRecorder } from './voice-recorder';

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

  it('renders crops as icon tiles and NO <select> in the crop step (AC-02, WEB-FR-100)', async () => {
    await setUp([passingImage()]);

    expect(el().querySelectorAll('[data-testid="crop-tile"]').length).toBe(crops.length);
    // Scoped to the crop step: the field-metrics step below owns two unit dropdowns, and
    // AC-02 is about how a CROP is chosen, not about the word `select` appearing on the page.
    const cropStep = el().querySelector('[aria-labelledby="step-crop"]');
    expect(cropStep).not.toBeNull();
    expect(cropStep!.querySelector('select')).toBeNull();
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

const FIELD_AREA = 2;

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

    // Required by the multipart contract; without it the button never enables.
    draft.setFieldArea(FIELD_AREA);
    fixture.detectChanges();
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
    // The two parts the server now requires, and the optional pair left off entirely.
    expect(body.get('fieldArea')).toBe(String(FIELD_AREA));
    expect(body.get('fieldAreaUnit')).toBe(APP_CONFIG.intake.metrics.defaultFieldAreaUnit);
    expect(body.has('cropQuantity')).toBe(false);
    expect(body.has('cropQuantityUnit')).toBe(false);
    // Region is an identity attribute: the server copies it from the farmer and ignores any
    // client value. A UI that sent one would be claiming a case belongs to a district the
    // server has not agreed to, so the parts must be absent rather than merely ignored.
    expect(body.has('districtCode')).toBe(false);
    expect(body.has('divisionCode')).toBe(false);
    // And nothing geographic reached the request under any other spelling.
    expect([...body.keys()].filter((k) => /district|division|region/i.test(k))).toEqual([]);
    // WEB-DATA-005 — the key was minted for this attempt, not before the content settled.
    expect(key).toBeNull();

    request.flush({ caseId: CASE_ID, status: 'SUBMITTED' }, { status: 202, statusText: 'Accepted' });
    await fixture.whenStable();
  });

  it('refuses to send without a field area, and says why', async () => {
    await setUpWithOneImage();
    draft.setFieldArea(null);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(submitButton().disabled).toBe(true);
    submitButton().click();
    await fixture.whenStable();

    // Nothing left for the server to reject: the 400 is prevented, not handled.
    expect(http.match(SUBMIT_URL)).toEqual([]);

    const hint = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="capture-submit-hint"]',
    );
    expect(hint?.textContent?.trim()).toBe(BN_CATALOGUE['farmer.capture.submit.needArea']);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="field-area-error"]'),
    ).not.toBeNull();
  });

  it('sends the optional crop quantity only when both the number and its unit are given', async () => {
    await setUpWithOneImage();
    // A number without a unit is not a quantity the server can use, so neither part goes.
    draft.setCropQuantity(40);
    fixture.detectChanges();
    await fixture.whenStable();

    submitButton().click();
    await fixture.whenStable();
    const withoutUnit = http.expectOne(SUBMIT_URL);
    expect((withoutUnit.request.body as FormData).has('cropQuantity')).toBe(false);
    withoutUnit.flush(null, { status: 0, statusText: 'Network error' });
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();

    draft.setCropQuantityUnit('KG');
    fixture.detectChanges();
    await fixture.whenStable();

    submitButton().click();
    await fixture.whenStable();
    const request = http.expectOne(SUBMIT_URL);
    const body = request.request.body as FormData;
    expect(body.get('cropQuantity')).toBe('40');
    expect(body.get('cropQuantityUnit')).toBe('KG');

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

/**
 * The way out. A farmer who has changed their mind had only browser navigation, which leaves a
 * populated draft behind; cancel discards it deliberately (`WEB-DATA-022`) and hands the
 * microphone back (`WEB-FR-145`). The confirmation is inline rather than `window.confirm`, so
 * it is assertable in the DOM like every other control on this page.
 */
describe('CapturePage — cancel (WEB-DATA-022, WEB-FR-145)', () => {
  let fixture: ComponentFixture<CapturePage>;
  let http: HttpTestingController;
  let draft: CaseDraftStore;
  let recorder: VoiceRecorder;
  let navigate: ReturnType<typeof vi.spyOn>;

  async function setUp(withContent: boolean): Promise<void> {
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
    // The router has no routes here, and where it goes is asserted rather than performed.
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    fixture = TestBed.createComponent(CapturePage);
    // Page-scoped provider (`WEB-FR-145`), so it is reachable only through the component.
    recorder = fixture.debugElement.injector.get(VoiceRecorder);
    fixture.detectChanges();
    http.expectOne(CROPS_URL).flush(crops);
    await fixture.whenStable();

    if (!withContent) return;

    draft.chooseCrop(crops[0]!.id);
    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      '[data-testid="capture-file-input"]',
    );
    Object.defineProperty(input, 'files', { value: [image.blob], configurable: true });
    input!.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve));
    draft.setFieldArea(FIELD_AREA);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  afterEach(() => {
    http.verify();
  });

  function cancelButton(): HTMLButtonElement {
    return (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[data-testid="capture-cancel"]',
    )!;
  }

  function prompt(): Element | null {
    return (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="capture-cancel-prompt"]',
    );
  }

  async function press(button: HTMLButtonElement): Promise<void> {
    button.click();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it('asks first and destroys nothing on the first press', async () => {
    await setUp(true);
    expect(draft.hasContent()).toBe(true);
    const idleLabel = cancelButton().textContent?.trim();

    await press(cancelButton());

    // Inline, in the document — not a `window.confirm` the DOM cannot see (nor the farmer's
    // browser style). The wording itself is asserted by the i18n parity gate, not here.
    expect(prompt()).not.toBeNull();
    expect(prompt()?.getAttribute('role')).toBe('alert');
    // The point of the two-step: after one press the work is still there.
    expect(draft.imageCount()).toBe(1);
    expect(draft.cropId()).toBe(crops[0]!.id);
    expect(navigate).not.toHaveBeenCalled();
    // WEB-UX-044 — the armed state changes the word, not only the colour.
    expect(cancelButton().textContent?.trim()).not.toBe(idleLabel);
  });

  it('backs out of the confirmation with "keep editing", leaving the draft intact', async () => {
    await setUp(true);
    await press(cancelButton());

    const keep = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[data-testid="capture-cancel-keep"]',
    );
    await press(keep!);

    expect(prompt()).toBeNull();
    expect(draft.imageCount()).toBe(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('discards the draft, frees the microphone and leaves on the second press', async () => {
    await setUp(true);
    const released = vi.spyOn(recorder, 'releaseMicrophone');

    await press(cancelButton());
    await press(cancelButton());

    // WEB-DATA-022 — the store revokes every preview URL and clears the persisted draft.
    expect(draft.imageCount()).toBe(0);
    expect(draft.cropId()).toBeNull();
    expect(draft.hasContent()).toBe(false);
    // WEB-FR-145 — otherwise the recorder keeps the microphone open on a page nobody is on.
    expect(released).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(FARMER_PATHS.casesList);
    // Cancelling talks to nobody; the case was never created.
    expect(http.match(SUBMIT_URL)).toEqual([]);
  });

  it('leaves immediately when there is nothing to lose', async () => {
    await setUp(false);
    expect(draft.hasContent()).toBe(false);

    await press(cancelButton());

    expect(prompt()).toBeNull();
    expect(navigate).toHaveBeenCalledWith(FARMER_PATHS.casesList);
  });

  it('is disabled while a submission is in flight, and live again once it fails', async () => {
    await setUp(true);

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-testid="capture-submit"]')!
      .click();
    await fixture.whenStable();
    fixture.detectChanges();

    // There is no abort handle behind the generated client, and the server may already have
    // created the case — so cancel refuses rather than lying about what it undid.
    expect(cancelButton().disabled).toBe(true);
    const request = http.expectOne(SUBMIT_URL);
    await press(cancelButton());
    expect(prompt()).toBeNull();
    expect(navigate).not.toHaveBeenCalled();

    request.flush(null, { status: 0, statusText: 'Network error' });
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();

    // The attempt failed, the draft is the farmer's again, so the way out comes back.
    expect(cancelButton().disabled).toBe(false);
  });
});
