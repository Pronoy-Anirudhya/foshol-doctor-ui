import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * The interface icon set — one drawing language for every control in the application.
 *
 * `WEB-NFR-007` allows zero new runtime dependencies, so there is no icon pack; these are drawn
 * by hand, like the three pictograms in `../pictogram/`. They follow that same contract:
 * `inline-flex` host, a `SIZES` record so a caller can never render one at zero height,
 * `currentColor` throughout so the icon inherits whatever the surface says, and a `decorative`
 * input driving `role` / `aria-hidden`.
 *
 * They replace the emoji that used to sit in these slots. An emoji is not a design decision: it
 * renders in the platform's own colours at the platform's own weight, so 🖼️ and 📷 arrived
 * full-colour and cartoon-shaped in the middle of a muted agricultural palette, and ⚠ came out
 * a different shape on every operating system. A stroked glyph inherits the type colour and the
 * optical weight of everything around it, which is the whole reason it looks finished.
 *
 * One geometry, one weight: 24×24 box, 1.8 stroke, round caps and joins. Anything solid is a
 * deliberate exception, and there is only one — the play triangle, which reads as a hole at this
 * size when it is stroked.
 */
const SIZES = {
  xs: 'h-3.5 w-3.5',
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-6 w-6',
} as const;
type IconSize = keyof typeof SIZES;

export type IconName =
  | 'gallery'
  | 'camera'
  | 'hourglass'
  | 'arrow-left'
  | 'arrow-right'
  | 'close'
  | 'refresh'
  | 'resubmit'
  | 'warning'
  | 'play'
  | 'pause'
  | 'image-broken'
  | 'minus'
  | 'plus'
  | 'bell'
  | 'inbox'
  | 'pin';

@Component({
  selector: 'foshol-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex' },
  template: `
    <svg
      viewBox="0 0 24 24"
      [class]="classes()"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      [attr.role]="label() === '' ? null : 'img'"
      [attr.aria-hidden]="label() === '' ? true : null"
      [attr.aria-label]="label() === '' ? null : label()"
    >
      @switch (name()) {
        @case ('gallery') {
          <!-- A framed picture with a horizon and a sun: "choose one you already took". -->
          <rect x="3" y="4.5" width="18" height="15" rx="2.6" />
          <circle cx="8.6" cy="9.8" r="1.6" />
          <path d="M3.6 16.8 8.8 12l3.4 3.1 3-2.6 4.2 3.9" />
        }
        @case ('camera') {
          <!-- Body, hump and lens. The hump is what makes it read as a camera and not a box. -->
          <path d="M3 8.6a2 2 0 0 1 2-2h1.9l1.3-2h5.6l1.3 2H19a2 2 0 0 1 2 2v8.8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
          <circle cx="12" cy="13" r="3.5" />
        }
        @case ('hourglass') {
          <!-- Waiting, with the sand actually drawn: a shape that means "not yet". -->
          <path d="M7 3h10M7 21h10" />
          <path d="M8 3v3.2a4 4 0 0 0 1.5 3.1L12 12l-2.5 2.7A4 4 0 0 0 8 17.8V21" />
          <path d="M16 3v3.2a4 4 0 0 1-1.5 3.1L12 12l2.5 2.7a4 4 0 0 1 1.5 3.1V21" />
          <path d="M10 19.4h4" stroke-width="2.4" />
        }
        @case ('arrow-left') {
          <path d="M19 12H5" />
          <path d="m11 6-6 6 6 6" />
        }
        @case ('arrow-right') {
          <path d="M5 12h14" />
          <path d="m13 6 6 6-6 6" />
        }
        @case ('close') {
          <path d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6" />
        }
        @case ('refresh') {
          <!-- An arc with one arrowhead, not a closed ring: a closed ring reads as "loading". -->
          <path d="M20.2 12a8.2 8.2 0 1 1-2.6-6" />
          <path d="M20.4 4.6v5h-5" />
        }
        @case ('resubmit') {
          <!-- Turn and come back — a resubmission is the farmer's second attempt, not an undo. -->
          <path d="M4 9.4h11.2a4.4 4.4 0 0 1 0 8.8H8" />
          <path d="m7.6 5 -3.6 4.4 3.6 4.4" />
        }
        @case ('warning') {
          <path d="M12 3.6 21.4 19.6a1.6 1.6 0 0 1-1.4 2.4H4a1.6 1.6 0 0 1-1.4-2.4Z" />
          <path d="M12 9.6v4.6" />
          <path d="M12 17.8h.01" stroke-width="2.4" />
        }
        @case ('play') {
          <!-- The one filled glyph: a stroked triangle this small reads as a hole. -->
          <path d="M8 5.4 19 12 8 18.6Z" fill="currentColor" />
        }
        @case ('pause') {
          <path d="M9.2 5.6v12.8M14.8 5.6v12.8" stroke-width="2.6" />
        }
        @case ('image-broken') {
          <!-- The gallery frame with its corner torn away: the picture that would not load. -->
          <path d="M3 8.2V6.5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-1.6" />
          <path d="M3 12.4v5.1a2 2 0 0 0 2 2h8.4" />
          <path d="M3.8 17 8.8 12l2.6 2.4" />
          <circle cx="8.6" cy="8.8" r="1.4" />
          <path d="m3 10.4 1.8-1.2M21 10.4l-1.8-1.2" stroke-dasharray="0.1 3.2" />
        }
        @case ('minus') {
          <path d="M6 12h12" stroke-width="2.2" />
        }
        @case ('plus') {
          <path d="M12 6v12M6 12h12" stroke-width="2.2" />
        }
        @case ('pin') {
          <!-- A map pin: where a case is filed, and the only place region appears in this UI. -->
          <path d="M12 21.2s7-5.6 7-11.2a7 7 0 1 0-14 0c0 5.6 7 11.2 7 11.2Z" />
          <circle cx="12" cy="10" r="2.6" />
        }
        @case ('bell') {
          <path d="M18 9.4a6 6 0 1 0-12 0c0 4.3-1.4 5.8-2 6.6a.7.7 0 0 0 .6 1.1h14.8a.7.7 0 0 0 .6-1.1c-.6-.8-2-2.3-2-6.6Z" />
          <path d="M10.2 20.2a2.2 2.2 0 0 0 3.6 0" />
        }
        @default {
          <!-- inbox — a tray with the lid open, for the empty notification panel. -->
          <path d="M3.4 13.6h4.2l1.4 2.6h6l1.4-2.6h4.2" />
          <path d="M6.2 4.6h11.6l2.8 9v4.2a2 2 0 0 1-2 2H5.4a2 2 0 0 1-2-2v-4.2Z" />
        }
      }
    </svg>
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input<IconSize>('md');
  /**
   * Empty means decorative, which is the common case: the control around the icon already
   * carries its own label. Pass an already-translated string to make the icon itself the label,
   * for the rare control that has no visible text of its own.
   */
  readonly label = input('');

  protected readonly classes = computed(() => SIZES[this.size()]);
}
