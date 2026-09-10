import { DestroyRef, inject, Injectable, InjectionToken, signal } from '@angular/core';
import { APP_CONFIG } from '../../../core/config/app-config';

/**
 * Hold-to-talk Bangla dictation for the land step (`DEVIATIONS.md` D-23, amended by D-33).
 *
 * **This audio never reaches the submission.** A case carries exactly one audio part and it
 * belongs to the describe step's `VoiceRecorder` clip; what is dictated here is transcribed by
 * the browser, used to pre-fill four number boxes, and thrown away. The server still receives
 * the typed values and still decides `CaseDetail.metricsSource` entirely on its own
 * (`WEB-NFR-001`) — this is a typing aid, nothing more.
 *
 * The microphone is open exactly while the control is held, which is what makes
 * `continuous = true` safe here: D-23 set it false to avoid "an open microphone the farmer has
 * no reason to expect", and a physical hold is a stricter bound than the timeout that reasoning
 * relied on. It also makes the recogniser behave the way the gesture looks — a farmer who pauses
 * mid-sentence is still holding, so the listen must not end at the pause.
 *
 * Page-scoped like `VoiceRecorder`, and it gives the microphone back the same way: `DestroyRef`
 * aborts whatever is still open, and `speech.listenTimeoutMs` is a leak guard for an engine that
 * never reports its own end — not the thing that normally stops a listen. `setTimeout` rather
 * than `setInterval` — `WEB-FR-356` forbids a repeating timer here and the architecture lint
 * enforces it.
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

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export interface RecognitionCapableWindow {
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
/** The farmer released, or we aborted on the leak guard. Silence is the expected outcome. */
const PLATFORM_ABORTED = 'aborted';

const EMPTY = 0;
const FIRST_ALTERNATIVE = 0;
const NO_SEQUENCE = 0;
const NEXT = 1;
const WORD_GAP = ' ';

/** A finished listen, sequenced so that hearing the same sentence twice still fires the caller. */
export interface LandSpeechHeard {
  readonly seq: number;
  readonly text: string;
}

/**
 * The recogniser constructor, or null where the platform has none.
 *
 * Exported and pure so the state machine below can be tested without a browser: jsdom declares
 * neither constructor, so a spec that could not substitute one could only ever assert the
 * unsupported path. The same seam `voice-recorder.spec.ts` uses for `negotiateAudioMime`.
 */
export function resolveRecognitionCtor(
  platform: RecognitionCapableWindow | undefined,
): SpeechRecognitionCtor | null {
  return platform?.webkitSpeechRecognition ?? platform?.SpeechRecognition ?? null;
}

function defaultRecognitionCtor(): SpeechRecognitionCtor | null {
  // Neither constructor is declared in lib.dom, so the widening cast is the honest way to ask
  // for something TypeScript has no knowledge of at all.
  const platform: RecognitionCapableWindow | undefined =
    typeof window === 'undefined' ? undefined : (window as unknown as RecognitionCapableWindow);
  return resolveRecognitionCtor(platform);
}

/**
 * The platform seam, as an injectable so a spec can hand in a fake engine — the `.port.ts`
 * convention this feature folder already uses for the image raster and the audio resampler.
 */
