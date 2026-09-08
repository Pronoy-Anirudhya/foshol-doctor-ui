import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { ProblemView } from '../../../core/errors/problem';
import { APP_CONFIG } from '../../../core/config/app-config';

/**
 * WEB-FR-005 — a failed login shows the problem document's `title` and `detail`, and its
 * `correlationId` in copyable form. The demo machine has no log aggregator: the correlation id
 * on screen is how a failure gets diagnosed in the room.
 *
 * The status code is deliberately NOT rendered. A number is not an explanation, so where the
 * server sent no human-readable text this falls back to the friendly translated copy that
 * `ProblemView` already names in `titleKey` / `detailKey`. Everything is interpolated as text —
 * never `innerHTML` (`WEB-SEC-005`).
 *
 * `role="alert"` makes the failure announce itself (`WEB-UX-046`).
 */
@Component({
  selector: 'foshol-problem-notice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  template: `
    @if (problem(); as view) {
      <div class="notice" role="alert">
        <span class="glyph" aria-hidden="true">!</span>
        <div class="min-w-0 flex-1">
          <p class="font-semibold">
            @if (view.title) {
              {{ view.title }}
            } @else {
              {{ view.titleKey | translate }}
            }
          </p>
          <p class="mt-1 text-sm">
            @if (view.detail) {
              {{ view.detail }}
            } @else {
              {{ view.detailKey | translate }}
            }
          </p>
          @if (view.correlationId) {
            <div class="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span class="font-semibold uppercase tracking-wide">
                {{ 'auth.error.reference' | translate }}
              </span>
              <code class="font-latin select-all break-all rounded bg-clay-100 px-1.5 py-0.5">{{
                view.correlationId
              }}</code>
              <button
                type="button"
                class="rounded-full border border-clay-300 px-2 py-1 font-semibold transition-colors duration-1 ease-settle hover:bg-clay-100"
                (click)="copy(view.correlationId)"
              >
                {{ (copied() ? 'auth.error.copied' : 'auth.error.copyReference') | translate }}
              </button>
            </div>
          }
        </div>
      </div>
    }
  `,
  styles: `
    .notice {
      display: flex;
      gap: 0.75rem;
      padding: 0.875rem 1rem;
      border: 1px solid var(--color-clay-300);
      border-radius: 0.875rem;
      background: var(--color-clay-100);
      color: var(--color-clay-700);
    }

    /* WEB-UX-044 — the glyph carries the meaning alongside the colour, never colour alone. */
    .glyph {
      flex: none;
      inline-size: 1.5rem;
      block-size: 1.5rem;
      display: grid;
      place-items: center;
      border-radius: 50%;
      background: var(--color-clay-600);
      color: var(--color-ink-invert);
      font-weight: 700;
      line-height: 1;
    }
  `,
})
export class ProblemNotice {
  readonly problem = input<ProblemView | null>(null);

  protected readonly copied = signal(false);

  protected copy(correlationId: string): void {
    const clipboard: Clipboard | undefined = navigator.clipboard;
    if (!clipboard) return;
    void clipboard.writeText(correlationId).then(
      () => {
        this.copied.set(true);
        setTimeout(() => this.copied.set(false), APP_CONFIG.ui.toastMs);
      },
      () => {
        // A denied clipboard permission is not worth an error state; the id is selectable.
      },
    );
  }
}
