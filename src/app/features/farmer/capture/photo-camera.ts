import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { APP_CONFIG } from '../../../core/config/app-config';

/**
 * A live in-page camera viewfinder, on a laptop webcam in a browser and on a phone's camera.
 *
 * `<input type="file" capture>` — kept as the "choose a file" control's plain file picker, and
 * as the fallback here when a live camera cannot be offered at all — is a MOBILE-ONLY hint.
 * Desktop browsers have never honoured `capture`: clicking that input always opens the OS file
 * browser, never a webcam. This service is what actually turns the camera ON, via
 * `getUserMedia`, so a farmer capturing evidence from a laptop sees a live viewfinder rather
 * than a file-picker modal.
 *
 * Every requirement this service owns is about giving the camera back — mirrors
 * `voice-recorder.ts`'s microphone discipline for the same reason:
 *
 *  - the stream stops the moment a photo is taken, the panel is cancelled, the page is
 *    hidden, or the component is destroyed. A live track leaves a laptop's camera light on,
 *    which reads, correctly, as the app still watching.
 */

export const CAMERA_READY = 'READY';
/** `getUserMedia` exists only in a secure context; a phone on an http:// LAN address has none. */
export const CAMERA_INSECURE = 'INSECURE';
export const CAMERA_UNSUPPORTED = 'UNSUPPORTED';
export const CAMERA_DENIED = 'DENIED';
export const CAMERA_NO_DEVICE = 'NO_DEVICE';

export type CameraStatus =
  | typeof CAMERA_READY
  | typeof CAMERA_INSECURE
  | typeof CAMERA_UNSUPPORTED
  | typeof CAMERA_DENIED
  | typeof CAMERA_NO_DEVICE;

const VISIBILITY_EVENT = 'visibilitychange';
const HIDDEN_STATE = 'hidden';
const NOT_ALLOWED = 'NotAllowedError';
const SECURITY_ERROR = 'SecurityError';
const NOT_FOUND = 'NotFoundError';
const CONTEXT_2D = '2d';
const JPEG_TYPE = 'image/jpeg';
const ZERO = 0;

/** Exported for its own unit test — same shape as `voice-recorder.ts`'s `deniedStatus`. */
export function mapCameraError(caught: unknown): CameraStatus {
  const name = caught instanceof Error ? caught.name : '';
  if (name === NOT_FOUND) return CAMERA_NO_DEVICE;
  if (name === SECURITY_ERROR) return CAMERA_INSECURE;
  if (name === NOT_ALLOWED) return CAMERA_DENIED;
  return CAMERA_DENIED;
}

@Injectable()
export class PhotoCamera {
  private readonly _status = signal<CameraStatus>(CAMERA_READY);
  private readonly _open = signal(false);
  private readonly _starting = signal(false);

  readonly status = this._status.asReadonly();
  readonly open = this._open.asReadonly();
  readonly starting = this._starting.asReadonly();

  /**
   * Statically capable of even attempting a live camera. An insecure origin or a browser with
   * no `getUserMedia` is known before ever asking, so the panel falls back to the plain
   * file-picker control (with `capture` still set, for a mobile browser this app has not met
   * yet) rather than rendering a button that could not possibly work.
   *
   * A DENIED or NO_DEVICE status — only knowable after a real attempt — does NOT flip this to
   * false: the farmer can retry, or use "choose a file" instead, which stays available either
   * way. Only a structural incapability hides the live control entirely.
   */
  readonly available = computed(
    () => this._status() !== CAMERA_INSECURE && this._status() !== CAMERA_UNSUPPORTED,
  );

  #stream: MediaStream | null = null;

  constructor() {
    if (typeof window === 'undefined' || !window.isSecureContext) {
      this._status.set(CAMERA_INSECURE);
    } else if (navigator.mediaDevices?.getUserMedia === undefined) {
      this._status.set(CAMERA_UNSUPPORTED);
    }

    const onVisibility = (): void => {
      // Mirrors WEB-FR-144 for the microphone: a backgrounded tab suspends capture on both
      // platforms, and there is no partial photo worth keeping — just give the camera back.
      if (document.visibilityState === HIDDEN_STATE) this.close();
    };
    document.addEventListener(VISIBILITY_EVENT, onVisibility);

    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener(VISIBILITY_EVENT, onVisibility);
      this.close();
    });
  }

  /** Requests the camera and attaches the live stream to the given `<video>` element. */
  async start(video: HTMLVideoElement): Promise<void> {
    if (!this.available() || this._starting() || this._open()) return;
    this._starting.set(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: APP_CONFIG.capture.cameraIdealWidthPx },
          height: { ideal: APP_CONFIG.capture.cameraIdealHeightPx },
        },
        audio: false,
      });
      this.#stream = stream;
      video.srcObject = stream;
      await video.play();
      this._status.set(CAMERA_READY);
      this._open.set(true);
    } catch (caught: unknown) {
      this._status.set(mapCameraError(caught));
    } finally {
      this._starting.set(false);
    }
  }

  /**
   * Draws the current video frame to an offscreen canvas and returns it as a JPEG blob — the
   * same `Blob` shape a chosen file arrives as, so it runs through the identical quality gate
   * and re-encode in `image-pipeline.ts`. `null` only when the canvas has nothing to draw
   * (jsdom has no 2D context at all; a real browser with a live stream always does).
   */
  capture(video: HTMLVideoElement): Promise<Blob | null> {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext(CONTEXT_2D) as CanvasRenderingContext2D | null;
    if (context === null || canvas.width === ZERO || canvas.height === ZERO) {
      return Promise.resolve(null);
    }
    context.drawImage(video, ZERO, ZERO, canvas.width, canvas.height);
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), JPEG_TYPE, APP_CONFIG.capture.jpegQuality);
    });
  }

  /** Gives the camera back. Safe to call whether or not a stream is open. */
  close(): void {
    if (this.#stream !== null) for (const track of this.#stream.getTracks()) track.stop();
    this.#stream = null;
    this._open.set(false);
  }
}
