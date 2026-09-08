import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { LiveAnnouncer } from '../../../core/stores/live-announcer';

/**
 * WEB-UX-046 — THE ARIA live region. One, for the whole application, rendered once by the
 * shell: case transitions, SSE toasts and action results all announce through
 * `LiveAnnouncer` and surface here. Several polite regions competing on one page is how a
 * screen reader ends up reading none of them, so no other component declares one.
 *
 * `polite` rather than `assertive`: none of these interruptions is urgent enough to cut
 * across what the user is already being read.
 *
 * The store holds a translation KEY, so the announcement follows the language toggle
 * (WEB-UX-012) without the store ever knowing a locale exists. `@if (message.seq)` keyed on
 * the sequence number means announcing the same key twice really does re-fire the region,
 * which it would not if the text simply stayed identical.
 */
@Component({
  selector: 'foshol-live-region',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  host: { class: 'contents' },
  template: `
    <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
      @if (message(); as current) {
        @for (seq of [current.seq]; track seq) {
          <span>{{ current.key | translate: current.params }}</span>
        }
      }
    </div>
  `,
})
export class LiveRegion {
  private readonly announcer = inject(LiveAnnouncer);
  protected readonly message = this.announcer.message;
}
