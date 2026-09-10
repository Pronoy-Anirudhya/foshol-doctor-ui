import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * A hand-drawn crop pictogram, keyed by the crop's `iconKey` from the knowledge module.
 *
 * Hand-authored SVG rather than an icon pack: WEB-NFR-007 allows zero new runtime
 * dependencies, and no general-purpose pack contains a rice panicle anyway. These are a
 * visible part of the farmer experience — a farmer picks a crop by recognising the picture
 * before reading the label — so they are drawn as the plant, not as a lettered circle.
 *
 * WEB-UX-042 — meaningful alternative text on every one. `label` accepts the server's own
 * crop name where the caller has it (rendered verbatim, WEB-UX-016); otherwise a translated
 * description of the drawing is used, which describes the picture and authors no agronomy.
 *
 * An unknown or absent key falls back to a generic leaf rather than rendering nothing: a
 * fourth crop added to the seed data must not leave a hole in the picker.
 */
const RICE = 'crop-rice';
const TOMATO = 'crop-tomato';
const POTATO = 'crop-potato';
const CORN = 'crop-corn';
const WHEAT = 'crop-wheat';

const ALT_KEYS = new Map<string, string>([
  [RICE, 'shared.pictogram.crop.crop-rice'],
  [TOMATO, 'shared.pictogram.crop.crop-tomato'],
  [POTATO, 'shared.pictogram.crop.crop-potato'],
  [CORN, 'shared.pictogram.crop.crop-corn'],
  [WHEAT, 'shared.pictogram.crop.crop-wheat'],
]);
const GENERIC_ALT_KEY = 'shared.pictogram.crop.generic';

/** Sized here rather than by the caller so a pictogram can never render at zero height. */
const SIZES = { sm: 'h-6 w-6', md: 'h-10 w-10', lg: 'h-16 w-16' } as const;
type IconSize = keyof typeof SIZES;

