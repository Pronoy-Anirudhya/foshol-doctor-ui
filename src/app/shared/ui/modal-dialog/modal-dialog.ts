import { ChangeDetectionStrategy, Component, effect, input, output, viewChild, type ElementRef } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { Icon } from '../icon/icon';

/**
 * A modal dialog, built on the platform's own `<dialog>` element.
 *
 * The element is the whole reason this component is ~50 lines rather than ~250. `showModal()`
 * gives us the focus trap, `Escape`-to-close, inertness of everything behind it, the top layer
 * and focus restoration to the invoking control — all of it, from the browser, correctly, with
 * **no new dependency** (`WEB-NFR-007`). A hand-rolled overlay would have to re-implement each
 * of those and would get at least one of them wrong.
 *
 * `Escape` and the close button therefore take the SAME path: both end in the element's native
 * `close` event, which is the only thing that emits `closed`. There is no second way out, so the
 * two can never drift apart.
 *
 * The owner keeps the open state and passes it down; this component never closes itself
 * unilaterally, so a dialog mid-submit cannot vanish underneath the request it started.
 *
 * `WEB-UX-031` — a full-height sheet below `sm`, a centred panel above it; the body scrolls
 * inside the dialog so nothing overflows the viewport at 360 px.
 */
@Component({
  selector: 'foshol-modal-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, Icon],
  host: { class: 'contents' },
  templateUrl: './modal-dialog.html',
  styleUrl: './modal-dialog.css',
})
export class ModalDialog {
  readonly open = input(false);
  readonly titleKey = input.required<string>();
  /** The dialog's own heading id, so the caller can keep its content free of layout concerns. */
  readonly headingId = input('modal-dialog-title');

  /** Fired for EVERY close — the button, `Escape`, or a programmatic one. */
  readonly closed = output<void>();

  private readonly dialogRef = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    effect(() => {
      const element = this.dialogRef().nativeElement;
      const shouldBeOpen = this.open();
      // Guarded both ways: calling `showModal()` on an already-open dialog throws, and `close()`
      // on a shut one would fire a second `close` event and emit a duplicate `closed`.
      if (shouldBeOpen && !element.open) this.show(element);
      // No `closed` emission on this path: the owner is the one that lowered `open`, so telling
      // it what it just did would be an echo, and would double-count a close it already handled.
      else if (!shouldBeOpen && element.open) this.hide(element);
    });
  }

  /**
   * `showModal()` where it exists, which is every browser this application supports — it has
   * been baseline since 2022 and is what provides the focus trap and `Escape`.
   *
   * The fallback exists for **jsdom**, whose `HTMLDialogElement` has no `showModal` at all, so
   * without it every spec that opens a dialog throws. Falling back to the `open` attribute
   * renders the same content non-modally, which is exactly what a unit test needs to assert on
   * and is a strictly better failure than an exception. It is not a browser code path.
   */
  private show(element: HTMLDialogElement): void {
    if (typeof element.showModal === 'function') element.showModal();
    else element.open = true;
  }

  /** The `close()` counterpart of `show()`, with the same jsdom caveat. Emits nothing itself. */
  private hide(element: HTMLDialogElement): boolean {
    if (typeof element.close !== 'function') {
      element.open = false;
      return false;
    }
    element.close();
    return true;
  }

  /**
   * Routed through the element so the button and `Escape` converge on one `close` event — that
   * convergence is the reason there is no `this.closed.emit()` here.
   *
   * The one exception is the jsdom fallback: with no native `close()` there is no `close` event
   * either, so the emission that the event would have caused has to be made by hand.
   */
  protected requestClose(): void {
    if (!this.hide(this.dialogRef().nativeElement)) this.closed.emit();
  }
}
