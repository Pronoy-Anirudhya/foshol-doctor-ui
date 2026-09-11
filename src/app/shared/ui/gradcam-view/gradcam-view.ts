import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { ProblemView } from '../../../core/errors/problem';
import { CASE_IMAGE_ORIGINAL } from '../../../core/media/case-image-content.service';
import { GradcamFailedError, GradcamService } from '../../../core/media/gradcam.service';
import { CasePhoto, type PhotoSize } from '../case-photo/case-photo';
import { ErrorPanel } from '../error-panel/error-panel';
import { ImageZoom } from '../image-zoom/image-zoom';

/**
 * The officer's view of a case photograph, and the Grad-CAM overlay on the primary one.
 *
 * WEB-FR-210 — the photograph sits inside the shared zoom control, pointer and keyboard.
 *
 * WEB-FR-211 — an overlay toggle over the PRIMARY image, DEFAULTING TO OFF. The officer sees the
 * photograph first and the model's opinion second: a heat map already burned over the leaf when
 * the page opens is the model telling the officer what to think. It shows where the vision model
 * looked for its top-1 class — explainability for the reviewer, not a finding — and the note
 * under the toggle says so.
 *
 * WEB-FR-212 — no overlay, no control. Not disabled, not greyed, not present-but-broken. The
 * toggle appears only once the overlay has actually been fetched, so a `404` or a blocked fetch
 * is discovered before the officer is offered a control that would do nothing.
 *
 * The toggle lives in the zoom bar (`zoomBarEnd`), never inside the pannable viewport: there it
 * would be dragged about with the picture, and a zoomed viewport captures the very pointer that
 * should have pressed it.
 *
 * **It is a toggle, and it STAYS where the officer put it.** This screen is alive underneath:
 * the claim ring ticks the review store every second (`claim-timer-ring.ts`), an SSE nudge
 * re-reads the case, and each of those replaces the objects these inputs are bound to. So the
 * on/off state is keyed to the CASE — not to `isPrimary`, which a re-render can momentarily
 * restate — and the effect below never tears down an overlay it has already fetched for the
 * same case. Both were previously true, and the overlay switched itself off a moment after the
 * press.
 *
 * The component stays mounted while the officer flips through thumbnails, so the overlay is
 * fetched once per case view and its object URL is revoked when the view is left. On any image
 * but the primary, the toggle and the overlay do not exist: the Grad-CAM was computed for the
 * primary photograph and says nothing about the others (`DEVIATIONS.md` D-38).
 */
@Component({
  selector: 'foshol-gradcam-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CasePhoto, ErrorPanel, ImageZoom, TranslatePipe],
  templateUrl: './gradcam-view.html',
  styleUrl: './gradcam-view.css',
})
export class GradcamView {
  private readonly gradcam = inject(GradcamService);

  readonly caseId = input.required<string>();

  /** The image on screen: the primary one, or whichever thumbnail the officer picked. */
  readonly imageId = input.required<string>();

  /** WEB-UX-042 — the photograph's alternative text, supplied by the caller. */
  readonly imageAlt = input.required<string>();

  /** Whether `imageId` is the primary image — the only one a Grad-CAM belongs to. */
  readonly isPrimary = input.required<boolean>();

  /**
   * The server says an overlay exists: `analysis.hasGradcam`, then `hasGradcam`, then a non-null
   * `gradcamObjectKey` (D-38). When false, `/gradcam` is never called at all.
   */
  readonly overlayAvailable = input.required<boolean>();

  /** Raised once when an overlay was promised but could not be fetched. */
  readonly overlayUnavailable = output<void>();

  protected readonly originalVariant = CASE_IMAGE_ORIGINAL;

  /**
   * Held as a plain field as well as a signal. Revocation bookkeeping must not be a
   * change-detection dependency of the effect that performs it, or loading an overlay would
   * schedule the effect that loads the overlay.
   */
  private objectUrl: string | null = null;
  /** The case the held overlay belongs to, so a re-run knows there is nothing left to do. */
  private loadedFor: string | null = null;
  /** Which retry the held overlay came from: a retry refetches, a re-render does not. */
  private attemptForHeld = 0;
  private readonly _objectUrl = signal<string | null>(null);
  private readonly _problem = signal<ProblemView | null>(null);
  /** Bumped by the problem panel's retry. */
  private readonly _attempt = signal(0);

  /**
   * Off for each new case, and then the officer's to decide. Keyed to `caseId` rather than to
   * `isPrimary` on purpose: a background refresh restates the inputs, and keying the state to a
   * value a re-render can restate is what made the overlay switch itself off.
   */
  private readonly _on = linkedSignal<string, boolean>({
    source: this.caseId,
    computation: () => false,
  });

  /** The photograph's `aspect-ratio`, once it has loaded and said what it is. */
  private readonly _aspect = linkedSignal<string, string | null>({
    source: this.imageId,
    computation: () => null,
  });

  protected readonly overlayUrl = this._objectUrl.asReadonly();
  protected readonly problem = this._problem.asReadonly();
  protected readonly aspect = this._aspect.asReadonly();
  protected readonly overlayOn = this._on.asReadonly();

  /** WEB-FR-212 — the single gate on whether the control exists at all. */
  protected readonly toggleVisible = computed(() => this.isPrimary() && this._objectUrl() !== null);

  protected readonly overlayVisible = computed(() => this.toggleVisible() && this._on());

  constructor() {
    /**
     * Fetched as soon as the server says there is an overlay, not on first press, so that a
     * failure is known BEFORE the toggle is offered — discovering it on the officer's first
     * press is exactly the broken control WEB-FR-212 forbids.
     *
     * A re-run for a case whose overlay is already in hand does NOTHING: no revoke, no refetch,
     * no flicker. Only a different case, or an explicit retry, starts again.
     */
    effect((onCleanup) => {
      const caseId = this.caseId();
      const wanted = this.overlayAvailable();
      const attempt = this._attempt();

      const alreadyHeld = this.loadedFor === caseId && this.objectUrl !== null;
      if (wanted && alreadyHeld && attempt === this.attemptForHeld) return;

      let cancelled = false;
      onCleanup(() => {
        cancelled = true;
      });

      this.adopt(null, null);
      this._problem.set(null);
      if (!wanted) return;

      this.gradcam.load(caseId).then(
        (url) => {
          // A component destroyed, or a case switched, mid-flight still owns this object URL.
          if (cancelled) {
            this.gradcam.revoke(url);
            return;
          }
          this.attemptForHeld = attempt;
          this.adopt(url, caseId);
        },
        (error: unknown) => {
          if (cancelled) return;
          // A storage outage is worth telling the officer about; a 404 is simply "no overlay".
          if (error instanceof GradcamFailedError) this._problem.set(error.problem);
          this.overlayUnavailable.emit();
        },
      );
    });

    // A blob object URL is a document-lifetime root: a leaked one pins the PNG in memory until
    // the tab closes, and an officer working a queue mounts this component dozens of times.
    inject(DestroyRef).onDestroy(() => this.adopt(null, null));
  }

  protected toggle(): void {
    this._on.update((on) => !on);
  }

  protected retry(): void {
    this._attempt.update((attempt) => attempt + 1);
  }

  protected onPhotoSize(size: PhotoSize): void {
    this._aspect.set(`${size.width} / ${size.height}`);
  }

  private adopt(next: string | null, forCase: string | null): void {
    if (this.objectUrl !== null) this.gradcam.revoke(this.objectUrl);
    this.objectUrl = next;
    this.loadedFor = forCase;
    this._objectUrl.set(next);
  }
}
