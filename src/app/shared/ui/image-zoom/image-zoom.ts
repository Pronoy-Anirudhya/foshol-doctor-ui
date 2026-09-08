import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  signal,
  viewChild,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { Icon } from '../icon/icon';

/**
 * WEB-FR-210 — a zoom control over projected content, operable by POINTER **and** by KEYBOARD.
 *
 * WEB-UX-040 makes the keyboard half non-negotiable, and it is the half that is usually
 * skipped: a wheel-and-drag zoom is unusable for an officer who navigates by keyboard, and a
 * pinch gesture is unreachable on a laptop. So every gesture has a keyed equivalent —
 * `+`/`-`/`0`, arrow keys to pan — and every one of those also has a visible button, because a
 * shortcut nobody can see is not a control.
 *
 * The content is projected rather than owned, so this component knows nothing about cases,
 * images or overlays. `gradcam-view` projects a stacked pair of images through it; a plain
 * caller projects a single `<foshol-secure-image>`. Extra controls (a Grad-CAM toggle) belong in
 * the `zoomBarEnd` slot so they sit in the control bar rather than inside the pannable
 * viewport, where they would be dragged around with the picture.
 *
 * WEB-UX-031 — the page must never scroll sideways at 360 px. The viewport clips its own
 * overflow, plain wheel scrolling is left to the page (only ctrl+wheel zooms, matching the
 * browser's own convention), and `touch-action` opens back up to `pan-y` whenever the image is
 * at fit, so a thumb swipe scrolls the page instead of being swallowed.
 */

/** Fit-to-frame. Also the floor: this control magnifies, it never shrinks below the frame. */
const MIN_SCALE = 1;
const MAX_SCALE = 6;
/** One press of a button or of `+`. Multiplicative, so each step feels the same size. */
const SCALE_STEP = 1.5;
/** A wheel notch is a finer gesture than a button press. */
const WHEEL_STEP = 1.15;
/** Where double-click lands when the image is at fit. Enough to read a lesion, not so much
 *  that the officer is lost inside the picture with no idea which part they are looking at. */
const ACTUAL_SCALE = 2.5;
const PAN_STEP_PX = 48;
/** The image can be dragged until its own edge reaches the frame edge, and no further. */
const PAN_BOUND_DIVISOR = 2;
const SCALE_LABEL_PRECISION = 1;
const NO_OFFSET = 0;

const ZOOM_IN_KEYS: readonly string[] = ['+', '='];
const ZOOM_OUT_KEYS: readonly string[] = ['-', '_'];
const RESET_KEYS: readonly string[] = ['0'];

@Component({
  selector: 'foshol-image-zoom',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, TranslatePipe],
  templateUrl: './image-zoom.html',
  styleUrl: './image-zoom.css',
})
export class ImageZoom {
  private readonly viewport = viewChild<ElementRef<HTMLElement>>('viewport');

  private readonly _scale = signal(MIN_SCALE);
  private readonly _tx = signal(NO_OFFSET);
  private readonly _ty = signal(NO_OFFSET);

  /** Set while a drag is in flight, so the transform can skip its transition and track 1:1. */
  private readonly _dragging = signal(false);
  private lastPointerX = NO_OFFSET;
  private lastPointerY = NO_OFFSET;

  protected readonly scale = this._scale.asReadonly();
  protected readonly dragging = this._dragging.asReadonly();

  protected readonly zoomed = computed(() => this._scale() > MIN_SCALE);
  protected readonly canZoomIn = computed(() => this._scale() < MAX_SCALE);
  protected readonly canZoomOut = computed(() => this._scale() > MIN_SCALE);

  protected readonly scaleLabel = computed(() => this._scale().toFixed(SCALE_LABEL_PRECISION));

  protected readonly transform = computed(
    () => `translate(${this._tx()}px, ${this._ty()}px) scale(${this._scale()})`,
  );

  /**
   * At fit, vertical page scrolling must still work through the picture — otherwise a
   * full-width image on a 360 px phone becomes a dead zone the page cannot be scrolled past.
   * Once zoomed, the gesture belongs to the pan.
   */
  protected readonly touchAction = computed(() => (this.zoomed() ? 'none' : 'pan-y'));

  zoomIn(): void {
    this.setScale(this._scale() * SCALE_STEP);
  }

