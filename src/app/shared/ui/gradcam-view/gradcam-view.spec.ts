import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { GradcamService, GradcamUnavailableError } from '../../../core/media/gradcam.service';
import { SecureMediaService } from '../../../core/media/secure-media.service';
import { GradcamView } from './gradcam-view';

const OVERLAY_URL = 'blob:http://localhost:4200/overlay';

class FakeGradcamService {
  loadCalls = 0;
  revoked: string[] = [];
  /** A flag rather than a stored rejected promise: an eagerly rejected one that nothing has
   *  awaited yet is reported as an unhandled rejection and poisons the whole run. */
  failing = false;

  load(): Promise<string> {
    this.loadCalls += 1;
    return this.failing
      ? Promise.reject(new GradcamUnavailableError(404))
      : Promise.resolve(OVERLAY_URL);
  }

  revoke(url: string | null): void {
    if (url !== null) this.revoked.push(url);
  }
}

class FakeSecureMediaService {
  resolve(): Promise<string> {
    return Promise.resolve('https://store.example/primary.jpg');
  }

  refresh(): Promise<string> {
    return Promise.resolve('https://store.example/primary.jpg');
  }
}

@Component({
  imports: [GradcamView],
  template: `
    <foshol-gradcam-view
      caseId="c-1"
      imageId="i-1"
      imageAlt="ধানের পাতা"
      [hasGradcam]="hasGradcam()"
      (overlayUnavailable)="unavailable = unavailable + 1"
    />
  `,
})
class Host {
  readonly hasGradcam = signal(true);
  unavailable = 0;
}

describe('GradcamView', () => {
  let gradcam: FakeGradcamService;

  const create = async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    return fixture;
  };

  const toggle = (fixture: { nativeElement: HTMLElement }): HTMLButtonElement | null =>
    fixture.nativeElement.querySelector<HTMLButtonElement>('.toggle');

  const overlay = (fixture: { nativeElement: HTMLElement }): HTMLImageElement | null =>
    fixture.nativeElement.querySelector<HTMLImageElement>('.overlay');

  /** The directive treats a held Space as a hold; a quick one is therefore a click. */
  const quickPress = async (fixture: Awaited<ReturnType<typeof create>>): Promise<void> => {
    const button = toggle(fixture);
    button?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    button?.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
    await fixture.whenStable();
  };

  beforeEach(() => {
    gradcam = new FakeGradcamService();
    TestBed.configureTestingModule({
      providers: [
        provideTranslateService(),
        { provide: GradcamService, useValue: gradcam },
        { provide: SecureMediaService, useValue: new FakeSecureMediaService() },
      ],
    });
  });

  /** WEB-FR-211 — the officer sees the photograph first and the model's opinion second. */
  it('defaults the overlay to off', async () => {
    const fixture = await create();

    expect(toggle(fixture)).not.toBeNull();
    expect(overlay(fixture)?.classList.contains('visible')).toBe(false);
    expect(toggle(fixture)?.getAttribute('aria-pressed')).toBe('false');
  });

  /** WEB-FR-212 — hidden, not disabled. D-03: gated on `hasGradcam`, per the frozen schema. */
  it('hides the toggle entirely when the case has no overlay', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.hasGradcam.set(false);
    await fixture.whenStable();

    expect(toggle(fixture)).toBeNull();
    expect(fixture.nativeElement.querySelector('button[disabled]')).toBeNull();
    expect(gradcam.loadCalls).toBe(0);
  });

  /**
   * The known cross-origin risk. If the blob fetch is refused, the control must vanish before
   * the officer ever presses it — a control that does nothing is worse than no control.
   */
  it('hides the toggle and reports when the overlay cannot be fetched', async () => {
    gradcam.failing = true;

    const fixture = await create();

    expect(toggle(fixture)).toBeNull();
    expect(overlay(fixture)).toBeNull();
    expect(fixture.componentInstance.unavailable).toBe(1);
  });

  it('latches the overlay on a quick press and off again on the next', async () => {
    const fixture = await create();

    await quickPress(fixture);
    expect(overlay(fixture)?.classList.contains('visible')).toBe(true);
    expect(toggle(fixture)?.getAttribute('aria-pressed')).toBe('true');

    await quickPress(fixture);
    expect(overlay(fixture)?.classList.contains('visible')).toBe(false);
  });

  /** Hold-to-compare: visible while held, and back to whatever it was on release. */
  it('shows the overlay only while a long press is held', async () => {
    const fixture = await create();
    const button = toggle(fixture);

    button?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await fixture.whenStable();
    expect(overlay(fixture)?.classList.contains('visible')).toBe(true);

    // Push the release past the quick-press window so it reads as a hold, not a click.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5_000);
    button?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    await fixture.whenStable();
    vi.restoreAllMocks();

    expect(overlay(fixture)?.classList.contains('visible')).toBe(false);
    expect(toggle(fixture)?.getAttribute('aria-pressed')).toBe('false');
  });

  /** WEB-UX-042 — the overlay says what it is, and says nothing while it is not shown. */
  it('gives the overlay meaningful alternative text and hides it from AT while off', async () => {
    const fixture = await create();

    expect(overlay(fixture)?.getAttribute('alt')).toBe('media.gradcam.alt');
    expect(overlay(fixture)?.getAttribute('aria-hidden')).toBe('true');

    await quickPress(fixture);
    expect(overlay(fixture)?.getAttribute('aria-hidden')).toBeNull();
  });

  /** WEB-UX-044 — the state is readable as text, not only as a colour. */
  it('states the overlay state in words', async () => {
    const fixture = await create();
    expect(fixture.nativeElement.querySelector('.state')?.textContent?.trim()).toBe(
      'media.gradcam.state.off',
    );
  });

  /** A leaked blob object URL pins the PNG until the tab closes. */
  it('revokes the object URL when destroyed', async () => {
    const fixture = await create();
    fixture.destroy();

    expect(gradcam.revoked).toEqual([OVERLAY_URL]);
  });
});
