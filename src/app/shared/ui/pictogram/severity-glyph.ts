import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { Disease } from '../../../generated/models/disease';

/**
 * A severity glyph whose meaning survives with the colours turned off.
 *
 * WEB-UX-044 — colour is never the sole carrier of meaning, so each level gets a distinct
 * SHAPE as well as a distinct hue, and the alternative text names the level. The three cues
 * are redundant on purpose: a monochrome projector, a colour-blind judge and a screen reader
 * all get the same answer.
 *
 * WEB-NFR-001 — the level is rendered exactly as the server sent it. Nothing here decides
 * what is severe.
 */
type Severity = Disease['severity'];

const SIZES = { sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-7 w-7' } as const;
type GlyphSize = keyof typeof SIZES;

const TINTS: Record<Severity, string> = {
  NONE: 'text-ink-faint',
  LOW: 'text-paddy-600',
  MODERATE: 'text-dawn-600',
  HIGH: 'text-dawn-700',
  CRITICAL: 'text-clay-600',
};

@Component({
  selector: 'foshol-severity-glyph',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  host: { class: 'inline-flex' },
  template: `
    <svg
      viewBox="0 0 24 24"
      [class]="classes()"
      fill="none"
      [attr.role]="decorative() ? null : 'img'"
      [attr.aria-hidden]="decorative() ? true : null"
      [attr.aria-label]="
        decorative() ? null : ('shared.pictogram.severity' | translate: { severity: severity() })
      "
    >
      @switch (severity()) {
        @case ('NONE') {
          <!-- Open circle, struck through: nothing recorded. -->
          <circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="2" />
          <path d="M8 12h8" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        }
        @case ('LOW') {
          <!-- Filled circle: the calmest shape there is. -->
          <circle cx="12" cy="12" r="8.5" fill="currentColor" />
        }
        @case ('MODERATE') {
          <!-- Rounded square: a corner appears; attention is being asked for. -->
          <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" fill="currentColor" />
        }
        @case ('HIGH') {
          <!-- Triangle: the universal warning shape, before any colour is applied. -->
          <path
            d="M12 3.2 21.6 20H2.4L12 3.2Z"
            fill="currentColor"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linejoin="round"
          />
          <path
            d="M12 9.6v4.2"
            stroke="var(--color-ink-invert)"
            stroke-width="1.9"
            stroke-linecap="round"
          />
          <circle cx="12" cy="16.6" r="1.05" fill="var(--color-ink-invert)" />
        }
        @default {
          <!-- Octagon: the stop sign, and the only shape with eight sides here. -->
          <path
            d="M8.2 2.6h7.6L21.4 8.2v7.6L15.8 21.4H8.2L2.6 15.8V8.2L8.2 2.6Z"
            fill="currentColor"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linejoin="round"
          />
          <path
            d="M12 7.4v5.4"
            stroke="var(--color-ink-invert)"
            stroke-width="2"
            stroke-linecap="round"
          />
          <circle cx="12" cy="16.4" r="1.15" fill="var(--color-ink-invert)" />
        }
      }
    </svg>
  `,
})
export class SeverityGlyph {
  readonly severity = input.required<Severity>();
  readonly decorative = input(false);
  readonly size = input<GlyphSize>('md');

  protected readonly classes = computed(() => `${SIZES[this.size()]} ${TINTS[this.severity()]}`);
}