  zoomOut(): void {
    this.setScale(this._scale() / SCALE_STEP);
  }

  reset(): void {
    this._scale.set(MIN_SCALE);
    this._tx.set(NO_OFFSET);
    this._ty.set(NO_OFFSET);
  }

  /** Double-click convention: one gesture between fit and a useful working magnification. */
  protected toggleActual(): void {
    if (this.zoomed()) {
      this.reset();
      return;
    }
    this.setScale(ACTUAL_SCALE);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const key = event.key;

    if (ZOOM_IN_KEYS.includes(key)) return this.handled(event, () => this.zoomIn());
    if (ZOOM_OUT_KEYS.includes(key)) return this.handled(event, () => this.zoomOut());
    if (RESET_KEYS.includes(key)) return this.handled(event, () => this.reset());

    // Arrow keys pan only while zoomed. At fit there is nothing to pan, and swallowing them
    // there would break the page scrolling the officer expects from an arrow key.
    if (!this.zoomed()) return;
    switch (key) {
      case 'ArrowLeft':
        return this.handled(event, () => this.panBy(PAN_STEP_PX, NO_OFFSET));
      case 'ArrowRight':
        return this.handled(event, () => this.panBy(-PAN_STEP_PX, NO_OFFSET));
      case 'ArrowUp':
        return this.handled(event, () => this.panBy(NO_OFFSET, PAN_STEP_PX));
      case 'ArrowDown':
        return this.handled(event, () => this.panBy(NO_OFFSET, -PAN_STEP_PX));
      default:
        return;
    }
  }

  /**
   * Ctrl+wheel only — the same contract the browser's own page zoom uses. A bare wheel event is
   * left alone so the page keeps scrolling normally through the image (WEB-UX-031).
   */
  protected onWheel(event: WheelEvent): void {
    if (!event.ctrlKey) return;
    event.preventDefault();
    this.setScale(
      event.deltaY < NO_OFFSET ? this._scale() * WHEEL_STEP : this._scale() / WHEEL_STEP,
    );
  }

  protected onPointerDown(event: PointerEvent): void {
    if (!this.zoomed()) return;
    const element = this.viewport()?.nativeElement;
    if (element === undefined) return;

    if (typeof element.setPointerCapture === 'function') {
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        /* A stale pointer id throws NotFoundError; dragging still works without capture. */
      }
    }
    event.preventDefault();
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
    this._dragging.set(true);
  }

  protected onPointerMove(event: PointerEvent): void {
    if (!this._dragging()) return;
    this.panBy(event.clientX - this.lastPointerX, event.clientY - this.lastPointerY);
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
  }

  protected onPointerUp(): void {
    this._dragging.set(false);
  }

  panBy(dx: number, dy: number): void {
    this._tx.set(this._tx() + dx);
    this._ty.set(this._ty() + dy);
    this.clampPan();
  }

  private setScale(next: number): void {
    this._scale.set(Math.min(MAX_SCALE, Math.max(MIN_SCALE, next)));
    if (!this.zoomed()) {
      this._tx.set(NO_OFFSET);
      this._ty.set(NO_OFFSET);
      return;
    }
    // Zooming out can leave the picture parked past its own edge; pull it back in.
    this.clampPan();
  }

  /**
   * The image may be dragged until its edge meets the frame edge, never past it. The bound is
   * derived from measured geometry, which means it is zero under jsdom (no layout engine) —
   * so a unit test that needs a non-zero bound stubs `getBoundingClientRect` on the viewport.
   */
  private clampPan(): void {
    const rect = this.viewport()?.nativeElement.getBoundingClientRect();
    const overflow = this._scale() - MIN_SCALE;
    const maxX = rect === undefined ? NO_OFFSET : (rect.width * overflow) / PAN_BOUND_DIVISOR;
    const maxY = rect === undefined ? NO_OFFSET : (rect.height * overflow) / PAN_BOUND_DIVISOR;

    this._tx.set(Math.min(maxX, Math.max(-maxX, this._tx())));
    this._ty.set(Math.min(maxY, Math.max(-maxY, this._ty())));
  }

  private handled(event: KeyboardEvent, action: () => void): void {
    event.preventDefault();
    action();
  }
}
