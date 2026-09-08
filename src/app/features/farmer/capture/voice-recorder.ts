import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { APP_CONFIG } from '../../../core/config/app-config';
import type { DraftAudio } from '../../../core/stores/case-draft-store';
import { AudioNormaliser } from './audio-normaliser';

/**
 * Hold-to-record, on a laptop microphone in a browser and on a phone in a field.
 *
 * There is **no client-side ASR here**. Whisper runs server-side in the Python sidecar; this
 * captures microphone audio, normalises it (`audio-normaliser.ts`) and hands it to the
 * submission. `WEB-FR-913` is explicitly out of scope.
 *
 * The gesture itself belongs to `PointerHoldDirective` (`WEB-FR-143`/`144`); this service owns
 * the microphone, and every requirement it carries is about giving the microphone back:
 *
 *  - `WEB-FR-133` — the cap stops the recording and KEEPS what was captured.
 *  - `WEB-FR-144` — so does a hidden page.
 *  - `WEB-FR-145` — every exit path stops every track. A live track leaves the phone's
 *    recording indicator lit, which looks to a farmer, correctly, like the app is listening.
 */

export const MIC_READY = 'READY';
/** `getUserMedia` exists only in a secure context; a phone on an http:// LAN address has none. */
export const MIC_INSECURE = 'INSECURE';
export const MIC_UNSUPPORTED = 'UNSUPPORTED';
export const MIC_NO_CONTAINER = 'NO_CONTAINER';
export const MIC_DENIED = 'DENIED';
export const MIC_NO_DEVICE = 'NO_DEVICE';

export type MicStatus =
  | typeof MIC_READY
  | typeof MIC_INSECURE
  | typeof MIC_UNSUPPORTED
  | typeof MIC_NO_CONTAINER
  | typeof MIC_DENIED
  | typeof MIC_NO_DEVICE;

/**
 * WEB-FR-138 — preference order, intersected with `foshol.intake.allowed-audio-types`.
 * Safari's `MediaRecorder` produces `audio/mp4` (AAC) and does not support `audio/webm` at
 * all, so hard-coding WebM yields an empty recording on every iPhone.
 */
export const AUDIO_MIME_PREFERENCE: readonly string[] = [
  'audio/webm;codecs=opus',
  'audio/mp4',
  'audio/ogg',
];

const CODEC_SUFFIX = ';';
const VISIBILITY_EVENT = 'visibilitychange';
const HIDDEN_STATE = 'hidden';
const DATA_AVAILABLE = 'dataavailable';
const RECORDER_STOP = 'stop';
const NOT_ALLOWED = 'NotAllowedError';
const SECURITY_ERROR = 'SecurityError';
const NOT_FOUND = 'NotFoundError';
const ZERO = 0;

/** Exported for its own unit test: negotiation is the whole of `WEB-FR-138`/`139`. */
export function negotiateAudioMime(
  isSupported: (type: string) => boolean,
  allowed: readonly string[],
): string | null {
  for (const candidate of AUDIO_MIME_PREFERENCE) {
    const base = candidate.split(CODEC_SUFFIX)[0];
    if (allowed.includes(base) && isSupported(candidate)) return candidate;
  }
  return null;
}

@Injectable()
export class VoiceRecorder {
  private readonly normaliser = inject(AudioNormaliser);

  private readonly _status = signal<MicStatus>(MIC_READY);
  private readonly _recording = signal(false);
  private readonly _preparing = signal(false);
  private readonly _elapsedMs = signal(ZERO);
  private readonly _clip = signal<DraftAudio | null>(null);
  private readonly _clipUrl = signal<string | null>(null);
  private readonly _analyser = signal<AnalyserNode | null>(null);
  /** The rate the device ACTUALLY granted, read from the track (`WEB-FR-146`). */
  private readonly _grantedRateHz = signal<number | null>(null);

  readonly status = this._status.asReadonly();
  readonly recording = this._recording.asReadonly();
  readonly preparing = this._preparing.asReadonly();
  readonly elapsedMs = this._elapsedMs.asReadonly();
  readonly clip = this._clip.asReadonly();
  readonly clipUrl = this._clipUrl.asReadonly();
  readonly analyser = this._analyser.asReadonly();
  readonly grantedRateHz = this._grantedRateHz.asReadonly();

