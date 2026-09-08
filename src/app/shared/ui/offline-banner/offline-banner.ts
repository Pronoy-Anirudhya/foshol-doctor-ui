import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ConnectivityStore } from '../../../core/stores/connectivity-store';

/**
 * WEB-FR-402 — while the network is offline, say so, and say plainly that the draft is kept.
 *
 * The reassurance is the point. A farmer who has just photographed three leaves and dictated a
 * description needs to know that walking out of signal has not lost any of it: the draft lives
 * in memory (`WEB-DATA-020` keeps image and audio bytes out of storage entirely) and is still
 * there when the connection returns.
 *
 * A banner, never a modal: `WEB-FR-357`'s "keep the rest of the UI fully usable" is the same
 * instinct, and a farmer offline can still finish composing a case.
 *
 * WEB-UX-044 — the dawn hue is a second cue; the glyph and the sentence carry the meaning.
 */
@Component({
  selector: 'foshol-offline-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  host: { class: 'block' },
  template: `
    @if (offline()) {
      <div
        class="flex items-start gap-3 border-b border-dawn-300 bg-dawn-100 px-4 py-3 text-dawn-700 md:px-6"
        role="status"
      >
        <svg viewBox="0 0 24 24" class="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" fill="none">
          <path d="M3 4.5l18 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          <path
            d="M4.6 9.4a13 13 0 0 1 4.2-2.5M19.4 9.4a13 13 0 0 0-6.9-2.9M7.6 12.9a8.6 8.6 0 0 1 2-1.2M16.4 12.9a8.6 8.6 0 0 0-2.6-1.4"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
          />
          <circle cx="12" cy="18.4" r="1.3" fill="currentColor" />
        </svg>
        <div class="min-w-0">
          <p class="text-sm font-semibold">{{ 'shared.offline.title' | translate }}</p>
          <p class="mt-0.5 max-w-prose text-sm">{{ 'shared.offline.detail' | translate }}</p>
        </div>
      </div>
    }
  `,
})
export class OfflineBanner {
  private readonly connectivity = inject(ConnectivityStore);
  protected readonly offline = this.connectivity.offline;
}
