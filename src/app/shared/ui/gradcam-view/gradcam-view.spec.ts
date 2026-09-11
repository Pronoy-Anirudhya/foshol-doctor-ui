import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { toProblemView } from '../../../core/errors/problem';
import {
  CaseImageContentService,
  type CaseImageVariant,
} from '../../../core/media/case-image-content.service';
import {
  GradcamFailedError,
  GradcamService,
  GradcamUnavailableError,
} from '../../../core/media/gradcam.service';
import { GradcamView } from './gradcam-view';

const OVERLAY_URL = 'blob:http://localhost:4200/overlay';
const PHOTO_URL = 'blob:http://localhost:4200/photo';
const CORRELATION_ID = '01a07caa-d705-7ad0-a51b-f334668c9f99';

const STORAGE_DOWN = toProblemView(
  new HttpErrorResponse({
    status: 503,
    error: {
      status: 503,
      code: 'ERR_STORAGE_UNAVAILABLE',
      title: 'Service Unavailable',
      detail: 'Object store is unavailable.',
      correlationId: CORRELATION_ID,
    },
  }),
);

class FakeGradcamService {
  loadCalls = 0;
  revoked: string[] = [];
  /** A mode rather than a stored rejected promise: an eagerly rejected one that nothing has
   *  awaited yet is reported as an unhandled rejection and poisons the whole run. */
  mode: 'ok' | 'missing' | 'failed' = 'ok';

  load(): Promise<string> {
    this.loadCalls += 1;
    if (this.mode === 'missing') return Promise.reject(new GradcamUnavailableError(404));
    if (this.mode === 'failed') return Promise.reject(new GradcamFailedError(STORAGE_DOWN));
    return Promise.resolve(OVERLAY_URL);
  }

  revoke(url: string | null): void {
    if (url !== null) this.revoked.push(url);
  }
}

class FakeContent {
  readonly variants: CaseImageVariant[] = [];

  load(_caseId: string, _imageId: string, variant: CaseImageVariant): Promise<string> {
    this.variants.push(variant);
    return Promise.resolve(PHOTO_URL);
  }

  revoke(): void {
    /* The photograph's own lifetime is `case-photo.spec.ts`'s business. */
  }
}

@Component({
  imports: [GradcamView],
  template: `
    <foshol-gradcam-view
      caseId="c-1"
      imageAlt="ধানের পাতা"
      [imageId]="imageId()"
      [isPrimary]="isPrimary()"
      [overlayAvailable]="overlayAvailable()"
      (overlayUnavailable)="unavailable = unavailable + 1"
    />
  `,
})
class Host {
  readonly imageId = signal('i-1');
  readonly isPrimary = signal(true);
  readonly overlayAvailable = signal(true);
  unavailable = 0;
}

