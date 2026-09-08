import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * A consistent "go back" affordance for a page that is one step into a flow (a step of case
 * capture, a claimed case in the console) rather than a persona's own landing page — the
 * header's brand mark already routes home, so this is for the step in between.
 *
 * `variant` only recolours the chevron/text to the persona it sits in (paddy for the farmer
 * surface, slate for the officer console) — same component, same behaviour either way.
 */
@Component({
  selector: 'foshol-back-link',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslatePipe],
  host: { class: 'block' },
  template: `
    <a
      [routerLink]="to()"
      class="touch-target group inline-flex items-center gap-1.5 text-sm font-semibold transition-transform duration-1 ease-settle hover:-translate-x-0.5"
      [class]="colourClass()"
    >
      <svg viewBox="0 0 16 16" class="h-4 w-4 shrink-0" aria-hidden="true" fill="none">
        <path
          d="M10 3.5 5.5 8l4.5 4.5"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <span class="underline underline-offset-2">{{ labelKey() | translate }}</span>
    </a>
  `,
})
export class BackLink {
  readonly to = input.required<string | readonly unknown[]>();
  readonly labelKey = input.required<string>();
  readonly variant = input<'farmer' | 'console'>('farmer');

  protected readonly colourClass = computed(() =>
    this.variant() === 'console' ? 'text-slate-700' : 'text-paddy-700',
  );
}