@Component({
  selector: 'foshol-crop-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  host: { class: 'inline-flex' },
  template: `
    <svg
      viewBox="0 0 48 48"
      [class]="classes()"
      fill="none"
      [attr.role]="decorative() ? null : 'img'"
      [attr.aria-hidden]="decorative() ? true : null"
      [attr.aria-label]="decorative() ? null : label() || (altKey() | translate)"
    >
      @switch (resolvedKey()) {
        @case ('crop-rice') {
          <!-- A drooping panicle: arching culm, grains paired along it, one flag leaf. -->
          <path
            d="M21 44C21 35 21.6 26.5 25.5 19.5C27.8 15.3 31 12.4 35 11"
            stroke="currentColor"
            stroke-width="2.4"
            stroke-linecap="round"
          />
          <path
            d="M21.4 35C14.8 33.6 10.2 28.6 9.5 21.8C16.6 22.4 20.9 27.6 21.4 35Z"
            fill="currentColor"
            fill-opacity="0.28"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linejoin="round"
          />
          <g fill="currentColor">
            <ellipse cx="17.8" cy="31.5" rx="2.1" ry="3.6" transform="rotate(-32 17.8 31.5)" />
            <ellipse cx="19.4" cy="25.6" rx="2.1" ry="3.6" transform="rotate(-28 19.4 25.6)" />
            <ellipse cx="22.2" cy="20" rx="2.1" ry="3.6" transform="rotate(-22 22.2 20)" />
            <ellipse cx="26.2" cy="14.9" rx="2" ry="3.3" transform="rotate(-14 26.2 14.9)" />
            <ellipse cx="26.6" cy="30.4" rx="2.1" ry="3.6" transform="rotate(26 26.6 30.4)" />
            <ellipse cx="28.6" cy="24.6" rx="2.1" ry="3.6" transform="rotate(30 28.6 24.6)" />
            <ellipse cx="31.6" cy="19.2" rx="2.1" ry="3.6" transform="rotate(36 31.6 19.2)" />
            <ellipse cx="35.6" cy="14.6" rx="2" ry="3.3" transform="rotate(44 35.6 14.6)" />
          </g>
        }
        @case ('crop-tomato') {
          <!-- Fruit, calyx and a short cut stem. -->
          <circle
            cx="24"
            cy="28.5"
            r="14"
            fill="currentColor"
            fill-opacity="0.28"
            stroke="currentColor"
            stroke-width="2.2"
          />
          <path
            d="M24 21.5C22.5 25 21.5 29 21.5 33"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-opacity="0.7"
          />
          <path
            d="M24 15.5C19.6 10.8 14.4 9.4 9.5 10.6C12.6 15.4 18 17.4 24 15.5Z"
            fill="currentColor"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linejoin="round"
          />
          <path
            d="M24 15.5C28.4 10.8 33.6 9.4 38.5 10.6C35.4 15.4 30 17.4 24 15.5Z"
            fill="currentColor"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linejoin="round"
          />
          <path d="M24 15.5V8.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
        }
        @case ('crop-potato') {
          <!-- Tuber: an irregular oval with eyes, not a circle. -->
          <path
            d="M11.8 22.5C13 14.8 20.4 10.2 28.8 11.2C37.2 12.2 42.3 18.4 41 26.4C39.7 34.4 32.9 39.6 24.4 38.8C15.9 38 10.6 30.2 11.8 22.5Z"
            fill="currentColor"
            fill-opacity="0.28"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linejoin="round"
          />
          <g fill="currentColor">
            <ellipse cx="20" cy="21" rx="2.1" ry="1.4" transform="rotate(-20 20 21)" />
            <ellipse cx="30" cy="18.6" rx="2.1" ry="1.4" transform="rotate(12 30 18.6)" />
            <ellipse cx="32.6" cy="29.4" rx="2.1" ry="1.4" transform="rotate(-16 32.6 29.4)" />
            <ellipse cx="21.8" cy="30.8" rx="2.1" ry="1.4" transform="rotate(8 21.8 30.8)" />
          </g>
        }
        @case ('crop-corn') {
          <!-- A cob in its husk: kernels banded across it, two husk leaves swept back. -->
          <path
            d="M24 6.5C29.6 6.5 33.2 13.2 33.2 22.5C33.2 31.8 29.6 40.5 24 40.5C18.4 40.5 14.8 31.8 14.8 22.5C14.8 13.2 18.4 6.5 24 6.5Z"
            fill="currentColor"
            fill-opacity="0.28"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linejoin="round"
          />
          <g stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-opacity="0.75">
            <path d="M24 9V38" />
            <path d="M18.4 15.5H29.6" />
            <path d="M17.2 22H30.8" />
            <path d="M17.4 28.5H30.6" />
            <path d="M19.2 34.5H28.8" />
          </g>
          <path
            d="M14.9 21.5C10.2 24.2 7.8 30.6 9.4 37.4C15.1 35.4 17.6 29.1 14.9 21.5Z"
            fill="currentColor"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linejoin="round"
          />
          <path
            d="M33.1 21.5C37.8 24.2 40.2 30.6 38.6 37.4C32.9 35.4 30.4 29.1 33.1 21.5Z"
            fill="currentColor"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linejoin="round"
          />
        }
        @case ('crop-wheat') {
          <!-- An upright ear: paired grains climbing a straight culm, awns at the tip.
               Deliberately symmetric and vertical, so it never reads as the rice panicle,
               which arches and droops. -->
          <path d="M24 44V16" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
          <g stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
            <path d="M24 10.5V4.5" />
            <path d="M20.6 11.5L17.6 6.6" />
            <path d="M27.4 11.5L30.4 6.6" />
          </g>
          <g fill="currentColor">
            <ellipse cx="24" cy="14.6" rx="2" ry="3.4" />
            <ellipse cx="19.9" cy="18.4" rx="2.1" ry="3.6" transform="rotate(-34 19.9 18.4)" />
            <ellipse cx="28.1" cy="18.4" rx="2.1" ry="3.6" transform="rotate(34 28.1 18.4)" />
            <ellipse cx="19.5" cy="25.2" rx="2.1" ry="3.6" transform="rotate(-34 19.5 25.2)" />
            <ellipse cx="28.5" cy="25.2" rx="2.1" ry="3.6" transform="rotate(34 28.5 25.2)" />
            <ellipse cx="19.5" cy="32" rx="2.1" ry="3.6" transform="rotate(-34 19.5 32)" />
            <ellipse cx="28.5" cy="32" rx="2.1" ry="3.6" transform="rotate(34 28.5 32)" />
          </g>
          <path
            d="M24 36.8C21.2 34.4 17.4 34.4 14.4 36.8C17.2 39.8 21.2 40.1 24 36.8Z"
            fill="currentColor"
            fill-opacity="0.28"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linejoin="round"
          />
        }
        @default {
          <!-- Generic foliage, for a crop this build has never seen. -->
          <path
            d="M39 9C39 25.5 29.5 39 12 39C12 22.5 21.5 9 39 9Z"
            fill="currentColor"
            fill-opacity="0.28"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linejoin="round"
          />
          <path
            d="M12 39C19.5 31 27.5 21.5 36.5 11.5"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
          />
        }
      }
    </svg>
  `,
})
export class CropIcon {
  readonly iconKey = input<string | null | undefined>(null);
  /** The server's own crop name, when the caller has it. Rendered verbatim. */
  readonly label = input('');
  /** Set when an adjacent text label already names the crop, so the icon is redundant. */
  readonly decorative = input(false);
  readonly size = input<IconSize>('md');

  protected readonly resolvedKey = computed(() => {
    const key = this.iconKey() ?? '';
    return ALT_KEYS.has(key) ? key : '';
  });

  protected readonly altKey = computed(() => ALT_KEYS.get(this.resolvedKey()) ?? GENERIC_ALT_KEY);

  /** Hue is a second, redundant cue only; the alt text carries the meaning (WEB-UX-044). */
  private readonly tint = computed(() => {
    switch (this.resolvedKey()) {
      case TOMATO:
        return 'text-clay-600';
      case POTATO:
        return 'text-dawn-700';
      case CORN:
        return 'text-dawn-600';
      case WHEAT:
        return 'text-dawn-700';
      default:
        return 'text-paddy-600';
    }
  });

  protected readonly classes = computed(() => `${SIZES[this.size()]} ${this.tint()}`);
}
