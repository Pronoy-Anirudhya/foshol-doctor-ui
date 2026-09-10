import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { BN_CATALOGUE } from '../../../core/i18n/bn-catalogue';
import { provideI18n } from '../../../core/i18n/i18n.providers';
import type { ParsedLandSpeech } from './bangla-quantity';
import { LandStep } from './land-step';
import { LandSpeech, type LandSpeechError, type LandSpeechHeard } from './land-speech';

/**
 * The land step as a farmer meets it, with the recogniser stubbed out — the signal-stub shape
 * `faq-recorder-panel.spec.ts` uses, because jsdom has no `SpeechRecognition` and the engine's
 * own behaviour is covered by `land-speech.spec.ts`.
 *
 * The regression this file exists to prevent: this mic was a tap-to-toggle, and the copy beside
 * it said "hold". If a `click` ever starts a listen again, the first case here fails.
 */
function speechStub() {
  return {
    supported: signal(true),
    listening: signal(false),
    transcript: signal(''),
    error: signal<LandSpeechError | null>(null),
    heard: signal<LandSpeechHeard | null>(null),
    listen: vi.fn(),
    stop: vi.fn(),
  };
}

describe('LandStep — the dictation mic is held, not tapped (DEVIATIONS D-33)', () => {
  let speech: ReturnType<typeof speechStub>;
  let fixture: ComponentFixture<LandStep>;

  async function render(): Promise<HTMLElement> {
    speech = speechStub();
    await TestBed.configureTestingModule({
      imports: [LandStep],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideI18n(),
        { provide: LandSpeech, useValue: speech },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LandStep);
    fixture.componentRef.setInput('fieldAreaUnit', 'DECIMAL');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  afterEach(() => TestBed.resetTestingModule());

  function mic(host: HTMLElement): HTMLButtonElement {
    const button = host.querySelector<HTMLButtonElement>('[data-testid="land-mic"]');
    if (button === null) throw new Error('no land mic rendered');
    return button;
  }

  it('starts on press and stops on release', async () => {
    const host = await render();
    const button = mic(host);

    button.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(speech.listen).toHaveBeenCalledTimes(1);
    expect(speech.stop).not.toHaveBeenCalled();

    button.dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(speech.stop).toHaveBeenCalledTimes(1);
  });

  it('does not listen on a plain click — the toggle is gone', async () => {
    const host = await render();

    mic(host).click();

    expect(speech.listen).not.toHaveBeenCalled();
    expect(speech.stop).not.toHaveBeenCalled();
  });

  it('has an accessible name at last, and a pressed state (WEB-UX-042, WEB-UX-044)', async () => {
    const host = await render();

    expect(mic(host).getAttribute('aria-label')).toBe(
      BN_CATALOGUE['farmer.capture.land.holdLabel'],
    );
    expect(mic(host).getAttribute('aria-pressed')).toBe('false');

    speech.listening.set(true);
    await settle();
    expect(mic(host).getAttribute('aria-pressed')).toBe('true');
  });

  it('announces the listen starting and stopping, not only shows it (WEB-UX-046)', async () => {
    const host = await render();
    const status = () =>
      [...host.querySelectorAll('[role="status"]')].map((node) => node.textContent?.trim());

    expect(status()).toContain(BN_CATALOGUE['farmer.capture.land.speak']);

    speech.listening.set(true);
    await settle();
    expect(status()).toContain(BN_CATALOGUE['farmer.capture.land.listening']);
  });

  it('says the gesture the words describe', async () => {
    const host = await render();

    // The Bangla always said "চেপে ধরে"; the control now matches it rather than the reverse.
    expect(host.querySelector('[data-testid="land-mic-state"]')?.textContent?.trim()).toBe(
      BN_CATALOGUE['farmer.capture.land.speak'],
    );
  });

  it('renders no control at all where the platform has no recogniser (WEB-FR-136/137)', async () => {
    const host = await render();
    speech.supported.set(false);
    await settle();

    expect(host.querySelector('[data-testid="land-mic"]')).toBeNull();
    expect(host.querySelector('[data-testid="land-diagnostic"]')).not.toBeNull();
  });

  it('still pre-fills the boxes from a heard sentence', async () => {
    const host = await render();
    let parsed: ParsedLandSpeech | null = null;
    fixture.componentInstance.prefilled.subscribe((value) => (parsed = value));

    speech.heard.set({ seq: 1, text: 'দশ শতক জমি' });
    await settle();

    expect(parsed).not.toBeNull();
    expect(host.querySelector('[data-testid="land-outcome"]')?.textContent?.trim()).toBe(
      BN_CATALOGUE['farmer.capture.land.applied'],
    );
  });
});
