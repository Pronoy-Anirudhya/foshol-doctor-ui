import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { ProblemView } from '../../../core/errors/problem';
import { CopyButton } from '../copy-button/copy-button';

/**
 * The one way a failure appears on screen.
 *
 * WEB-FR-005 — the problem document's `title` and `detail` are shown, and the
 * `correlationId` is shown IN COPYABLE FORM. The demo machine has no log aggregator: the
 * correlation id on screen is the only route from "it did not work" to a stack trace in the
 * server log, so it is a first-class part of the panel rather than a debug affordance.
 *
 * WEB-FR-401 — a retry control appears when the failure is worth retrying. The panel only
 * *offers* the retry; "not automatically more than once" is the caller's to honour, because
 * only the caller knows whether it has already spent its one attempt.
 *
 * WEB-FR-404 — a raw error, a stack or a bare status code is NEVER the headline. When the
 * server sent no usable problem document, `titleKey`/`detailKey` supply warm, human,
 * translated copy instead. This panel is farmer-facing.
 *
 * WEB-SEC-005 — every server string is interpolated as text. Nothing is rendered as HTML.
 * WEB-UX-044 — the clay hue is decorative; the meaning is carried by the heading text and
 * the glyph.
 */
@Component({
  selector: 'foshol-error-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, CopyButton],
  host: { class: 'block' },
  template: `
    @if (problem(); as view) {
      <section
        class="rounded-2xl border border-clay-300 bg-clay-100/70 p-5 shadow-card md:p-6"
        role="alert"
        [attr.aria-label]="'shared.error.region' | translate"
      >
        <div class="flex items-start gap-3">
          <svg
            viewBox="0 0 24 24"
            class="mt-0.5 h-6 w-6 shrink-0 text-clay-700"
            aria-hidden="true"
            fill="none"
          >
            <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6" />
            <path
              d="M12 7.5v5.25"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
            />
            <circle cx="12" cy="16.4" r="1.05" fill="currentColor" />
          </svg>

          <div class="min-w-0 flex-1">
            <h2 class="text-base font-semibold text-clay-700 md:text-lg">
              @if (view.title) {
                {{ view.title }}
              } @else {
                {{ view.titleKey | translate }}
              }
            </h2>
            <p class="mt-1 max-w-prose text-sm text-ink md:text-base">
              @if (view.detail) {
                {{ view.detail }}
              } @else {
                {{ view.detailKey | translate }}
              }
            </p>

            @if (view.fieldErrors.length > 0) {
              <p class="mt-4 text-sm font-semibold text-ink">
                {{ 'shared.error.fieldErrors' | translate }}
              </p>
              <ul class="mt-1 list-disc space-y-1 ps-5 text-sm text-ink-muted">
                @for (fieldError of view.fieldErrors; track $index) {
                  <li>
                    @if (fieldError.field) {
                      <span class="font-latin font-medium text-ink">{{ fieldError.field }}</span>
                      <span aria-hidden="true">&nbsp;·&nbsp;</span>
                    }
                    <span>{{ fieldError.message }}</span>
                  </li>
                }
              </ul>
            }

            @if (view.correlationId) {
              <div class="mt-4 rounded-xl border border-surface-3 bg-surface-0 p-3">
                <p class="text-xs font-semibold tracking-wide text-ink-faint uppercase">
                  {{ 'shared.error.correlationLabel' | translate }}
                </p>
                <div class="mt-1.5 flex flex-wrap items-center gap-2">
                  <code class="font-mono text-sm break-all text-ink select-all">{{
                    view.correlationId
                  }}</code>
                  <foshol-copy-button [value]="view.correlationId" />
                </div>
                <p class="mt-1.5 text-xs text-ink-faint">
                  {{ 'shared.error.correlationHint' | translate }}
                </p>
              </div>
            }

            @if (showRetry()) {
              <button
                type="button"
                class="error-retry touch-target mt-4 inline-flex items-center justify-center rounded-xl bg-clay-600 px-5 font-semibold text-ink-invert shadow-stamp transition-colors duration-1 ease-settle hover:bg-clay-700"
                (click)="retry.emit()"
              >
                {{ 'shared.error.retry' | translate }}
              </button>
            }
          </div>
        </div>
      </section>
    }
  `,
})
export class ErrorPanel {
  readonly problem = input<ProblemView | null>(null);
  /** Suppress the retry control where the caller has already spent its one attempt. */
  readonly retryable = input(true);

  readonly retry = output<void>();

  /**
   * The template prefers the server's own `title`/`detail` — written for this failure and
   * already localised by `Accept-Language` (COMMON-API-003) — and falls back to
   * `titleKey`/`detailKey`, which `toProblemView` always populates. The status code never
   * becomes the headline either way.
   */
  protected readonly showRetry = computed(
    () => this.retryable() && this.problem()?.retryable === true,
  );
}
