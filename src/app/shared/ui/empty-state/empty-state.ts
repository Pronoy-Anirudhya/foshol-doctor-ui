import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * "Nothing here" is a real state with a real design, not an accidental blank area
 * (WEB-FR-400). An empty officer queue on stage should look deliberate.
 *
 * The illustration slot takes a pictogram; the action slot takes the one control that
 * resolves the emptiness, if there is one.
 */
@Component({
  selector: 'foshol-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  host: { class: 'block' },
  template: `
    <div
      class="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-surface-3 bg-surface-0/60 px-6 py-10 text-center"
    >
      <div class="text-ink-faint"><ng-content select="[slot=illustration]" /></div>
      <p class="text-base font-semibold text-ink">{{ titleKey() | translate }}</p>
      @if (detailKey()) {
        <p class="max-w-prose text-sm text-ink-muted">{{ detailKey() | translate }}</p>
      }
      <div class="mt-2 empty:hidden"><ng-content /></div>
    </div>
  `,
})
export class EmptyState {
  readonly titleKey = input('shared.empty.title');
  readonly detailKey = input('');
}
