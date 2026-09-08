import {
  booleanAttribute,
  computed,
  DestroyRef,
  Directive,
  ElementRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

/**
 * A hold-to-act control: press and hold to start, release to stop.
 *
 * WEB-FR-143 — driven by **Pointer Events with pointer capture**, and `pointercancel`,
 * `pointerleave` and `lostpointercapture` all count as a release. Touch on a phone is
 * interrupted routinely: a scroll gesture steals the pointer, the system back swipe fires, a
 * notification arrives. Without capture the control simply never receives the release, and
 * the recorder either runs to the `intake.maxAudioSeconds` cap or hangs holding the
 * microphone.
 *
 * WEB-FR-144 — a hidden page also releases. Both platforms suspend media capture when the tab
 * is backgrounded or a call arrives; the hold must end with it, keeping whatever was captured.
 *
 * WEB-UX-040 — keyboard-operable: Space or Enter held is the same gesture. `keydown` repeats
 * while a key is held, so only the first is a start.
 *
 * The directive is deliberately transport-agnostic — it emits `holdStart` / `holdEnd` and
 * knows nothing about audio. `WEB-FR-142` (resuming a suspended `AudioContext` from the user
 * gesture) is satisfied because `holdStart` is emitted synchronously inside the `pointerdown`
 * handler, so it is still within the gesture.
 */
const HOLD_KEYS: readonly string[] = [' ', 'Spacebar', 'Enter'];
const VISIBILITY_EVENT = 'visibilitychange';
const HIDDEN_STATE = 'hidden';

@Directive({
  selector: '[fosholPointerHold]',
  exportAs: 'fosholPointerHold',
  host: {
    '(pointerdown)': 'onPointerDown($event)',
    '(pointerup)': 'release()',
    '(pointercancel)': 'release()',
    '(pointerleave)': 'release()',
    '(lostpointercapture)': 'release()',
    '(keydown)': 'onKeyDown($event)',
    '(keyup)': 'onKeyUp($event)',
    '(blur)': 'release()',
    '[attr.aria-disabled]': 'disabledAttr()',
    '[attr.data-holding]': 'holding()',
    // The browser must not hand the pointer to a scroll container mid-hold.
    '[style.touch-action]': '"none"',
    '[style.user-select]': '"none"',
  },
})
export class PointerHoldDirective {
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly holdDisabled = input(false, {
    alias: 'fosholPointerHoldDisabled',
    transform: booleanAttribute,
  });

  readonly holdStart = output<void>();
  readonly holdEnd = output<void>();

  private readonly _holding = signal(false);
  /** Bindable held state, e.g. `#hold="fosholPointerHold"` then `hold.holding()`. */
  readonly holding = this._holding.asReadonly();

  protected readonly disabledAttr = computed(() => (this.holdDisabled() ? true : null));

  constructor() {
    const onVisibility = (): void => {
      if (document.visibilityState === HIDDEN_STATE) this.release();
    };
    document.addEventListener(VISIBILITY_EVENT, onVisibility);
    this.destroyRef.onDestroy(() => {
      document.removeEventListener(VISIBILITY_EVENT, onVisibility);
      // A directive torn down mid-hold must not leave the consumer holding the microphone.
      this.release();
    });
  }

  protected onPointerDown(event: PointerEvent): void {
    if (this.holdDisabled() || this._holding()) return;
    // Capture on the HOST, not on event.target — the target may be a child glyph, and the
    // release events must come back to the element that owns the gesture. With capture, every
    // subsequent pointer event for this gesture arrives here even if the finger wanders off
    // the control or a scroll container tries to take over.
    const element = this.host.nativeElement;
    if (typeof element.setPointerCapture === 'function') {
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        /* A stale pointer id throws NotFoundError; the gesture still works without capture. */
      }
    }
    event.preventDefault();
    this.begin();
  }

  protected onKeyDown(event: KeyboardEvent): void {
    if (!HOLD_KEYS.includes(event.key) || event.repeat) return;
    event.preventDefault();
    this.begin();
  }

  protected onKeyUp(event: KeyboardEvent): void {
    if (!HOLD_KEYS.includes(event.key)) return;
    event.preventDefault();
    this.release();
  }

  private begin(): void {
    if (this.holdDisabled() || this._holding()) return;
    this._holding.set(true);
    this.holdStart.emit();
  }

  /** Idempotent: several release paths can fire for one gesture, and often do. */
  protected release(): void {
    if (!this._holding()) return;
    this._holding.set(false);
    this.holdEnd.emit();
  }
}
