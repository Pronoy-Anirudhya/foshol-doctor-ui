import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { APP_CONFIG } from '../../../core/config/app-config';
import { CAMERA_READY, PhotoCamera } from './photo-camera';

/**
 * The "take a photo" control — a live camera viewfinder where the browser can offer one, with
 * the OS file-picker (`capture="environment"`, honoured on a phone) as the fallback where it
 * cannot (`WEB-FR-110`).
 *
 * WEB-FR-136/137-style degradation: when `PhotoCamera.available()` is false (an insecure
 * origin, or a browser with no `getUserMedia`), this renders the plain file input and nothing
 * else — never a live-camera button that could not possibly work.
 */
const KEY = 'farmer.capture.camera.';

@Component({
  selector: 'foshol-camera-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [PhotoCamera],
  imports: [TranslatePipe],
  host: { class: 'block' },
  template: `
    @if (camera.available()) {
      <!-- The <video> element is ALWAYS mounted (never behind an @if that would remove it
           from the DOM), so viewChild('video') resolves before the trigger is ever clicked.
           camera.start() needs a real element to attach the stream to; camera.open() can only
           become true AFTER that attachment succeeds, so gating this element's PRESENCE on
           camera.open() is a chicken-and-egg bug — the element would never exist for start()
           to use in the first place. Visibility, not DOM presence, is what [hidden] controls. -->
      <div
        class="camera-viewfinder"
        data-testid="camera-viewfinder"
        [hidden]="!camera.open()"
      >
        <video
          #video
          class="camera-video"
          [attr.aria-label]="KEY + 'viewfinderLabel' | translate"
          autoplay
          playsinline
          muted
        ></video>

        <div class="camera-controls">
          <button
            type="button"
            class="camera-cancel touch-target"
            data-testid="camera-cancel"
            (click)="cancel()"
          >
            {{ KEY + 'cancel' | translate }}
          </button>
          <button
            type="button"
            class="camera-shutter touch-target-lg"
            data-testid="camera-shutter"
            [attr.aria-label]="KEY + 'shutter' | translate"
            (click)="shoot()"
          >
            <span class="camera-shutter-ring" aria-hidden="true"></span>
          </button>
          <span class="camera-controls-spacer" aria-hidden="true"></span>
        </div>
      </div>

      @if (!camera.open()) {
        <button
          type="button"
          class="pick pick-primary touch-target"
          data-testid="camera-trigger"
          [disabled]="disabled() || camera.starting()"
          (click)="startCamera()"
        >
          <span aria-hidden="true">📷</span>
          {{ (camera.starting() ? KEY + 'opening' : KEY + 'trigger') | translate }}
        </button>

        @if (diagnosticKey(); as key) {
          <p class="camera-diagnostic" data-testid="camera-diagnostic" role="status">
            {{ key | translate }}
          </p>
        }
      }
    } @else {
      <!-- WEB-FR-110 — the mobile-only "capture" hint. Desktop browsers never honour it
           and simply open the file browser, which is the correct fallback here too. -->
      <label class="pick pick-primary touch-target">
        <input
          class="sr-only"
          type="file"
          data-testid="camera-fallback-input"
          capture="environment"
          [attr.accept]="acceptTypes"
          [disabled]="disabled()"
          (change)="fileChosen($event)"
        />
        <span aria-hidden="true">📷</span>
        {{ 'farmer.capture.images.takePhoto' | translate }}
      </label>
    }
  `,
  styles: `
    /* Copied from capture-page.ts's own .pick/.pick-primary: Angular's emulated encapsulation
       scopes styles per component, so a rule defined there has no effect here. This is the
       same class of bug just fixed in the officer queue (a scoped style silently not applying
       where a sibling component assumed it would) — duplicating the small button look is the
       safer trade against relying on cross-component style bleed that encapsulation forbids
       by design. */
    .pick {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 0.85rem 1.1rem;
      border: 1px solid var(--color-surface-3);
      border-radius: 1rem;
      background: var(--color-surface-0);
      color: var(--color-ink);
      font-weight: 700;
      cursor: pointer;
      transition:
        border-color var(--duration-1) var(--ease-settle),
        box-shadow var(--duration-2) var(--ease-settle);
    }

    .pick:hover {
      border-color: var(--color-paddy-600);
      box-shadow: var(--shadow-card);
    }

    .pick-primary {
      background: var(--color-paddy-600);
      border-color: var(--color-paddy-600);
      color: var(--color-ink-invert);
    }

    .pick-primary:hover {
      background: var(--color-paddy-700);
    }

    /* The live trigger is a plain <button>, which supports :disabled directly — no need for
       capture-page.ts's :has(input:disabled) trick, which exists only because a <label>
       cannot be disabled itself. */
    button.pick:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }

    /* The fallback keeps the label-wraps-hidden-input shape, so it needs the same
       :has()-based focus and disabled handling as capture-page.ts's own .pick
       (WEB-UX-041 — the visible control is the label, so the label must show the ring). */
    .pick:has(input:focus-visible) {
      outline: 3px solid var(--color-focus);
      outline-offset: 2px;
    }

    .pick:has(input:disabled) {
      opacity: 0.55;
      cursor: not-allowed;
    }

    .camera-diagnostic {
      margin-block-start: 0.5rem;
      font-size: 0.8125rem;
      color: var(--color-ink-faint);
    }

    .camera-viewfinder {
      position: relative;
      overflow: hidden;
      border-radius: 1.25rem;
      background: var(--color-slate-900);
      box-shadow: var(--shadow-card);
    }

    .camera-video {
      display: block;
      inline-size: 100%;
      /* A stable frame while the stream negotiates its real aspect ratio. */
      aspect-ratio: 4 / 3;
      object-fit: cover;
      background: var(--color-slate-900);
    }

    .camera-controls {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      padding: 0.85rem 1rem;
    }

    .camera-controls-spacer {
      /* Balances the cancel button so the shutter sits visually centred. */
      inline-size: 4.5rem;
    }

    .camera-cancel {
      inline-size: 4.5rem;
      border-radius: 0.8rem;
      background: rgb(255 255 255 / 0.12);
      font-weight: 600;
      color: var(--color-ink-invert);
    }

    .camera-shutter {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      border-radius: 999px;
      background: var(--color-ink-invert);
      box-shadow: var(--shadow-card);
      transition: transform var(--duration-1) var(--ease-settle);
    }

    .camera-shutter:active {
      transform: scale(0.92);
    }

    .camera-shutter-ring {
      inline-size: 2.75rem;
      block-size: 2.75rem;
      border-radius: 999px;
      border: 3px solid var(--color-slate-800);
    }
  `,
})
export class CameraPanel {
  protected readonly camera = inject(PhotoCamera);
  protected readonly KEY = KEY;

  protected readonly acceptTypes = APP_CONFIG.intake.allowedImageTypes.join(',');

  /** WEB-DATA-004 — the trigger disables the same way the "choose a file" input does. */
  readonly disabled = input(false);
  readonly captured = output<Blob>();

  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');

  protected readonly diagnosticKey = computed(() => {
    const status = this.camera.status();
    return status === CAMERA_READY ? null : `${KEY}diagnostic.${status}`;
  });

  protected async startCamera(): Promise<void> {
    const video = this.video();
    if (video === undefined) return;
    await this.camera.start(video.nativeElement);
  }

  protected async shoot(): Promise<void> {
    const video = this.video();
    if (video === undefined) return;
    const blob = await this.camera.capture(video.nativeElement);
    this.camera.close();
    if (blob !== null) this.captured.emit(blob);
  }

  /** The farmer changed their mind — give the camera back, take nothing. */
  protected cancel(): void {
    this.camera.close();
  }

  protected fileChosen(event: Event): void {
    const el = event.target as HTMLInputElement;
    const file = el.files?.[0] ?? null;
    el.value = '';
    if (file !== null) this.captured.emit(file);
  }
}
