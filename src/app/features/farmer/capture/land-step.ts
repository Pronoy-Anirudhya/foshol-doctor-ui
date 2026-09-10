import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { CropQuantityUnit, FieldAreaUnit } from '../../../core/stores/case-draft-store';
import { isEmptyParse, parseBanglaQuantity, type ParsedLandSpeech } from './bangla-quantity';
import { HoldToTalk } from '../../../shared/ui/hold-to-talk/hold-to-talk';
import { FieldMetricsPanel } from './field-metrics-panel';
import { LandSpeech } from './land-speech';

/**
 * "আপনার জমি" — speech first, typing always.
 *
 * The farmer says how much land and how much crop; `bangla-quantity.ts` reads what it is sure
 * about and the four boxes below are pre-filled with it. **Every box stays editable and typing
 * alone works exactly as it did before this step existed** — the dictation is a shortcut past a
 * number pad, not a new way of answering.
 *
 * The recognised sentence is shown back verbatim ("যা শুনলাম: …") so the farmer can see why the
 * numbers are what they are, rather than watching figures appear from nowhere.
 *
 * Nothing dictated here is attached to the submission: a case carries one audio part and it
 * belongs to the describe step's clip. The server receives the typed values and decides
 * `CaseDetail.metricsSource` on its own (`WEB-NFR-001`).
 *
 * Where the platform has no recogniser the microphone is not rendered at all and one diagnostic
 * line says so — the same shape `voice-panel.ts` uses for an unusable microphone
 * (`WEB-FR-136`/`137`/`139`), for the same reason: a control that cannot work reads as a broken
 * app.
 */
const APPLIED_KEY = 'farmer.capture.land.applied';
const NOT_UNDERSTOOD_KEY = 'farmer.capture.land.notUnderstood';
const ERROR_PREFIX = 'farmer.capture.land.error.';
const NO_PULSE: readonly number[] = [];

@Component({
  selector: 'foshol-land-step',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FieldMetricsPanel, HoldToTalk, TranslatePipe],
  host: { class: 'block' },
  template: `
    @if (speech.supported()) {
      <div class="mic-row">
        <foshol-hold-to-talk
          testId="land-mic"
          labelKey="farmer.capture.land.holdLabel"
          [active]="speech.listening()"
          (holdStart)="press()"
          (holdEnd)="release()"
        />

        <div class="min-w-0 flex-1">
          <!-- The held/idle state changes the WORD as well as the colour (WEB-UX-044). -->
          <p class="mic-state" data-testid="land-mic-state">
            {{
              (speech.listening()
                ? 'farmer.capture.land.listening'
                : 'farmer.capture.land.speak'
              ) | translate
            }}
          </p>
          <p class="mic-example">{{ 'farmer.capture.land.example' | translate }}</p>
          <p class="mic-note">{{ 'farmer.capture.land.transient' | translate }}</p>
        </div>
      </div>

      <!-- WEB-UX-046 — the same sr-only mirror the other two voice panels carry, so a screen
           reader hears the listen start and stop rather than only seeing it. -->
      <p class="sr-only" role="status">
        {{
          (speech.listening() ? 'farmer.capture.land.listening' : 'farmer.capture.land.speak')
            | translate
        }}
      </p>

      @if (speech.transcript(); as heard) {
        <p class="heard" data-testid="land-heard">
          {{ 'farmer.capture.land.heard' | translate: { text: heard } }}
        </p>
      }

      <!-- WEB-UX-046 — the outcome of an asynchronous recognition announces politely. -->
      @if (outcomeKey(); as key) {
        <p class="outcome" role="status" data-testid="land-outcome">{{ key | translate }}</p>
      }
    } @else {
      <p class="land-diagnostic" data-testid="land-diagnostic">
        {{ 'farmer.capture.land.diagnostic.UNSUPPORTED' | translate }}
      </p>
    }

    <div class="metrics">
      <!-- Re-created on every applied parse, which is what restarts the settle animation.
           Decoration only: the "যা শুনলাম" line and the filled numbers carry the meaning. -->
      @for (pulse of pulses(); track pulse) {
        <span class="prefill-flash" aria-hidden="true"></span>
      }
      <foshol-field-metrics-panel
        [fieldArea]="fieldArea()"
        [fieldAreaUnit]="fieldAreaUnit()"
        [cropQuantity]="cropQuantity()"
        [cropQuantityUnit]="cropQuantityUnit()"
        [showAreaError]="showAreaError()"
        (areaChanged)="areaChanged.emit($event)"
        (areaUnitChanged)="areaUnitChanged.emit($event)"
        (quantityChanged)="quantityChanged.emit($event)"
        (quantityUnitChanged)="quantityUnitChanged.emit($event)"
      />
    </div>
  `,
  styles: `
    .mic-row {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.9rem;
      border: 1px solid var(--color-surface-3);
      border-radius: var(--radius-panel);
      background: var(--color-surface-0);
      box-shadow: var(--shadow-card);
    }

    .mic-state {
      font-weight: 700;
      color: var(--color-ink);
    }

    .mic-example {
      font-size: 0.875rem;
      color: var(--color-ink-muted);
    }

    .mic-note {
      margin-block-start: 0.15rem;
      font-size: 0.8125rem;
      color: var(--color-ink-faint);
    }

    .heard {
      margin-block-start: 0.75rem;
      padding: 0.6rem 0.85rem;
      border: 1px solid var(--color-surface-3);
      border-radius: var(--radius-card);
      background: var(--color-surface-2);
      font-size: 0.9375rem;
      color: var(--color-ink);
    }

    .outcome {
      margin-block-start: 0.5rem;
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--color-paddy-800);
    }

    .land-diagnostic {
      padding: 0.7rem 0.9rem;
      border: 1px solid var(--color-surface-3);
      border-radius: var(--radius-card);
      background: var(--color-surface-2);
      font-size: 0.9375rem;
      color: var(--color-ink-faint);
    }

    .metrics {
      position: relative;
      margin-block-start: 1.1rem;
    }

    /* A ring rather than a fill, so nothing is ever laid over a value the farmer is reading. */
    .prefill-flash {
      position: absolute;
      inset: -0.6rem;
      border-radius: var(--radius-panel);
      pointer-events: none;
      box-shadow: inset 0 0 0 3px var(--color-paddy-600);
      animation: prefill-settle calc(var(--duration-3) * 3) var(--ease-settle) forwards;
    }

    @keyframes prefill-settle {
      from {
        opacity: 1;
      }
      to {
        opacity: 0;
      }
    }
  `,
})
export class LandStep {
  protected readonly speech = inject(LandSpeech);

