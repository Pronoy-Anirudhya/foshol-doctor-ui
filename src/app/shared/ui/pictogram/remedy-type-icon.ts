import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { Remedy } from '../../../generated/models/remedy';

/**
 * A pictogram for a remedy's `type`, drawn by hand (WEB-NFR-007: no icon pack).
 *
 * WEB-UX-042 / WEB-UX-044 — the alternative text names the type, so the drawing and the hue
 * are both redundant cues rather than the only ones. The type itself is the server's enum
 * value, interpolated verbatim into the alt text and never translated into agronomic
 * wording (COMMON-CON-003, WEB-UX-016).
 *
 * The type union is imported from the generated client rather than restated, so a change to
 * the contract is a compile error here (WEB-API-005).
 */
type RemedyType = Remedy['type'];

const SIZES = { sm: 'h-5 w-5', md: 'h-8 w-8', lg: 'h-12 w-12' } as const;
type IconSize = keyof typeof SIZES;

const TINTS: Record<RemedyType, string> = {
  CULTURAL: 'text-dawn-700',
  ORGANIC: 'text-paddy-600',
  BIOLOGICAL: 'text-paddy-700',
  CHEMICAL: 'text-clay-600',
};

@Component({
  selector: 'foshol-remedy-type-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  host: { class: 'inline-flex' },
  template: `
    <svg
      viewBox="0 0 32 32"
      [class]="classes()"
      fill="none"
      [attr.role]="decorative() ? null : 'img'"
      [attr.aria-hidden]="decorative() ? true : null"
      [attr.aria-label]="
        decorative() ? null : ('shared.pictogram.remedyType' | translate: { type: type() })
      "
    >
      @switch (type()) {
        @case ('CULTURAL') {
          <!-- A hand hoe over ridged soil: the practice, not a product. -->
          <path d="M4 25h24" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          <path
            d="M7 25c1.5-2.4 3.2-2.4 4.6 0M15.4 25c1.5-2.4 3.2-2.4 4.6 0"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
          />
          <path d="M23 20 12 9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
          <path
            d="M22 5.5h6.5V12"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        }
        @case ('ORGANIC') {
          <!-- A leaf with a droplet: plant-derived. -->
          <path
            d="M26 6c0 11-6.4 18-16 18C10 13 16.4 6 26 6Z"
            fill="currentColor"
            fill-opacity="0.28"
            stroke="currentColor"
            stroke-width="2"
            stroke-linejoin="round"
          />
          <path
            d="M10 24C15 19 20 13.5 24.5 8"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
          />
          <path
            d="M22 22c1.6 1.7 1.6 3.6 0 5-1.7 1.4-3.4.5-3.6-1.4-.2-1.4 1.2-2.4 3.6-3.6Z"
            fill="currentColor"
          />
        }
        @case ('BIOLOGICAL') {
          <!-- A predatory beetle: biological control is a living agent. -->
          <ellipse
            cx="16"
            cy="18"
            rx="10"
            ry="9"
            fill="currentColor"
            fill-opacity="0.28"
            stroke="currentColor"
            stroke-width="2"
          />
          <path d="M16 9.2V27" stroke="currentColor" stroke-width="1.8" />
          <circle cx="16" cy="7.5" r="3.4" fill="currentColor" />
          <g fill="currentColor">
            <circle cx="10.8" cy="15.4" r="1.7" />
            <circle cx="21.2" cy="15.4" r="1.7" />
            <circle cx="11.6" cy="21.6" r="1.5" />
            <circle cx="20.4" cy="21.6" r="1.5" />
          </g>
        }
        @default {
          <!-- A pressure sprayer: an applied product, with its own handling rules. -->
          <path
            d="M12 12h8a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3h-8a3 3 0 0 1-3-3V15a3 3 0 0 1 3-3Z"
            fill="currentColor"
            fill-opacity="0.28"
            stroke="currentColor"
            stroke-width="2"
            stroke-linejoin="round"
          />
          <path
            d="M13.5 12V8.5h5V12"
            stroke="currentColor"
            stroke-width="2"
            stroke-linejoin="round"
          />
          <path
            d="M18.5 6h5.5M24 6l3.5 3"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
          />
          <path d="M12 18.5h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        }
      }
    </svg>
  `,
})
export class RemedyTypeIcon {
  readonly type = input.required<RemedyType>();
  readonly decorative = input(false);
  readonly size = input<IconSize>('md');

  protected readonly classes = computed(() => `${SIZES[this.size()]} ${TINTS[this.type()]}`);
}