export const RECOGNITION_CTOR = new InjectionToken<SpeechRecognitionCtor | null>(
  'foshol.landSpeech.recognitionCtor',
  { providedIn: 'root', factory: defaultRecognitionCtor },
);

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
  /** Everything the engine has finalised during THIS hold. Interim text is appended for display. */
  #finalText = '';
  /** `start()` has been acknowledged by `onstart`, so `stop()` will actually reach the engine. */
  #started = false;
  /** The farmer released before the engine started; stop it the moment it does. */
  #stopRequested = false;

  constructor() {
    const destroyRef = inject(DestroyRef);
    const recogniser = this.#create(inject(RECOGNITION_CTOR));
    if (recogniser !== null) {
      this.#recogniser = recogniser;
      this._supported.set(true);
    }

    destroyRef.onDestroy(() => this.#release());
  }

  /**
   * Opens the microphone and keeps it open until `stop()`. Called synchronously from the hold
   * gesture: Safari gates both `start()` and the permission prompt on a user gesture, the same
   * constraint `WEB-FR-142` records for the recorder.
   */
  listen(): void {
    const recogniser = this.#recogniser;
    if (recogniser === null || this._listening()) return;

    this._error.set(null);
    this._transcript.set('');
    this.#finalText = '';
    this.#started = false;
    this.#stopRequested = false;
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

  /**
   * Ends the listen. A release can arrive before the engine has acknowledged the start — a quick
   * press is a few tens of milliseconds and `onstart` is not instant — and stopping an engine
   * that has not started either throws or, worse, lets it start afterwards and stay open. So the
   * stop is remembered and applied from `onstart` instead.
   */
  stop(): void {
    this.#clearTimeout();
    this.#stopRequested = true;
    if (!this.#started) return;
    this.#stopEngine();
  }

  /**
   * Idempotent, like the release paths that reach it: `PointerHoldDirective` can emit one
   * `holdEnd` from several sources, and an engine may announce itself more than once. The
   * request is consumed here so a repeat cannot stop a listen the farmer has since restarted.
   */
  #stopEngine(): void {
    this.#stopRequested = false;
    try {
      this.#recogniser?.stop();
    } catch {
      /* Stopping an idle recogniser is not a failure. */
    }
  }

  #create(ctor: SpeechRecognitionCtor | null): SpeechRecognitionLike | null {
    if (ctor === null) return null;

    let recogniser: SpeechRecognitionLike;
    try {
      recogniser = new ctor();
    } catch {
      return null;
    }

    recogniser.lang = APP_CONFIG.speech.recognitionLang;
    recogniser.maxAlternatives = APP_CONFIG.speech.maxAlternatives;
    recogniser.interimResults = true;
    // Held means listening: a pause mid-sentence must not end the utterance while the farmer
    // still has a finger on the button (D-33). The hold is what closes the microphone.
    recogniser.continuous = true;

    recogniser.onstart = (): void => {
      this.#started = true;
      // Released during the start; honour it now that there is an engine to stop.
      if (this.#stopRequested) this.#stopEngine();
    };
    recogniser.onresult = (event): void => this.#collect(event);
    recogniser.onerror = (event): void => {
      const mapped = mapError(event.error);
      if (mapped !== null) this._error.set(mapped);
    };
    recogniser.onend = (): void => {
      this.#clearTimeout();
      this.#started = false;
      this.#stopRequested = false;
      this._listening.set(false);
      const text = this._transcript().trim();
      if (text.length === EMPTY) return;
      this.#sequence += NEXT;
      this._heard.set({ seq: this.#sequence, text });
    };
    return recogniser;
  }

  /**
   * One hold is one sentence, however the engine chooses to cut it up.
   *
   * Finalised segments are accumulated here rather than re-read from `event.results` on each
   * event: engines disagree about whether that list stays cumulative for a continuous session,
   * and a segment counted twice would put the farmer's words on screen twice. Interim text is
   * shown after the finalised text and replaced as it firms up.
   */
  #collect(event: SpeechRecognitionEventLike): void {
    const interim: string[] = [];
    for (let index = EMPTY; index < event.results.length; index += NEXT) {
      const result = event.results[index];
      const text = result[FIRST_ALTERNATIVE].transcript.trim();
      if (text.length === EMPTY) continue;
      if (result.isFinal) this.#finalText = join(this.#finalText, text);
      else interim.push(text);
    }
    this._transcript.set(join(this.#finalText, interim.join(WORD_GAP)));
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
    recogniser.onstart = null;
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

/** Bangla words run together without this; an empty side must not leave a leading space. */
function join(left: string, right: string): string {
  if (left.length === EMPTY) return right;
  if (right.length === EMPTY) return left;
  return `${left}${WORD_GAP}${right}`;
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
