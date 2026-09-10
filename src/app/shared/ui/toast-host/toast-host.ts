import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ToastStore, type Toast, type ToastKind } from '../../../core/stores/toast-store';

/**
 * WEB-FR-354 — the in-app toast stack. `ADVISORY_PUBLISHED` and `ADVISORY_REVISED` land here,
 * which is demo beat 5.
 *
 * Auto-dismissal after `ui.toastMs` is `ToastStore`'s, not this component's: a toast must
 * expire whether or not the host happens to be rendered, and the store already owns the
 * one-shot timers. This is the view.
 *
 * WEB-UX-046 — deliberately NOT a live region. The application has exactly one, in
 * `<foshol-live-region>`, and whoever raises a toast announces through `LiveAnnouncer` in the
 * same breath (`SseDispatcher` already does). Two live regions racing is how a screen reader
 * ends up reading neither.
 *
 * WEB-UX-013 / COMMON-CON-003 — `titleKey` and `bodyKey` are chrome and are translated; `title`
 * and `body` came from the server and are rendered verbatim as text (WEB-SEC-005, WEB-UX-016).
 *
 * WEB-UX-044 — kind is carried by a glyph and by the text, never by the hue alone.
 */
const TONES: Record<ToastKind, string> = {
  INFO: 'border-surface-3 bg-surface-0 text-ink',
  SUCCESS: 'border-paddy-300 bg-paddy-50 text-paddy-800',
  WARNING: 'border-dawn-300 bg-dawn-100 text-dawn-700',
  ERROR: 'border-clay-300 bg-clay-100 text-clay-700',
};

@Component({
  selector: 'foshol-toast-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  host: { class: 'contents' },
  styles: `
    /* Motion that settles: a short rise into place, no overshoot and no bounce
       (the brief's motion rule). Disabled wholesale by the reduced-motion block in
       styles.css. */
    @keyframes toast-settle {
      from {
        opacity: 0;
        transform: translateY(0.5rem) scale(0.985);
      }
      to {
        opacity: 1;
        transform: none;
      }
    }

    .toast {
      animation: toast-settle var(--duration-3) var(--ease-settle) both;
    }
  `,
  template: `
    @if (toasts().length > 0) {
      <div
        class="pointer-events-none fixed inset-x-3 top-20 z-50 flex flex-col gap-2 md:inset-x-auto md:top-auto md:right-5 md:bottom-5 md:w-96"
        role="region"
        [attr.aria-label]="'shared.toast.region' | translate"
      >
        @for (toast of toasts(); track toast.id) {
          <div
            class="toast pointer-events-auto flex items-start gap-3 rounded-2xl border p-3.5 shadow-lift"
            [class]="tone(toast)"
          >
            <svg viewBox="0 0 20 20" class="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" fill="none">
              @switch (toast.kind) {
                @case ('SUCCESS') {
                  <circle cx="10" cy="10" r="8.4" stroke="currentColor" stroke-width="1.6" />
                  <path
                    d="M6.4 10.3l2.5 2.5 4.7-5.3"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                }
                @case ('WARNING') {
                  <path
                    d="M10 2.6 18.4 17H1.6L10 2.6Z"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linejoin="round"
                  />
                  <path
                    d="M10 8v3.4"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                  />
                  <circle cx="10" cy="14" r="0.95" fill="currentColor" />
                }
                @case ('ERROR') {
                  <circle cx="10" cy="10" r="8.4" stroke="currentColor" stroke-width="1.6" />
                  <path
                    d="M7.2 7.2l5.6 5.6M12.8 7.2l-5.6 5.6"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                  />
                }
                @default {
                  <circle cx="10" cy="10" r="8.4" stroke="currentColor" stroke-width="1.6" />
                  <path
                    d="M10 9v4.6"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                  />
                  <circle cx="10" cy="6.4" r="0.95" fill="currentColor" />
                }
              }
            </svg>

            <div class="min-w-0 flex-1">
              <p class="text-sm font-semibold break-words">
                @if (toast.titleKey) {
                  {{ toast.titleKey | translate }}
                } @else {
                  {{ toast.title }}
                }
              </p>
              @if (toast.bodyKey) {
                <p class="mt-0.5 text-sm break-words opacity-90">{{ toast.bodyKey | translate }}</p>
              } @else if (toast.body) {
                <p class="mt-0.5 text-sm break-words opacity-90">{{ toast.body }}</p>
              }
            </div>

            <button
              type="button"
              class="touch-target -m-1.5 inline-flex shrink-0 items-center justify-center rounded-lg opacity-70 transition-opacity duration-1 ease-settle hover:opacity-100"
              [attr.aria-label]="'shared.toast.dismiss' | translate"
              (click)="dismiss(toast.id)"
            >
              <svg viewBox="0 0 20 20" class="h-4 w-4" aria-hidden="true" fill="none">
                <path
                  d="M5.5 5.5l9 9M14.5 5.5l-9 9"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                />
              </svg>
            </button>
          </div>
        }
      </div>
    }
  `,
})
export class ToastHost {
  private readonly store = inject(ToastStore);

  protected readonly toasts = this.store.toasts;

  protected tone(toast: Toast): string {
    return TONES[toast.kind];
  }

  protected dismiss(id: string): void {
    this.store.dismiss(id);
  }
}
