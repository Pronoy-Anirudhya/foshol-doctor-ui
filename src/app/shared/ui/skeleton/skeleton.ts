import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * WEB-FR-400 — the other half of "never leave a blank region": where the shape of the
 * incoming content is known, a skeleton holds the layout so nothing jumps when the data
 * lands. Where it is not, use `<foshol-spinner>`.
 *
 * The blocks themselves are `aria-hidden`: a screen reader gains nothing from being told
 * there are four grey rectangles. One visually-hidden `role="status"` line says the region is
 * loading, which is the information that matters (WEB-UX-046).
 */
const VARIANTS = {
  text: 'h-4 rounded-md',
  heading: 'h-7 rounded-lg',
  block: 'h-24 rounded-xl',
  media: 'aspect-[4/3] h-auto w-full rounded-2xl',
  chip: 'h-8 w-24 rounded-full',
} as const;

type SkeletonVariant = keyof typeof VARIANTS;

/**
 * Descending widths read as a paragraph rather than a stack of identical bars.
 *
 * Explicit percentages rather than Tailwind's `w-11/12` fractions: the fraction form is not
 * emitted when the candidate only ever appears inside a TypeScript string, which is exactly
 * where these live. Verified against the generated stylesheet, not assumed.
 */
const LINE_WIDTHS = ['w-full', 'w-[92%]', 'w-[76%]', 'w-[84%]', 'w-[66%]'] as const;

@Component({
  selector: 'foshol-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  host: { class: 'block', '[attr.aria-busy]': 'true' },
  template: `
    <span class="sr-only" role="status">{{ 'shared.skeleton.label' | translate }}</span>
    <div class="flex flex-col gap-3" aria-hidden="true">
      @for (line of lines(); track line.index) {
        <div class="animate-pulse bg-surface-2" [class]="line.classes"></div>
      }
    </div>
  `,
})
export class Skeleton {
  readonly variant = input<SkeletonVariant>('text');
  readonly count = input(1);

  protected readonly lines = computed(() => {
    const base = VARIANTS[this.variant()];
    const isText = this.variant() === 'text';
    return Array.from({ length: Math.max(1, this.count()) }, (_unused, index) => ({
      index,
      classes: isText ? `${base} ${LINE_WIDTHS[index % LINE_WIDTHS.length]}` : base,
    }));
  });
}