  readonly fieldArea = input<number | null>(null);
  readonly fieldAreaUnit = input.required<FieldAreaUnit>();
  readonly cropQuantity = input<number | null>(null);
  readonly cropQuantityUnit = input<CropQuantityUnit | null>(null);
  readonly showAreaError = input(false);

  readonly areaChanged = output<number | null>();
  readonly areaUnitChanged = output<FieldAreaUnit>();
  readonly quantityChanged = output<number | null>();
  readonly quantityUnitChanged = output<CropQuantityUnit | null>();
  /** Only the fields the parser was sure about; the page applies them through the store. */
  readonly prefilled = output<ParsedLandSpeech>();

  private readonly _outcome = signal<string | null>(null);
  private readonly _pulses = signal<readonly number[]>(NO_PULSE);

  protected readonly pulses = this._pulses.asReadonly();

  /** A platform error outranks the parse outcome: it says why there was no parse at all. */
  protected readonly outcomeKey = computed(() => {
    const failure = this.speech.error();
    return failure === null ? this._outcome() : `${ERROR_PREFIX}${failure}`;
  });

  #appliedSeq: number | null = null;

  constructor() {
    effect(() => {
      const heard = this.speech.heard();
      if (heard === null) return;
      untracked(() => this.#apply(heard.seq, heard.text));
    });
  }

  /**
   * Held. `listen()` runs synchronously inside the gesture because Safari gates both
   * `start()` and the permission prompt on a user gesture — the same constraint `WEB-FR-142`
   * records for the recorder's `AudioContext`.
   */
  protected press(): void {
    this._outcome.set(null);
    this.speech.listen();
  }

  protected release(): void {
    this.speech.stop();
  }

  #apply(seq: number, text: string): void {
    if (this.#appliedSeq === seq) return;
    this.#appliedSeq = seq;

    const parsed = parseBanglaQuantity(text);
    if (isEmptyParse(parsed)) {
      this._outcome.set(NOT_UNDERSTOOD_KEY);
      return;
    }
    this.prefilled.emit(parsed);
    this._outcome.set(APPLIED_KEY);
    this._pulses.set([seq]);
  }
}
