import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { PointerHoldDirective } from '../../directives/pointer-hold.directive';

/**
 * The one way this application opens a microphone: press and hold, release to stop
 * (`DEVIATIONS.md` D-33).
 *
 * Every voice control in the app renders through here — the capture describe recorder, the land
 * step's dictation, and the FAQ question recorder. Before this component the three duplicated the
 * same button shell, the same 24×24 glyph and the same twenty lines of CSS, and one of them had
 * drifted into a tap-to-toggle with no accessible name at all. Making the convention a component
 * rather than a rule is what stops that happening again: there is no way to render a microphone
 * control here without the hold gesture, and `labelKey` is required, so a nameless mic will not
 * compile.
 *
 * `fosholPointerHold` sits on the `<button>` itself, never on a wrapper — the directive sets
 * `touch-action: none` and takes pointer capture, and both must apply to the element the thumb
 * actually lands on. It also brings the six release paths (`pointerup`, `pointercancel`,
 * `pointerleave`, `lostpointercapture`, `blur`, a hidden page) and keyboard Space/Enter
 * (`WEB-UX-040`), so a consumer gets all of that by construction.
 *
 * WEB-UX-021 — `touch-target-lg` is 64 px, above the 44 px floor, because this is operated by
 * thumb, one-handed, outdoors, possibly with wet hands.
 * WEB-UX-044 — the held state is a colour change AND a scale change AND a ring AND `aria-pressed`;
 * the consumer supplies the words. The ring animation is disarmed by the global
 * `prefers-reduced-motion` rule in `styles.css`, leaving the static clay fill, which still reads.
 */
@Component({
  selector: 'foshol-hold-to-talk',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PointerHoldDirective, TranslatePipe],
  host: { class: 'inline-flex' },
  template: `
    <button
      type="button"
      class="htt touch-target-lg"
      fosholPointerHold
      [attr.data-testid]="testId() || null"
      [fosholPointerHoldDisabled]="holdDisabled()"
      [attr.data-active]="active() ? true : null"
      [attr.aria-pressed]="active()"
      [attr.aria-busy]="busy() ? true : null"
      [attr.aria-label]="labelKey() | translate"
      (holdStart)="holdStart.emit()"
      (holdEnd)="holdEnd.emit()"
    >
      <svg viewBox="0 0 24 24" class="htt-glyph" aria-hidden="true" fill="none">
        <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
        <path
          d="M6 11.5a6 6 0 0012 0M12 17.5V21M9 21h6"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
        />
      </svg>
    </button>
  `,
  styles: `
    .htt {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      border-radius: var(--radius-pill);
      background: var(--color-paddy-600);
      color: var(--color-ink-invert);
      box-shadow: var(--shadow-card);
      transition:
        transform var(--duration-2) var(--ease-settle),
        background-color var(--duration-1) var(--ease-settle),
        box-shadow var(--duration-2) var(--ease-settle);
    }

    .htt[aria-disabled='true'] {
      background: var(--color-surface-3);
      color: var(--color-ink-faint);
      box-shadow: none;
    }

    .htt[data-active] {
      background: var(--color-clay-600);
      transform: scale(1.06);
      animation: htt-pulse 1.6s var(--ease-settle) infinite;
    }

    @keyframes htt-pulse {
      0% {
        box-shadow:
          0 0 0 0 var(--color-clay-300),
          var(--shadow-lift);
      }
      70% {
        box-shadow:
          0 0 0 14px rgb(231 155 147 / 0),
          var(--shadow-lift);
      }
      100% {
        box-shadow:
          0 0 0 0 rgb(231 155 147 / 0),
          var(--shadow-lift);
      }
    }

    .htt-glyph {
      inline-size: 2rem;
      block-size: 2rem;
    }
  `,
})
export class HoldToTalk {
  /** Recording or listening — drives `aria-pressed` and the held treatment. */
  readonly active = input(false);
  /** Opening the microphone, or a send in flight: announced, not a separate visual state. */
  readonly busy = input(false);
  readonly holdDisabled = input(false);
  /**
   * Translation key for the accessible name (`WEB-UX-042`). Required on purpose: the land mic
   * shipped for months with an `aria-hidden` glyph as its only child and therefore no name at
   * all, and a required input is the only version of "don't do that" that cannot be forgotten.
   */
  readonly labelKey = input.required<string>();
  /** The consumer's existing test hook, so adopting this component breaks no spec. */
  readonly testId = input('');

  readonly holdStart = output<void>();
  readonly holdEnd = output<void>();
}
