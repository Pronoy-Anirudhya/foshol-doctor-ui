import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * The split login layout shared by both surfaces: a brand panel carrying the product promise
 * beside the form card, collapsing to a compact brand header and one column below `lg`
 * (`WEB-UX-030`…`WEB-UX-032`).
 *
 * The "dawn over a paddy field" panel is layered radial gradients and one hand-authored SVG
 * horizon — no image, no icon pack, no motion library (`WEB-NFR-007`). Every decorative
 * element is `aria-hidden`, because a pictogram that merely restates the adjacent heading is
 * noise to a screen reader rather than the meaningful alternative `WEB-UX-042` asks for.
 *
 * Motion settles and never bounces, and the global `prefers-reduced-motion` rule in
 * `styles.css` stops it outright.
 */
@Component({
  selector: 'foshol-auth-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  template: `
    <div class="grid min-h-dvh lg:grid-cols-[1.05fr_minmax(0,28rem)] xl:grid-cols-[1.15fr_minmax(0,32rem)]">
      <aside
        class="brand relative isolate overflow-hidden px-5 py-8 sm:px-8 lg:flex lg:flex-col lg:justify-between lg:px-12 lg:py-14"
        [class.brand--console]="isConsole()"
      >
        <div class="glow" aria-hidden="true"></div>
        <svg class="horizon" viewBox="0 0 600 200" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <path d="M0 108C90 84 190 124 300 106S520 82 600 104V200H0Z" fill="currentColor" opacity="0.22" />
          <path d="M0 140C120 120 215 156 335 140S500 124 600 142V200H0Z" fill="currentColor" opacity="0.34" />
          <path d="M0 170C140 156 255 184 385 168S525 156 600 172V200H0Z" fill="currentColor" opacity="0.5" />
        </svg>

        <div class="relative z-10 flex items-center gap-3">
          <svg class="mark h-9 w-9 shrink-0 sm:h-11 sm:w-11" viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
            <path d="M17 30c-1-7 .5-13 4-19" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
            <g fill="currentColor">
              <ellipse cx="13.6" cy="22.4" rx="2.1" ry="3.4" transform="rotate(-32 13.6 22.4)" />
              <ellipse cx="21.2" cy="21.1" rx="2.1" ry="3.4" transform="rotate(28 21.2 21.1)" />
              <ellipse cx="15.2" cy="16.1" rx="2" ry="3.2" transform="rotate(-28 15.2 16.1)" />
              <ellipse cx="22.3" cy="14.6" rx="2" ry="3.2" transform="rotate(24 22.3 14.6)" />
              <ellipse cx="17.6" cy="9.6" rx="1.9" ry="3" transform="rotate(-20 17.6 9.6)" />
              <ellipse cx="23.2" cy="8.2" rx="1.9" ry="3" transform="rotate(20 23.2 8.2)" />
            </g>
          </svg>
          <div class="min-w-0">
            <p class="text-lg font-bold leading-tight sm:text-xl">{{ 'app.title' | translate }}</p>
            <p class="eyebrow text-xs sm:text-sm">{{ eyebrowKey() | translate }}</p>
          </div>
        </div>

        <div class="relative z-10 mt-6 max-w-xl lg:mt-0">
          <h1 class="text-balance text-2xl font-bold sm:text-3xl lg:text-[2.6rem] lg:leading-[1.2]">
            {{ 'app.tagline' | translate }}
          </h1>
          <ol class="promise mt-8 hidden space-y-3 lg:block">
            @for (key of promiseKeys; track key) {
              <li class="flex items-start gap-3">
                <span class="tick" aria-hidden="true"></span>
                <span>{{ key | translate }}</span>
              </li>
            }
          </ol>
        </div>
      </aside>

      <main class="flex flex-col bg-surface-1 px-4 py-6 sm:px-8 sm:py-10">
        <div class="flex flex-1 items-center justify-center py-4">
          <div class="w-full max-w-md">
            <ng-content />
          </div>
        </div>
      </main>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .brand {
      background: linear-gradient(158deg, var(--color-paddy-700) 0%, var(--color-paddy-800) 52%, var(--color-slate-900) 100%);
      color: var(--color-ink-invert);
    }

    .brand--console {
      background: linear-gradient(158deg, var(--color-slate-600) 0%, var(--color-slate-800) 52%, var(--color-slate-900) 100%);
    }

    /* Two slow, blurred lights: a low dawn sun top-right and a paddy haze bottom-left. */
    .glow {
      position: absolute;
      inset: 0;
      z-index: 0;
      pointer-events: none;
      overflow: hidden;
    }

    .glow::before,
    .glow::after {
      content: '';
      position: absolute;
      border-radius: 50%;
      will-change: transform;
    }

    .glow::before {
      inset-block-start: -14%;
      inset-inline-end: -6%;
      inline-size: min(58vw, 24rem);
      aspect-ratio: 1;
      background: radial-gradient(
        circle at 50% 50%,
        color-mix(in oklab, var(--color-dawn-300) 78%, transparent) 0%,
        color-mix(in oklab, var(--color-dawn-600) 42%, transparent) 46%,
        transparent 70%
      );
      filter: blur(6px);
      animation: rise 26s var(--ease-settle) infinite alternate;
    }

    .glow::after {
      inset-block-end: -28%;
      inset-inline-start: -18%;
      inline-size: min(96vw, 44rem);
      aspect-ratio: 1.35;
      background: radial-gradient(
        ellipse at 42% 58%,
        color-mix(in oklab, var(--color-paddy-500) 52%, transparent) 0%,
        transparent 66%
      );
      filter: blur(18px);
      animation: drift 34s var(--ease-settle) infinite alternate;
    }

    .brand--console .glow::before {
      background: radial-gradient(
        circle at 50% 50%,
        color-mix(in oklab, var(--color-dawn-300) 46%, transparent) 0%,
        transparent 68%
      );
    }

    @keyframes rise {
      from {
        transform: translate3d(0, 3%, 0) scale(1);
        opacity: 0.82;
      }
      to {
        transform: translate3d(-4%, -3%, 0) scale(1.06);
        opacity: 1;
      }
    }

    @keyframes drift {
      from {
        transform: translate3d(0, 0, 0) scale(1);
      }
      to {
        transform: translate3d(5%, -4%, 0) scale(1.07);
      }
    }

    /* The base stylesheet forces height:auto on every svg; the horizon needs to be told. */
    .horizon {
      position: absolute;
      inset-inline: 0;
      inset-block-end: 0;
      z-index: 0;
      inline-size: 100%;
      block-size: 42%;
      color: var(--color-paddy-800);
      opacity: 0.85;
    }

    .brand--console .horizon {
      color: var(--color-slate-900);
    }

    .mark {
      color: var(--color-dawn-300);
    }

    .eyebrow {
      color: color-mix(in oklab, var(--color-ink-invert) 82%, transparent);
      font-weight: 600;
    }

    .promise {
      color: color-mix(in oklab, var(--color-ink-invert) 92%, transparent);
    }

    .tick {
      margin-block-start: 0.55rem;
      inline-size: 0.5rem;
      block-size: 0.5rem;
      flex: none;
      border-radius: 50%;
      background: var(--color-dawn-300);
      box-shadow: 0 0 0 4px color-mix(in oklab, var(--color-dawn-300) 22%, transparent);
    }
  `,
})
export class AuthShell {

  /** `console` recolours the panel to the officer slate chrome; the layout is unchanged. */
  readonly variant = input<'farmer' | 'console'>('farmer');

  protected readonly isConsole = computed(() => this.variant() === 'console');
  protected readonly eyebrowKey = computed(() =>
    this.isConsole() ? 'auth.brand.consoleNote' : 'auth.brand.eyebrow',
  );

  protected readonly promiseKeys = ['auth.brand.step1', 'auth.brand.step2', 'auth.brand.step3'];
}
