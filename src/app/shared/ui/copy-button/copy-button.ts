import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { APP_CONFIG } from '../../../core/config/app-config';

/**
 * Copies a short value — in practice a correlation id (WEB-FR-005) — and confirms that it
 * did. The demo machine has no log aggregator, so the id on screen is how a failure gets
 * diagnosed in the room; being able to paste it into a chat message is the point.
 *
 * Degrades gracefully. The Clipboard API needs a secure context, so on plain `http://` to a
 * non-localhost host it is simply absent. In that case the button is not rendered at all and
 * the value beside it stays selectable text — a button that cannot work is worse than none.
 */
const IDLE = 'idle';
const COPIED = 'copied';
const FAILED = 'failed';

type CopyState = typeof IDLE | typeof COPIED | typeof FAILED;

@Component({
  selector: 'foshol-copy-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  host: { class: 'contents' },
  template: `
    @if (supported) {
      <button
        type="button"
        class="touch-target inline-flex items-center justify-center gap-1.5 rounded-lg border border-surface-3 bg-surface-0 px-3 text-sm font-medium text-ink-muted transition-colors duration-1 ease-settle hover:bg-surface-1 active:bg-surface-2"
        (click)="copy()"
      >
        <svg viewBox="0 0 20 20" class="h-4 w-4 shrink-0" aria-hidden="true" fill="none">
          @if (state() === 'copied') {
            <path
              d="M4.5 10.5l3.5 3.5 7.5-8"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          } @else {
            <rect
              x="7"
              y="7"
              width="9"
              height="9"
              rx="2"
              stroke="currentColor"
              stroke-width="1.5"
            />
            <path
              d="M13 5.5A1.5 1.5 0 0011.5 4h-6A1.5 1.5 0 004 5.5v6A1.5 1.5 0 005.5 13"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            />
          }
        </svg>
        <span class="whitespace-nowrap" aria-live="polite">{{ labelKey() | translate }}</span>
      </button>
    }
  `,
})
export class CopyButton {
  readonly value = input('');

  /**
   * A secure context is required for `navigator.clipboard`, so this is resolved once rather
   * than assumed. `readonly` field, not a signal: the capability cannot change mid-session.
   */
  protected readonly supported =
    typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function';

  protected readonly state = signal<CopyState>(IDLE);
  private resetTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly labelKey = computed(() => {
    const current = this.state();
    if (current === COPIED) return 'shared.copy.done';
    if (current === FAILED) return 'shared.copy.failed';
    return 'shared.copy.action';
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearReset());
  }

  protected async copy(): Promise<void> {
    const text = this.value();
    if (text.length === 0) return;
    try {
      await navigator.clipboard.writeText(text);
      this.state.set(COPIED);
    } catch {
      // Permission denied, or a browser that exposes the API and refuses it. Say so rather
      // than pretending; the user can still select the text by hand.
      this.state.set(FAILED);
    }
    this.clearReset();
    this.resetTimer = setTimeout(() => this.state.set(IDLE), APP_CONFIG.ui.toastMs);
  }

  private clearReset(): void {
    if (this.resetTimer !== undefined) clearTimeout(this.resetTimer);
    this.resetTimer = undefined;
  }
}
