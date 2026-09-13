import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { Icon, type IconName } from '../icon/icon';

/**
 * The one "an action is in flight, please wait" surface in the application.
 *
 * This is deliberately NOT the `<dialog>`-based `ModalDialog`: that component is a full-height
 * sheet on a phone (`WEB-UX-031`), correct for a form the farmer or officer reads and acts on,
 * but wrong here — a wait has no content to scroll to, and needs to stay a small card pinned to
 * the exact centre of the viewport at every width instead of taking over the screen. It also has
 * no close button and no `Escape` handling: there is nothing to cancel, the request it is
 * covering for keeps running either way, and it disappears on its own the instant the caller's
 * `active` input drops — the caller never has to notice it was ever open.
 *
 * A progressive sweep rather than a spinner: it reads as forward motion — work being done —
 * rather than a shape turning in place, and it never claims a real completion percentage
 * (`WEB-NFR-001` applies to a progress bar the same as it does to any other number this app
 * shows, so this is presentation only, never a measured fraction).
 *
 * Every caller supplies its own `titleKey` (and usually a `hintKey`) so the wait always names
 * the thing it is waiting on — "sending your question", "submitting your case", "signing you
 * in" — never a bare, context-free "loading".
 */
@Component({
  selector: 'foshol-loading-overlay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, TranslatePipe],
  host: { class: 'contents' },
  template: `
    @if (active()) {
      <div
        class="loading-overlay"
        role="status"
        aria-live="polite"
        [attr.data-testid]="testId() || null"
      >
        <div class="loading-overlay-card">
          <span class="loading-overlay-badge" aria-hidden="true">
            <foshol-icon [name]="icon()" size="lg" />
          </span>
          <p class="loading-overlay-title">{{ titleKey() | translate }}</p>
          @if (hintKey(); as hint) {
            <p class="loading-overlay-hint">{{ hint | translate }}</p>
          }
          <div class="loading-overlay-track" aria-hidden="true">
            <span class="loading-overlay-fill"></span>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    /* Pinned to the exact centre of the viewport, not the panel — whatever the caller's own
       layout is doing, the wait belongs where the eye already is. */
    .loading-overlay {
      position: fixed;
      inset: 0;
      z-index: 60;
      display: grid;
      place-items: center;
      padding: 1.25rem;
      background: rgb(20 33 27 / 0.45);
      backdrop-filter: blur(2px);
      animation: loading-overlay-veil var(--duration-2) var(--ease-settle) both;
    }

    .loading-overlay-card {
      display: grid;
      justify-items: center;
      gap: 0.6rem;
      inline-size: min(22rem, 100%);
      padding: 1.75rem 1.5rem;
      border-radius: var(--radius-panel);
      background: var(--color-surface-0);
      box-shadow: var(--shadow-lift);
      text-align: center;
      animation: loading-overlay-pop var(--duration-3) var(--ease-settle) both;
    }

    .loading-overlay-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      inline-size: 3rem;
      block-size: 3rem;
      margin-block-end: 0.3rem;
      border-radius: var(--radius-pill);
      background: var(--color-paddy-100);
      color: var(--color-paddy-700);
      animation: loading-overlay-tilt 1.8s var(--ease-settle) infinite;
    }

    .loading-overlay-title {
      font-size: 1.0625rem;
      font-weight: 700;
      color: var(--color-ink);
    }

    .loading-overlay-hint {
      max-width: 30ch;
      font-size: 0.875rem;
      color: var(--color-ink-muted);
    }

    .loading-overlay-track {
      position: relative;
      inline-size: 100%;
      block-size: 0.4rem;
      margin-block-start: 0.5rem;
      border-radius: var(--radius-pill);
      background: var(--color-surface-2);
      overflow: hidden;
    }

    .loading-overlay-fill {
      position: absolute;
      inset-block: 0;
      inset-inline-start: 0;
      inline-size: 45%;
      border-radius: var(--radius-pill);
      background: linear-gradient(90deg, var(--color-paddy-300), var(--color-paddy-600));
      animation: loading-overlay-sweep 1.35s ease-in-out infinite;
    }

    @keyframes loading-overlay-veil {
      from {
        opacity: 0;
      }
    }

    @keyframes loading-overlay-pop {
      from {
        opacity: 0;
        transform: translateY(6px) scale(0.94);
      }
    }

    @keyframes loading-overlay-tilt {
      0%,
      100% {
        transform: rotate(0deg);
      }
      50% {
        transform: rotate(-8deg);
      }
    }

    @keyframes loading-overlay-sweep {
      0% {
        inset-inline-start: -45%;
      }
      100% {
        inset-inline-start: 100%;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .loading-overlay,
      .loading-overlay-card,
      .loading-overlay-badge,
      .loading-overlay-fill {
        animation: none;
      }
    }
  `,
})
export class LoadingOverlay {
  /** Whether the request this overlay covers for is currently in flight. */
  readonly active = input(false);
  /** What is being waited on — required, so the overlay can never read as a bare "loading". */
  readonly titleKey = input.required<string>();
  /** A second, quieter line — what the wait is actually doing, if that is worth saying. */
  readonly hintKey = input<string | null>(null);
  readonly icon = input<IconName>('hourglass');
  readonly testId = input('');
}
