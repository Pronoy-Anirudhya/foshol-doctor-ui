import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { GradcamService } from '../../../core/media/gradcam.service';
import { IMAGE_VARIANT_ORIGINAL } from '../../../core/media/out-of-contract/media-url.service';
import { PointerHoldDirective } from '../../directives/pointer-hold.directive';
import { SecureImage } from '../secure-image/secure-image';

/**
 * WEB-FR-211 — the Grad-CAM overlay over the primary case image, DEFAULTING TO OFF. The officer
 * sees the photograph first and the model's opinion second; a heat map that is already burned
 * over the leaf when the page opens is the model telling the officer what to think.
 *
 * WEB-FR-212 — if there is no overlay, the toggle is HIDDEN. Not disabled, not greyed, not
 * present-but-broken. The same applies when the fetch fails for any reason: a control that does
 * nothing is worse than no control, because the officer spends the demo pressing it.
 *
 * D-03 — the requirement text says `gradcamObjectKey`, the frozen schema says
 * `hasGradcam: boolean`. WEB-API-005 makes the generated client the winner, so `hasGradcam` is
 * what this component binds to, and the caller passes `AnalysisDetail.hasGradcam` straight in.
 *
 * The interaction has two halves, and both matter:
 *   - a quick press LATCHES the overlay on, so it can be studied hands-free;
 *   - a press held down shows it only WHILE HELD, so the officer can flick between the heat map
 *     and the bare leaf and see what actually changed. Comparison is the whole reason to look
 *     at a Grad-CAM at all, and a latched toggle makes it a two-click round trip.
 *
 * WEB-UX-040 — both halves work from the keyboard, because `PointerHoldDirective` treats a held
 * Space or Enter as a hold. A short keypress therefore latches exactly as a short click does.
 */

/** Below this, a press is a click; above it, it was a deliberate hold-to-compare. */
const QUICK_PRESS_MAX_MS = 300;
const NO_TIMESTAMP = 0;

@Component({
  selector: 'foshol-gradcam-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, SecureImage, PointerHoldDirective],
  templateUrl: './gradcam-view.html',
  styleUrl: './gradcam-view.css',
})
export class GradcamView {
  private readonly gradcam = inject(GradcamService);

  readonly caseId = input.required<string>();
  readonly imageId = input.required<string>();

  /** WEB-UX-042 — the primary photograph's alternative text, supplied by the caller. */
  readonly imageAlt = input.required<string>();

  /** `AnalysisDetail.hasGradcam` (D-03), never a locally derived guess. */
  readonly hasGradcam = input.required<boolean>();

  /**
   * Raised once when an overlay was promised but could not be fetched. The toggle has already
   * hidden itself by then; this exists so the case detail can note the gap rather than leaving
   * the officer wondering where the heat map went.
   */
  readonly overlayUnavailable = output<void>();

  protected readonly originalVariant = IMAGE_VARIANT_ORIGINAL;

  /**
   * Held as a plain field as well as a signal. Revocation bookkeeping must not be a
   * change-detection dependency of the effect that performs it, or loading an overlay would
   * schedule the effect that loads the overlay.
   */
  private objectUrl: string | null = null;
  private readonly _objectUrl = signal<string | null>(null);

  private readonly _latched = signal(false);
  private readonly _held = signal(false);
  private readonly _unavailable = signal(false);
  private holdStartedAt = NO_TIMESTAMP;

  protected readonly overlayUrl = this._objectUrl.asReadonly();
  protected readonly latched = this._latched.asReadonly();

  /** WEB-FR-212 — the single gate on whether the control exists at all. */
  protected readonly toggleVisible = computed(() => this.hasGradcam() && !this._unavailable());

  protected readonly overlayVisible = computed(
    () => (this._latched() || this._held()) && this._objectUrl() !== null,
  );

  constructor() {
    /**
     * Loaded eagerly rather than on first press, for two reasons. Hold-to-compare has to be
     * instant to be worth having, and a failure has to be known BEFORE the toggle is offered —
     * discovering it on the officer's first press is exactly the broken control WEB-FR-212
     * forbids.
     */
    effect((onCleanup) => {
      const caseId = this.caseId();
      const wanted = this.hasGradcam();

      let cancelled = false;
      onCleanup(() => {
        cancelled = true;
      });

      if (!wanted) {
        this.adopt(null);
        return;
      }

      this.gradcam
        .load(caseId)
        .then((url) => {
          // A component destroyed, or a case switched, mid-flight still owns this object URL.
          if (cancelled) {
            this.gradcam.revoke(url);
            return;
          }
          this.adopt(url);
        })
        .catch(() => {
          if (cancelled) return;
          this._unavailable.set(true);
          this._latched.set(false);
          this.overlayUnavailable.emit();
        });
    });

    // A blob object URL is a document-lifetime root: a leaked one pins the PNG in memory until
    // the tab closes, and an officer working a queue mounts this component dozens of times.
    inject(DestroyRef).onDestroy(() => this.adopt(null));
  }

  protected onHoldStart(): void {
    this.holdStartedAt = Date.now();
    this._held.set(true);
  }

  protected onHoldEnd(): void {
    const quick = Date.now() - this.holdStartedAt < QUICK_PRESS_MAX_MS;
    this._held.set(false);
    // A quick press is a click, and a click latches. A long press was a comparison, and
    // releasing it should leave the overlay exactly as it was found.
    if (quick) this._latched.update((on) => !on);
  }

  private adopt(next: string | null): void {
    if (this.objectUrl !== null) this.gradcam.revoke(this.objectUrl);
    this.objectUrl = next;
    this._objectUrl.set(next);
  }
}