  /**
   * WEB-FR-136/137/139 — the recorder is HIDDEN unless it can actually function. A record
   * control that does nothing when held reads as a broken app rather than a misconfigured
   * origin or a refused permission, and the text box (`WEB-FR-140`) is always there anyway.
   */
  readonly available = computed(() => this._status() === MIC_READY);
  readonly elapsedSeconds = computed(() =>
    Math.floor(this._elapsedMs() / APP_CONFIG.ui.msPerSecond),
  );
  readonly maxSeconds = APP_CONFIG.intake.maxAudioSeconds;

  #stream: MediaStream | null = null;
  #recorder: MediaRecorder | null = null;
  #context: AudioContext | null = null;
  #chunks: Blob[] = [];
  #ticker: ReturnType<typeof setInterval> | null = null;
  #startedAt = ZERO;
  /** The gesture is still held. Set synchronously so an early release can cancel a slow grant. */
  #held = false;
  #mimeType = '';

  constructor() {
    this.#probe();

    const onVisibility = (): void => {
      // WEB-FR-144 — a backgrounded tab or an incoming call suspends capture on both
      // platforms; the hold must end with it, keeping whatever was captured.
      if (document.visibilityState === HIDDEN_STATE && this.#held) this.release();
    };
    document.addEventListener(VISIBILITY_EVENT, onVisibility);

    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener(VISIBILITY_EVENT, onVisibility);
      // WEB-FR-145 — leaving the capture screen gives the microphone back.
      this.#held = false;
      this.#teardown();
      this.#revokeClipUrl();
    });
  }

  /**
   * Called synchronously from the pointer-hold gesture. `WEB-FR-142`: the `AudioContext` is
   * created and resumed HERE, inside the user gesture, because iOS Safari creates every
   * context suspended and resumes it only from one. A context resumed on component init stays
   * suspended, the `AnalyserNode` draws a flat line, and recording *appears* to work.
   */
  press(): void {
    if (!this.available() || this.#held) return;
    this.#held = true;
    this.#resumeContext();
    void this.#begin();
  }

  release(): void {
    if (!this.#held) return;
    this.#held = false;
    void this.#end();
  }

  /** WEB-FR-135 — discard and re-record before submission. */
  discard(): void {
    this.#revokeClipUrl();
    this._clip.set(null);
    this._elapsedMs.set(ZERO);
  }

  /** WEB-FR-145 — the submission path releases the microphone too. */
  releaseMicrophone(): void {
    this.#held = false;
    this.#teardown();
  }

  #probe(): void {
    if (typeof window === 'undefined' || !window.isSecureContext) {
      this._status.set(MIC_INSECURE);
      return;
    }
    if (navigator.mediaDevices === undefined || typeof MediaRecorder === 'undefined') {
      this._status.set(navigator.mediaDevices === undefined ? MIC_INSECURE : MIC_UNSUPPORTED);
      return;
    }
    const mime = negotiateAudioMime(
      (type) => MediaRecorder.isTypeSupported(type),
      APP_CONFIG.intake.allowedAudioTypes,
    );
    if (mime === null) {
      // WEB-FR-139 — rather than upload a payload the server answers with 415.
      this._status.set(MIC_NO_CONTAINER);
      return;
    }
    this.#mimeType = mime;
    this._status.set(MIC_READY);
  }

  async #begin(): Promise<void> {
    this._preparing.set(true);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: { ideal: APP_CONFIG.audio.channels },
          sampleRate: { ideal: APP_CONFIG.audio.sampleRateHz },
          echoCancellation: true,
          noiseSuppression: true,
          // Automatic gain control fights the peak normalisation of WEB-FR-134: the browser
          // rides the level up and down mid-sentence, and the clip's peak then describes the
          // AGC's decisions rather than how loudly the farmer spoke.
          autoGainControl: false,
        },
      });
    } catch (caught: unknown) {
      this._preparing.set(false);
      this.#held = false;
      this._status.set(deniedStatus(caught));
      return;
    }
    this._preparing.set(false);

    // The gesture ended while the permission prompt was up, or the page went away.
    if (!this.#held) {
      stopTracks(stream);
      return;
    }

    this.#stream = stream;
    // WEB-FR-146 — never trust the constraint; read what the device granted.
    this._grantedRateHz.set(stream.getAudioTracks()[0]?.getSettings().sampleRate ?? null);
    this.#attachAnalyser(stream);

    this.#chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: this.#mimeType });
    recorder.addEventListener(DATA_AVAILABLE, (event) => {
      const blob = (event as BlobEvent).data;
      if (blob.size > ZERO) this.#chunks.push(blob);
    });
    this.#recorder = recorder;
    recorder.start();

    this.discard();
    this.#startedAt = Date.now();
    this._recording.set(true);
    this.#startTicker();
  }

  async #end(): Promise<void> {
    this.#stopTicker();
    const recorder = this.#recorder;
    const recordedMs = this.#startedAt === ZERO ? ZERO : Date.now() - this.#startedAt;
    this._recording.set(false);

    if (recorder === null) {
      this.#teardown();
      return;
    }

    const stopped = new Promise<void>((resolve) => {
      recorder.addEventListener(RECORDER_STOP, () => resolve(), { once: true });
    });
    if (recorder.state !== 'inactive') recorder.stop();
    await stopped;

    const raw = new Blob(this.#chunks, { type: this.#mimeType });
    this.#teardown();

    if (raw.size === ZERO) return;
    const normalised = await this.normaliser.normalise(raw, this.#mimeType, recordedMs);
    this._clip.set(normalised);
    this._clipUrl.set(URL.createObjectURL(normalised.blob));
    this._elapsedMs.set(normalised.durationMs);
  }

  #attachAnalyser(stream: MediaStream): void {
    const context = this.#context;
    if (context === null) return;
    const analyser = context.createAnalyser();
    analyser.fftSize = APP_CONFIG.audio.fftSize;
    context.createMediaStreamSource(stream).connect(analyser);
    this._analyser.set(analyser);
  }

  #resumeContext(): void {
    if (typeof AudioContext === 'undefined') return;
    this.#context ??= new AudioContext();
    void this.#context.resume();
  }

  /**
   * WEB-FR-132 — the waveform is drawn straight to canvas in a rAF loop; only the elapsed
   * seconds counter writes a signal, and only every `audio.meterIntervalMs`. A signal written
   * at 60 Hz is a change-detection storm on a zoneless application.
   *
   * WEB-FR-133 — the cap stops the recording and keeps what was captured, which is just the
   * ordinary release path.
   */
  #startTicker(): void {
    const capMs = APP_CONFIG.intake.maxAudioSeconds * APP_CONFIG.ui.msPerSecond;
    this.#ticker = setInterval(() => {
      const elapsed = Date.now() - this.#startedAt;
      this._elapsedMs.set(Math.min(elapsed, capMs));
      if (elapsed >= capMs) this.release();
    }, APP_CONFIG.audio.meterIntervalMs);
  }

  #stopTicker(): void {
    if (this.#ticker !== null) clearInterval(this.#ticker);
    this.#ticker = null;
  }

  #teardown(): void {
    this.#stopTicker();
    this._recording.set(false);
    this._analyser.set(null);
    this.#recorder = null;
    if (this.#stream !== null) stopTracks(this.#stream);
    this.#stream = null;
    if (this.#context !== null) void this.#context.close();
    this.#context = null;
  }

  #revokeClipUrl(): void {
    const url = this._clipUrl();
    if (url !== null) URL.revokeObjectURL(url);
    this._clipUrl.set(null);
  }
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

function deniedStatus(caught: unknown): MicStatus {
  const name = caught instanceof Error ? caught.name : '';
  if (name === NOT_FOUND) return MIC_NO_DEVICE;
  if (name === SECURITY_ERROR) return MIC_INSECURE;
  if (name === NOT_ALLOWED) return MIC_DENIED;
  return MIC_DENIED;
}
