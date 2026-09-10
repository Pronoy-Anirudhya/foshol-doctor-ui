import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal, type Signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { BN_CATALOGUE } from '../../../core/i18n/bn-catalogue';
import { provideI18n } from '../../../core/i18n/i18n.providers';
import type { DraftAudio } from '../../../core/stores/case-draft-store';
import {
  MIC_DENIED,
  MIC_INSECURE,
  MIC_NO_DEVICE,
  MIC_READY,
  VoiceRecorder,
  type MicStatus,
} from '../capture/voice-recorder';
import { FaqRecorderPanel } from './faq-recorder-panel';

/**
 * jsdom has no `MediaRecorder`, no `getUserMedia` and no `AudioContext`, so the recorder itself
 * is stubbed and what is asserted here is the SHAPE the panel gives to each state — which is
 * the part a farmer sees and the part that regresses.
 *
 * The same scoping choice `voice-recorder.spec.ts` makes: the permission lifecycle is verified
 * by hand in a real browser, and the states it produces are verified here.
 */
interface RecorderStub {
  status: Signal<MicStatus>;
  available: Signal<boolean>;
  recording: Signal<boolean>;
  preparing: Signal<boolean>;
  elapsedMs: Signal<number>;
  elapsedSeconds: Signal<number>;
  clip: Signal<DraftAudio | null>;
  clipUrl: Signal<string | null>;
  analyser: Signal<AnalyserNode | null>;
  press(): void;
  release(): void;
  discard(): void;
}

function stub(overrides: Partial<Record<string, unknown>> = {}): RecorderStub {
  const status = signal<MicStatus>(MIC_READY);
  return {
    status,
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
    ...overrides,
  } as RecorderStub;
}

describe('FaqRecorderPanel — the three states, and the one that hides itself', () => {
  let recorder: RecorderStub;

  async function render(
    overrides: Partial<Record<string, unknown>> = {},
    inputs: { disabled?: boolean; busy?: boolean } = {},
  ): Promise<{ host: HTMLElement; fixture: ComponentFixture<FaqRecorderPanel> }> {
    recorder = stub(overrides);
    await TestBed.configureTestingModule({
      imports: [FaqRecorderPanel],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideI18n(),
        { provide: VoiceRecorder, useValue: recorder },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(FaqRecorderPanel);
    fixture.componentRef.setInput('disabled', inputs.disabled ?? false);
    fixture.componentRef.setInput('busy', inputs.busy ?? false);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { host: fixture.nativeElement as HTMLElement, fixture };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('state A · offers one large control when the microphone can work', async () => {
    const { host } = await render();
    const button = host.querySelector<HTMLButtonElement>('[data-testid="faq-record-button"]');

    expect(button).not.toBeNull();
    // WEB-UX-021 — thumb-sized, not a 24 px icon button.
    expect(button?.classList.contains('touch-target-lg')).toBe(true);
    expect(button?.getAttribute('aria-pressed')).toBe('false');
    expect(host.querySelector('[data-testid="faq-recorder-state"]')?.textContent?.trim()).toBe(
      BN_CATALOGUE['farmer.faq.mic.idle'],
    );
  });

  it('state B · says it is recording by pressed state and by words, not by colour', async () => {
    const { host } = await render({ recording: signal(true), elapsedSeconds: signal(7) });
    const button = host.querySelector<HTMLButtonElement>('[data-testid="faq-record-button"]');

    expect(button?.getAttribute('aria-pressed')).toBe('true');
    expect(button?.getAttribute('data-recording')).toBe('true');
    expect(host.querySelector('[data-testid="faq-recorder-state"]')?.textContent?.trim()).toBe(
      BN_CATALOGUE['farmer.faq.mic.recording'],
    );
    // The live counter is the recorder's own; nothing here runs a timer (WEB-FR-356).
    expect(host.textContent).toContain('7');
  });

  it('state C · goes inert while the question is in flight, which is the double-submit guard', async () => {
    const audio: DraftAudio = { blob: new Blob(), durationMs: 900, mimeType: 'audio/wav' };
    const { host } = await render(
      { clip: signal(audio), clipUrl: signal('blob:x') },
      { busy: true },
    );

    const ask = host.querySelector<HTMLButtonElement>('[data-testid="faq-ask-button"]');
    expect(ask?.disabled).toBe(true);
    expect(
      host.querySelector<HTMLButtonElement>('[data-testid="faq-discard-button"]')?.disabled,
    ).toBe(true);
    expect(
      host.querySelector('[data-testid="faq-record-button"]')?.getAttribute('aria-busy'),
    ).toBe('true');
  });

  it('offers playback and a re-record once a clip exists', async () => {
    const audio: DraftAudio = { blob: new Blob(), durationMs: 900, mimeType: 'audio/wav' };
    const { host } = await render({ clip: signal(audio), clipUrl: signal('blob:x') });

    expect(host.querySelector('[data-testid="faq-recorder-clip"] audio')).not.toBeNull();
    expect(host.querySelector('[data-testid="faq-discard-button"]')).not.toBeNull();
  });

  it('emits the clip rather than the raw blob, so the caller sends what was normalised', async () => {
    const audio: DraftAudio = { blob: new Blob(), durationMs: 900, mimeType: 'audio/wav' };
    const { host, fixture } = await render({ clip: signal(audio), clipUrl: signal('blob:x') });

    let emitted: DraftAudio | null = null;
    fixture.componentInstance.ask.subscribe((value: DraftAudio) => (emitted = value));
    host.querySelector<HTMLButtonElement>('[data-testid="faq-ask-button"]')?.click();

    expect(emitted).toBe(audio);
  });

  it('refuses to record before a crop is chosen, and says why', async () => {
    const { host } = await render({}, { disabled: true });

    expect(
      host.querySelector('[data-testid="faq-record-button"]')?.getAttribute('aria-disabled'),
    ).toBe('true');
    expect(host.querySelector('[data-testid="faq-recorder-hint"]')?.textContent?.trim()).toBe(
      BN_CATALOGUE['farmer.faq.mic.pickCropFirst'],
    );
  });

  it.each([
    [MIC_DENIED, 'farmer.faq.mic.diagnostic.DENIED'],
    [MIC_INSECURE, 'farmer.faq.mic.diagnostic.INSECURE'],
    [MIC_NO_DEVICE, 'farmer.faq.mic.diagnostic.NO_DEVICE'],
  ])(
    'hides the control entirely on %s and names the cause in one line (WEB-FR-136/137/139)',
    async (status, key) => {
      const { host } = await render({
        status: signal(status as MicStatus),
        available: signal(false),
      });

      // A control that cannot work reads as a broken app; the typed list is the way forward.
      expect(host.querySelector('[data-testid="faq-record-button"]')).toBeNull();
      expect(host.querySelector('[data-testid="faq-recorder-diagnostic"]')?.textContent?.trim()).toBe(
        BN_CATALOGUE[key],
      );
    },
  );
});
