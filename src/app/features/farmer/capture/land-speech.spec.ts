import { Injector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_CONFIG } from '../../../core/config/app-config';
import {
  LAND_SPEECH_FAILED,
  LAND_SPEECH_NOT_ALLOWED,
  LAND_SPEECH_NO_SPEECH,
  LandSpeech,
  RECOGNITION_CTOR,
  resolveRecognitionCtor,
  type SpeechRecognitionCtor,
  type SpeechRecognitionLike,
} from './land-speech';

/**
 * The dictation is press-and-hold (`DEVIATIONS.md` D-33), and holding introduces two failure
 * modes a toggle never had: a release that arrives before the engine has started, and a pause
 * mid-sentence that must NOT end the utterance. Both are asserted here.
 *
 * jsdom declares neither `SpeechRecognition` nor `webkitSpeechRecognition`, so the service is
 * driven through its `RECOGNITION_CTOR` seam with a fake engine whose handlers the test fires by
 * hand. Real Bangla recognition quality, actual engine segmentation and the OS permission sheet
 * remain manual (`WEB-TEST-009`).
 */
class FakeRecogniser implements SpeechRecognitionLike {
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  onstart: (() => void) | null = null;
  onresult: ((event: { results: FakeResults }) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;

  readonly calls: string[] = [];

  start(): void {
    this.calls.push('start');
  }
  stop(): void {
    this.calls.push('stop');
  }
  abort(): void {
    this.calls.push('abort');
  }

  /** Everything the engine has produced so far, the way a continuous session reports it. */
  emit(segments: readonly { text: string; final: boolean }[]): void {
    this.onresult?.({ results: results(segments) });
  }
  countOf(call: string): number {
    return this.calls.filter((entry) => entry === call).length;
  }
}

interface FakeResults {
  readonly length: number;
  readonly [index: number]: { length: number; isFinal: boolean; [i: number]: { transcript: string } };
}

function results(segments: readonly { text: string; final: boolean }[]): FakeResults {
  const list: Record<string, unknown> = { length: segments.length };
  segments.forEach((segment, index) => {
    list[String(index)] = { length: 1, isFinal: segment.final, 0: { transcript: segment.text } };
  });
  return list as unknown as FakeResults;
}

describe('LandSpeech — hold-to-talk dictation (DEVIATIONS D-33)', () => {
  let engine: FakeRecogniser;
  let injector: Injector;

  function make(): LandSpeech {
    return runInInjectionContext(injector, () => new LandSpeech());
  }

  beforeEach(() => {
    engine = new FakeRecogniser();
    const ctor = function FakeCtor(this: unknown) {
      return engine;
    } as unknown as SpeechRecognitionCtor;

    TestBed.configureTestingModule({
      providers: [{ provide: RECOGNITION_CTOR, useValue: ctor }],
    });
    injector = TestBed.inject(Injector);
  });

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('configures the engine to keep listening, because the hold is what ends it', () => {
    make();

    expect(engine.continuous).toBe(true);
    expect(engine.interimResults).toBe(true);
    expect(engine.lang).toBe(APP_CONFIG.speech.recognitionLang);
  });

  it('opens the microphone on press and closes it on release', () => {
    const speech = make();

    speech.listen();
    engine.onstart?.();
    expect(speech.listening()).toBe(true);
    expect(engine.countOf('start')).toBe(1);

    speech.stop();
    expect(engine.countOf('stop')).toBe(1);
  });

  it('ignores a second press while already listening', () => {
    const speech = make();

    speech.listen();
    engine.onstart?.();
    speech.listen();

    expect(engine.countOf('start')).toBe(1);
  });

  // The failure a hold gesture introduces and a toggle never could.
  it('defers a release that beats the engine to the start, instead of stopping nothing', () => {
    const speech = make();

    speech.listen();
    // The farmer let go after ~80ms; `onstart` has not fired yet.
    speech.stop();
    expect(engine.countOf('stop')).toBe(0);

    engine.onstart?.();
    // The engine is up, so the deferred stop lands now — exactly once.
    expect(engine.countOf('stop')).toBe(1);
  });

  it('does not double-stop when the release lands after the start', () => {
    const speech = make();

    speech.listen();
    engine.onstart?.();
    speech.stop();
    engine.onstart?.();

    expect(engine.countOf('stop')).toBe(1);
  });

  it('keeps both halves of a sentence spoken either side of a pause', () => {
    const speech = make();
    speech.listen();
    engine.onstart?.();

    engine.emit([{ text: 'দশ শতক জমি', final: true }]);
    engine.emit([{ text: 'দুইশ কেজি ফসল', final: true }]);

    // Space-joined: without it the Bangla words run together into one unparseable token.
    expect(speech.transcript()).toBe('দশ শতক জমি দুইশ কেজি ফসল');
  });

  it('shows interim words as they arrive and does not keep them once they firm up', () => {
    const speech = make();
    speech.listen();
    engine.onstart?.();

    engine.emit([{ text: 'দশ শতক', final: false }]);
    expect(speech.transcript()).toBe('দশ শতক');

    engine.emit([{ text: 'দশ শতক জমি', final: true }]);
    expect(speech.transcript()).toBe('দশ শতক জমি');
  });

  it('publishes the whole hold once, sequenced, when the engine ends', () => {
    const speech = make();
    speech.listen();
    engine.onstart?.();
    engine.emit([{ text: 'দশ শতক জমি', final: true }]);

    engine.onend?.();

    expect(speech.listening()).toBe(false);
    expect(speech.heard()).toEqual({ seq: 1, text: 'দশ শতক জমি' });
  });

  it('starts each hold from silence rather than appending to the last one', () => {
    const speech = make();
    speech.listen();
    engine.onstart?.();
    engine.emit([{ text: 'প্রথম', final: true }]);
    engine.onend?.();

    speech.listen();
    engine.onstart?.();
    engine.emit([{ text: 'দ্বিতীয়', final: true }]);

    expect(speech.transcript()).toBe('দ্বিতীয়');
  });

  it('says nothing when a press was too short to capture words', () => {
    const speech = make();
    speech.listen();
    speech.stop();
    engine.onstart?.();

    engine.onend?.();

    expect(speech.heard()).toBeNull();
    expect(speech.error()).toBeNull();
  });

  it.each([
    ['not-allowed', LAND_SPEECH_NOT_ALLOWED],
    ['service-not-allowed', LAND_SPEECH_NOT_ALLOWED],
    ['no-speech', LAND_SPEECH_NO_SPEECH],
    ['audio-capture', LAND_SPEECH_FAILED],
  ])('turns the platform code %s into one line the farmer can read', (code, expected) => {
    const speech = make();
    speech.listen();

    engine.onerror?.({ error: code });

    expect(speech.error()).toBe(expected);
  });

  it('treats a release as a release, not as an error', () => {
    const speech = make();
    speech.listen();

    engine.onerror?.({ error: 'aborted' });

    expect(speech.error()).toBeNull();
  });

  it('holds the microphone no longer than one recording, as a leak guard', () => {
    vi.useFakeTimers();
    const speech = make();
    speech.listen();
    engine.onstart?.();

    vi.advanceTimersByTime(APP_CONFIG.speech.listenTimeoutMs);

    expect(engine.countOf('stop')).toBe(1);
    // The guard matches the recorder's cap, so one hold means one maximum everywhere.
    expect(APP_CONFIG.speech.listenTimeoutMs).toBe(
      APP_CONFIG.intake.maxAudioSeconds * APP_CONFIG.ui.msPerSecond,
    );
  });

  it('reports itself unusable rather than rendering a control that cannot work', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: RECOGNITION_CTOR, useValue: null }],
    });
    const speech = runInInjectionContext(TestBed.inject(Injector), () => new LandSpeech());

    expect(speech.supported()).toBe(false);
  });

  describe('resolveRecognitionCtor', () => {
    it('prefers the prefixed constructor, which is the one Chromium actually ships', () => {
      const prefixed = {} as SpeechRecognitionCtor;
      const standard = {} as SpeechRecognitionCtor;

      expect(
        resolveRecognitionCtor({ webkitSpeechRecognition: prefixed, SpeechRecognition: standard }),
      ).toBe(prefixed);
    });

    it('falls back to the standard name, and to null where there is neither', () => {
      const standard = {} as SpeechRecognitionCtor;

      expect(resolveRecognitionCtor({ SpeechRecognition: standard })).toBe(standard);
      expect(resolveRecognitionCtor({})).toBeNull();
      expect(resolveRecognitionCtor(undefined)).toBeNull();
    });
  });
});
