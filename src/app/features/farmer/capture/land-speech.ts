import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { APP_CONFIG } from '../../../core/config/app-config';

/**
 * One-shot Bangla dictation for the land step (`DEVIATIONS.md` D-23).
 *
 * **This audio never reaches the submission.** A case carries exactly one audio part and it
 * belongs to the describe step's `VoiceRecorder` clip; what is dictated here is transcribed by
 * the browser, used to pre-fill four number boxes, and thrown away. The server still receives
 * the typed values and still decides `CaseDetail.metricsSource` entirely on its own
 * (`WEB-NFR-001`) — this is a typing aid, nothing more.
 *
 * Page-scoped like `VoiceRecorder`, and it gives the microphone back the same way: a listen that
 * is not stopped by the farmer stops itself after `speech.listenTimeoutMs`, and `DestroyRef`
 * aborts whatever is still open. `setTimeout` rather than `setInterval` — `WEB-FR-356` forbids a
 * repeating timer here and the architecture lint enforces it.
 *
 * `webkitSpeechRecognition` has no types in lib.dom, so the minimum surface this file touches is
 * declared below rather than reached for through `any`.
 */
interface SpeechRecognitionAlternativeLike {
  readonly transcript: string;
}

interface SpeechRecognitionResultLike {
  readonly length: number;
  readonly isFinal: boolean;
  readonly [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionResultListLike {
  readonly length: number;
  readonly [index: number]: SpeechRecognitionResultLike;
}

interface SpeechRecognitionEventLike {
  readonly results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike {
  readonly error: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

interface RecognitionCapableWindow {
  readonly webkitSpeechRecognition?: SpeechRecognitionCtor;
  readonly SpeechRecognition?: SpeechRecognitionCtor;
}

/** Reason codes the farmer is shown one line about, mapped from the platform's own error names. */
export const LAND_SPEECH_NOT_ALLOWED = 'NOT_ALLOWED';
export const LAND_SPEECH_NO_SPEECH = 'NO_SPEECH';
export const LAND_SPEECH_FAILED = 'FAILED';

export type LandSpeechError =
  | typeof LAND_SPEECH_NOT_ALLOWED
  | typeof LAND_SPEECH_NO_SPEECH
  | typeof LAND_SPEECH_FAILED;

const PLATFORM_NOT_ALLOWED = 'not-allowed';
const PLATFORM_SERVICE_NOT_ALLOWED = 'service-not-allowed';
const PLATFORM_NO_SPEECH = 'no-speech';
/** The farmer pressed stop, or we did on the timeout. Silence is the expected outcome. */
const PLATFORM_ABORTED = 'aborted';

const EMPTY = 0;
const FIRST_ALTERNATIVE = 0;
const NO_SEQUENCE = 0;
const NEXT = 1;

/** A finished listen, sequenced so that hearing the same sentence twice still fires the caller. */
export interface LandSpeechHeard {
  readonly seq: number;
  readonly text: string;
}

@Injectable()
export class LandSpeech {
  private readonly _supported = signal(false);
  private readonly _listening = signal(false);
  private readonly _transcript = signal('');
  private readonly _error = signal<LandSpeechError | null>(null);
  private readonly _heard = signal<LandSpeechHeard | null>(null);

  readonly supported = this._supported.asReadonly();
  readonly listening = this._listening.asReadonly();
  /** Interim as well as final, so the farmer sees the words arriving rather than a blank pause. */
  readonly transcript = this._transcript.asReadonly();
  readonly error = this._error.asReadonly();
  readonly heard = this._heard.asReadonly();

  #recogniser: SpeechRecognitionLike | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #sequence = NO_SEQUENCE;

  constructor() {
    const destroyRef = inject(DestroyRef);
    const recogniser = this.#create();
    if (recogniser !== null) {
      this.#recogniser = recogniser;
      this._supported.set(true);
    }

    destroyRef.onDestroy(() => this.#release());
  }

  /** Opens the microphone for one utterance. A second press while listening is ignored. */
  listen(): void {
    const recogniser = this.#recogniser;
    if (recogniser === null || this._listening()) return;

    this._error.set(null);
    this._transcript.set('');
    try {
      recogniser.start();
    } catch {
      // Chrome throws when `start()` races a recogniser that has not finished stopping.
      this._error.set(LAND_SPEECH_FAILED);
      return;
    }
    this._listening.set(true);
    this.#armTimeout();
  }

  stop(): void {
    this.#clearTimeout();
    try {
      this.#recogniser?.stop();
    } catch {
      /* Stopping an idle recogniser is not a failure. */
    }
  }

  #create(): SpeechRecognitionLike | null {
    // Neither constructor is declared in lib.dom, so the widening cast is the honest way to
    // ask for something TypeScript has no knowledge of at all.
    const platform: RecognitionCapableWindow | undefined =
      typeof window === 'undefined' ? undefined : (window as unknown as RecognitionCapableWindow);
    const ctor = platform?.webkitSpeechRecognition ?? platform?.SpeechRecognition;
    if (ctor === undefined) return null;

    let recogniser: SpeechRecognitionLike;
    try {
      recogniser = new ctor();
    } catch {
      return null;
    }

    recogniser.lang = APP_CONFIG.speech.recognitionLang;
    recogniser.maxAlternatives = APP_CONFIG.speech.maxAlternatives;
    recogniser.interimResults = true;
    // One utterance, then hand the microphone back. A continuous recogniser on a phone in a
    // field is an open microphone the farmer has no reason to expect.
    recogniser.continuous = false;

    recogniser.onresult = (event): void => this._transcript.set(joinTranscript(event));
    recogniser.onerror = (event): void => {
      const mapped = mapError(event.error);
      if (mapped !== null) this._error.set(mapped);
    };
    recogniser.onend = (): void => {
      this.#clearTimeout();
      this._listening.set(false);
      const text = this._transcript().trim();
      if (text.length === EMPTY) return;
      this.#sequence += NEXT;
      this._heard.set({ seq: this.#sequence, text });
    };
    return recogniser;
  }

  #armTimeout(): void {
    this.#clearTimeout();
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.stop();
    }, APP_CONFIG.speech.listenTimeoutMs);
  }

  #clearTimeout(): void {
    if (this.#timer === null) return;
    clearTimeout(this.#timer);
    this.#timer = null;
  }

  #release(): void {
    this.#clearTimeout();
    const recogniser = this.#recogniser;
    this.#recogniser = null;
    if (recogniser === null) return;
    recogniser.onresult = null;
    recogniser.onerror = null;
    recogniser.onend = null;
    try {
      recogniser.abort();
    } catch {
      /* Aborting a recogniser that never started is not a failure. */
    }
  }
}

/** Every result so far, best alternative each, in order — interim segments included. */
function joinTranscript(event: SpeechRecognitionEventLike): string {
  const parts: string[] = [];
  for (let index = EMPTY; index < event.results.length; index += NEXT) {
    parts.push(event.results[index][FIRST_ALTERNATIVE].transcript);
  }
  return parts.join('').trim();
}

/** `null` means "nothing the farmer needs to read" — a stop they asked for is not an error. */
function mapError(platformCode: string): LandSpeechError | null {
  if (platformCode === PLATFORM_ABORTED) return null;
  if (platformCode === PLATFORM_NOT_ALLOWED || platformCode === PLATFORM_SERVICE_NOT_ALLOWED) {
    return LAND_SPEECH_NOT_ALLOWED;
  }
  if (platformCode === PLATFORM_NO_SPEECH) return LAND_SPEECH_NO_SPEECH;
  return LAND_SPEECH_FAILED;
}