describe('GradcamView (WEB-FR-210…212)', () => {
  let gradcam: FakeGradcamService;
  let content: FakeContent;

  const create = async (): Promise<ComponentFixture<Host>> => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    return fixture;
  };

  const root = (fixture: ComponentFixture<Host>): HTMLElement =>
    fixture.nativeElement as HTMLElement;

  const toggle = (fixture: ComponentFixture<Host>): HTMLButtonElement | null =>
    root(fixture).querySelector<HTMLButtonElement>('.toggle');

  const overlay = (fixture: ComponentFixture<Host>): HTMLImageElement | null =>
    root(fixture).querySelector<HTMLImageElement>('.overlay');

  const press = async (fixture: ComponentFixture<Host>): Promise<void> => {
    toggle(fixture)?.click();
    await fixture.whenStable();
  };

  beforeEach(() => {
    gradcam = new FakeGradcamService();
    content = new FakeContent();
    TestBed.configureTestingModule({
      providers: [
        provideTranslateService(),
        { provide: GradcamService, useValue: gradcam },
        { provide: CaseImageContentService, useValue: content },
      ],
    });
  });

  /** WEB-FR-211 — the officer sees the photograph first and the model's opinion second. */
  it('defaults the overlay to off', async () => {
    const fixture = await create();

    expect(toggle(fixture)).not.toBeNull();
    expect(toggle(fixture)?.getAttribute('aria-pressed')).toBe('false');
    expect(overlay(fixture)?.classList.contains('visible')).toBe(false);
  });

  /** WEB-FR-210 — the officer's view is the photograph as the farmer took it. */
  it('shows the original photograph, not the derivative', async () => {
    await create();

    expect(content.variants).toEqual(['ORIGINAL']);
  });

  /** WEB-FR-212 — hidden, not disabled, and `/gradcam` is not even asked. */
  it('offers no toggle and never fetches when the case has no overlay', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.overlayAvailable.set(false);
    await fixture.whenStable();

    expect(toggle(fixture)).toBeNull();
    // Not a disabled toggle either. (The zoom-out button is disabled at fit, and is not ours.)
    expect(root(fixture).querySelector('button[aria-pressed]')).toBeNull();
    expect(gradcam.loadCalls).toBe(0);
  });

  it('turns the overlay on with a press, and off again with the next', async () => {
    const fixture = await create();

    await press(fixture);
    expect(toggle(fixture)?.getAttribute('aria-pressed')).toBe('true');
    expect(overlay(fixture)?.classList.contains('visible')).toBe(true);

    await press(fixture);
    expect(toggle(fixture)?.getAttribute('aria-pressed')).toBe('false');
    expect(overlay(fixture)?.classList.contains('visible')).toBe(false);
  });

  /** WEB-UX-040 — a native button, so Enter and Space press it with no extra wiring. */
  it('is a native button, and so keyboard operable', async () => {
    const fixture = await create();

    expect(toggle(fixture)?.tagName).toBe('BUTTON');
    expect(toggle(fixture)?.getAttribute('type')).toBe('button');
  });

  /** A zoomed viewport captures the pointer; a toggle inside it could not be pressed. */
  it('sits in the zoom bar, not inside the pannable viewport', async () => {
    const fixture = await create();

    expect(root(fixture).querySelector('foshol-image-zoom .bar .toggle')).not.toBeNull();
    expect(root(fixture).querySelector('.viewport .toggle')).toBeNull();
    expect(root(fixture).querySelector('.viewport .overlay')).not.toBeNull();
  });

  /** The Grad-CAM was computed for the primary photograph and says nothing about the others. */
  it('offers neither toggle nor overlay on any image but the primary', async () => {
    const fixture = await create();
    await press(fixture);

    fixture.componentInstance.imageId.set('i-2');
    fixture.componentInstance.isPrimary.set(false);
    await fixture.whenStable();
    expect(toggle(fixture)).toBeNull();
    expect(overlay(fixture)).toBeNull();

    fixture.componentInstance.imageId.set('i-1');
    fixture.componentInstance.isPrimary.set(true);
    await fixture.whenStable();
    expect(toggle(fixture)?.getAttribute('aria-pressed')).toBe('false');
  });

  it('fetches the overlay once for the whole case view, across thumbnails', async () => {
    const fixture = await create();

    fixture.componentInstance.imageId.set('i-2');
    fixture.componentInstance.isPrimary.set(false);
    await fixture.whenStable();
    fixture.componentInstance.imageId.set('i-1');
    fixture.componentInstance.isPrimary.set(true);
    await fixture.whenStable();

    expect(gradcam.loadCalls).toBe(1);
  });

  /** A 404 is "no overlay": no control, and nothing to apologise for. */
  it('hides the toggle and reports when the case turns out to have no overlay', async () => {
    gradcam.mode = 'missing';
    const fixture = await create();

    expect(toggle(fixture)).toBeNull();
    expect(overlay(fixture)).toBeNull();
    expect(root(fixture).querySelector('foshol-error-panel')).toBeNull();
    expect(fixture.componentInstance.unavailable).toBe(1);
  });

  /** WEB-FR-005 — a storage outage says so, and the photograph stays. */
  it('shows the problem and keeps the photograph when the overlay cannot be served', async () => {
    gradcam.mode = 'failed';
    const fixture = await create();

    expect(toggle(fixture)).toBeNull();
    expect(root(fixture).querySelector('foshol-error-panel')).not.toBeNull();
    expect(root(fixture).querySelector('foshol-case-photo')).not.toBeNull();
    expect(fixture.componentInstance.unavailable).toBe(1);
  });

  /** WEB-UX-042 — the overlay says what it is, and says nothing while it is not shown. */
  it('gives the overlay meaningful alternative text and hides it from AT while off', async () => {
    const fixture = await create();

    expect(overlay(fixture)?.getAttribute('alt')).toBe('media.gradcam.alt');
    expect(overlay(fixture)?.getAttribute('aria-hidden')).toBe('true');

    await press(fixture);
    expect(overlay(fixture)?.getAttribute('aria-hidden')).toBeNull();
  });

  /** WEB-UX-044 — the state is readable as text, not only as a colour. */
  it('states the overlay state in words, and that it is not a diagnosis', async () => {
    const fixture = await create();

    expect(root(fixture).querySelector('.state')?.textContent?.trim()).toBe(
      'media.gradcam.state.off',
    );
    expect(root(fixture).querySelector('.note')?.textContent?.trim()).toBe('media.gradcam.note');
  });

  /** A leaked blob object URL pins the PNG until the tab closes. */
  it('revokes the overlay object URL when destroyed', async () => {
    const fixture = await create();
    fixture.destroy();

    expect(gradcam.revoked).toEqual([OVERLAY_URL]);
  });
});
