import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { SseStore, SSE_OPEN } from '../../../core/sse/sse-store';

/**
 * WEB-FR-357 — while the SSE connection is not open, a **discreet** reconnecting indicator,
 * and the rest of the UI stays fully usable.
 *
 * Deliberately not a blocking overlay, not a modal and not a full-width bar. A dropped stream
 * is a degraded live-update path, not a broken application: every screen still works, the
 * manual refresh control is the documented fallback (WEB-FR-356), and a farmer mid-capture
 * must not be interrupted by it.
 *
 * WEB-UX-044 — the dot's colour is a second cue only; the state is spelled out in words
 * beside it at `md` and up, and always in the `aria-label`.
 *
 * WEB-NFR-001 — the state is read, never inferred. `SseStore` owns the transport's truth.
 */
const STATE_KEY_PREFIX = 'shared.sse.';
/**
 * A separate, fuller sentence for the accessible name. Concatenating a label and a value in
 * the template would be a user-visible string literal, which WEB-UX-013 forbids, and would
 * read badly in Bangla word order besides.
 */
const ARIA_KEY_PREFIX = 'shared.sse.aria.';

@Component({
  selector: 'foshol-sse-indicator',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  host: { class: 'inline-flex' },
  template: `
    @if (visible()) {
      <span
        class="inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium"
        [class]="toneClass()"
        [attr.aria-label]="ariaKey() | translate"
      >
        <span class="relative flex h-2 w-2 shrink-0" aria-hidden="true">
          @if (degraded()) {
            <span
              class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
              [class]="dotClass()"
            ></span>
          }
          <span class="relative inline-flex h-2 w-2 rounded-full" [class]="dotClass()"></span>
        </span>
        <span class="hidden md:inline" aria-hidden="true">{{ stateKey() | translate }}</span>
      </span>
    }
  `,
})
export class SseIndicator {
  private readonly sse = inject(SseStore);

  /**
   * The header shows the healthy state too, because on a demo stage "Live" beside the case
   * list is the visible proof that nothing is polling (WEB-FR-356). Set false where only the
   * degraded state is worth the pixels.
   */
  readonly showWhenOpen = input(true);
  readonly tone = input<'light' | 'dark'>('light');

  protected readonly degraded = this.sse.isDegraded;
  protected readonly visible = computed(() => this.degraded() || this.showWhenOpen());
  protected readonly stateKey = computed(() => `${STATE_KEY_PREFIX}${this.sse.connectionState()}`);
  protected readonly ariaKey = computed(() => `${ARIA_KEY_PREFIX}${this.sse.connectionState()}`);

  protected readonly dotClass = computed(() =>
    this.sse.connectionState() === SSE_OPEN ? 'bg-paddy-500' : 'bg-dawn-600',
  );

  protected readonly toneClass = computed(() => {
    const dark = this.tone() === 'dark';
    if (this.degraded()) {
      return dark ? 'bg-slate-900/70 text-dawn-300' : 'bg-dawn-100 text-dawn-700';
    }
    return dark ? 'bg-slate-900/70 text-surface-2' : 'bg-surface-2 text-ink-muted';
  });
}
