import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * The one `<h1>` of a routed page, plus an optional eyebrow, an optional subtitle and a slot
 * for page-level actions. Having a single component own it is what keeps the heading order
 * predictable across surfaces built by different agents (WEB-UX-040).
 *
 * Two ways in, on purpose:
 *  - `titleKey` for chrome the frontend authors, resolved through ngx-translate (WEB-UX-013);
 *  - `titleText` for a value that came from the server, rendered VERBATIM and never
 *    translated (WEB-UX-016, COMMON-CON-003). `titleText` wins when both are supplied.
 */
@Component({
  selector: 'foshol-page-heading',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  host: { class: 'block' },
  template: `
    <div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div class="min-w-0 flex-1">
        @if (eyebrowKey()) {
          <p class="text-xs font-semibold tracking-wide text-ink-faint uppercase font-latin">
            {{ eyebrowKey() | translate }}
          </p>
        }
        <h1 class="mt-1 text-2xl leading-tight text-ink md:text-3xl">
          @if (titleText()) {
            {{ titleText() }}
          } @else {
            {{ titleKey() | translate }}
          }
        </h1>
        @if (subtitleKey()) {
          <p class="mt-2 max-w-prose text-sm text-ink-muted md:text-base">
            {{ subtitleKey() | translate }}
          </p>
        }
        @if (subtitleText()) {
          <p class="mt-2 max-w-prose text-sm text-ink-muted md:text-base">{{ subtitleText() }}</p>
        }
      </div>
      <div class="flex shrink-0 flex-wrap items-center gap-2">
        <ng-content />
      </div>
    </div>
  `,
})
export class PageHeading {
  readonly titleKey = input('');
  readonly titleText = input('');
  readonly eyebrowKey = input('');
  readonly subtitleKey = input('');
  readonly subtitleText = input('');
}
