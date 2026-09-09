import { NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChildren,
  Directive,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  TemplateRef,
  untracked,
  viewChildren,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { LiveAnnouncer } from '../../../core/stores/live-announcer';
import { Icon } from '../../../shared/ui/icon/icon';
import { VoiceGuide } from './voice-guide';

/**
 * One step of the capture deck, declared by the page as an `<ng-template>` so the stepper — and
 * not the page — decides when its content is created and destroyed.
 */
@Directive({ selector: 'ng-template[fosholCaptureStep]' })
export class CaptureStep {
  readonly template: TemplateRef<unknown> = inject(TemplateRef);

  readonly stepId = input.required<string>();
  readonly titleKey = input.required<string>();
  /**
   * Printed on the card AND spoken by `VoiceGuide`: one sentence on two channels, so a farmer
   * who cannot read loses nothing when there is no Bangla voice on the device.
   */
  readonly guideKey = input.required<string>();
  /** Drives the rail's tick. Text carries it too — `WEB-UX-044` forbids colour-only meaning. */
  readonly complete = input(false);
}

const ANNOUNCE_KEY = 'farmer.capture.stepper.progress';
const HEADING_PREFIX = 'step-';

const FIRST = 0;
const ONE_STEP = 1;
const ONE_BASED = 1;
/** The active card, plus how far behind it a card may still be rendered. */
const DEEPEST_VISIBLE = 2;
/** The card just left. It is transparent and inert; it exists only so the exit has a subject. */
const LEAVING = -1;
const LEAVING_ATTR = 'out';

/**
 * Decorative step numerals, carried over from the numbered sections this deck replaced. They are
 * `aria-hidden`: the rail button's accessible name is its title, and the card's is its heading.
 */
const STEP_NUMERALS: readonly string[] = ['১', '২', '৩', '৪', '৫'];

@Component({
  selector: 'foshol-capture-stepper',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, NgTemplateOutlet, TranslatePipe],
  host: { class: 'block' },
  template: `
    <div class="head">
      <p class="progress">
        {{
          'farmer.capture.stepper.progress' | translate: { position: position(), total: total() }
        }}
      </p>

      <!-- Persistent, on every step, and never colour or glyph alone: each control carries its
           own word as well as its icon (WEB-UX-044). Absent entirely where the platform has no
           speech synthesiser, because a control that cannot work reads as a broken app. -->
      @if (guide.supported()) {
        <div class="guide-controls">
          <button
            type="button"
            class="guide-btn touch-target"
            data-testid="guide-listen"
            [attr.data-speaking]="guide.speaking() ? true : null"
            (click)="listen()"
          >
            <svg class="guide-glyph" viewBox="0 0 24 24" aria-hidden="true" fill="none">
              <path d="M4 9.5h3.6L12 5.5v13L7.6 14.5H4z" fill="currentColor" />
              <path
                d="M15.8 9.2a4 4 0 010 5.6M18.4 6.6a7.6 7.6 0 010 10.8"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
              />
            </svg>
            {{ 'farmer.capture.stepper.listen' | translate }}
          </button>

          <button
            type="button"
            class="guide-btn touch-target"
            data-testid="guide-mute"
            [attr.aria-pressed]="guide.muted()"
            (click)="toggleMute()"
          >
            <svg class="guide-glyph" viewBox="0 0 24 24" aria-hidden="true" fill="none">
              <path d="M4 9.5h3.6L12 5.5v13L7.6 14.5H4z" fill="currentColor" />
              @if (guide.muted()) {
                <path
                  d="M16 9.5l5 5m0-5l-5 5"
                  stroke="currentColor"
                  stroke-width="1.9"
                  stroke-linecap="round"
                />
              } @else {
                <path
                  d="M15.8 9.2a4 4 0 010 5.6M18.4 6.6a7.6 7.6 0 010 10.8"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                />
              }
            </svg>
            {{
              (guide.muted()
                ? 'farmer.capture.stepper.unmute'
                : 'farmer.capture.stepper.mute'
              ) | translate
            }}
          </button>
        </div>
      }
    </div>

    <!-- Every step is reachable from here at any time, on purpose. The capture screen
         deliberately never became a wizard: WEB-FR-140/141 require the free-text description to
         be available at all times, and a degraded path that must be found is not a degraded
         path. Guided next/back is the primary route; this rail is what keeps the requirement
         true while still guiding, and Send stays live from every step. -->
    <nav class="rail" [attr.aria-label]="'farmer.capture.stepper.railLabel' | translate">
      <ol class="rail-list flex gap-2 overflow-x-auto pb-1">
        @for (step of steps(); track step.stepId(); let index = $index) {
          <li class="shrink-0">
            <button
              type="button"
              class="rail-item touch-target"
              [attr.data-testid]="'step-rail-' + step.stepId()"
              [attr.aria-current]="step.stepId() === activeId() ? 'step' : null"
              [attr.data-active]="step.stepId() === activeId() ? true : null"
              [attr.data-complete]="step.complete() ? true : null"
              (click)="select(step.stepId())"
            >
              <span class="rail-mark" aria-hidden="true">
                @if (step.complete()) {
                  <svg class="rail-tick" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M5 12.5l4.6 4.6L19 7"
                      stroke="currentColor"
                      stroke-width="2.6"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                } @else {
                  {{ numeralAt(index) }}
                }
              </span>
              <span class="rail-title">{{ step.titleKey() | translate }}</span>
              @if (step.complete()) {
                <span class="sr-only">{{ 'farmer.capture.stepper.done' | translate }}</span>
              }
            </button>
          </li>
        }
      </ol>
    </nav>

    <div class="deck">
      @for (step of steps(); track step.stepId(); let index = $index) {
        @if (inDeck(index)) {
          <section
            class="deck-card"
            data-testid="capture-step-card"
            [attr.data-step]="step.stepId()"
            [attr.data-depth]="depthAttr(index)"
            [attr.inert]="index === activeIndex() ? null : ''"
            [attr.aria-labelledby]="headingId(step.stepId())"
          >
            <h2 #cardHeading class="card-title" tabindex="-1" [id]="headingId(step.stepId())">
              <span class="card-number" aria-hidden="true">{{ numeralAt(index) }}</span>
              <span>{{ step.titleKey() | translate }}</span>
            </h2>
            <p class="card-help">{{ step.guideKey() | translate }}</p>
            <div class="card-body">
              <ng-container [ngTemplateOutlet]="step.template" />
            </div>
          </section>
        }
      }
    </div>

    <div class="deck-nav">
      <button
        type="button"
        class="nav-btn touch-target"
        data-testid="step-back"
        [disabled]="isFirst()"
        (click)="back()"
      >
        <foshol-icon name="arrow-left" size="sm" />
        {{ 'farmer.capture.stepper.back' | translate }}
      </button>
      <button
        type="button"
        class="nav-btn nav-next touch-target"
        data-testid="step-next"
        [disabled]="isLast()"
        (click)="next()"
      >
        {{ 'farmer.capture.stepper.next' | translate }}
        <foshol-icon name="arrow-right" size="sm" />
      </button>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      margin-block-end: 0.75rem;
    }

    .progress {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--color-ink-muted);
    }

    .guide-controls {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .guide-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding-inline: 0.85rem;
      border: 1px solid var(--color-surface-3);
      border-radius: var(--radius-pill);
      background: var(--color-surface-0);
      color: var(--color-ink);
      font-size: 0.875rem;
      font-weight: 600;
      transition:
        border-color var(--duration-1) var(--ease-settle),
        background-color var(--duration-1) var(--ease-settle);
    }

    .guide-btn:hover {
      border-color: var(--color-paddy-600);
      background: var(--color-paddy-50);
    }

    .guide-btn[data-speaking] {
      border-color: var(--color-paddy-600);
      background: var(--color-paddy-100);
      color: var(--color-paddy-800);
    }

    .guide-glyph {
      inline-size: 1.15rem;
      block-size: 1.15rem;
      flex: none;
    }

    .rail-item {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding-inline: 0.75rem;
      border: 1px solid var(--color-surface-3);
      border-radius: var(--radius-pill);
      background: var(--color-surface-0);
      color: var(--color-ink-muted);
      font-size: 0.875rem;
      font-weight: 600;
      white-space: nowrap;
      transition:
        border-color var(--duration-1) var(--ease-settle),
        background-color var(--duration-1) var(--ease-settle),
        color var(--duration-1) var(--ease-settle),
        box-shadow var(--duration-2) var(--ease-settle);
    }

    .rail-item:hover {
      border-color: var(--color-paddy-600);
      color: var(--color-ink);
    }

    /* The active step is a fill AND a heavier weight AND aria-current; the completed one is a
       tick AND a screen-reader word. Neither is carried by colour alone (WEB-UX-044). */
    .rail-item[data-active] {
      border-color: var(--color-paddy-600);
      background: var(--color-paddy-600);
      color: var(--color-ink-invert);
      font-weight: 700;
      box-shadow: var(--shadow-card);
    }

    .rail-mark {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      inline-size: 1.6rem;
      block-size: 1.6rem;
      flex: none;
      border-radius: 999px;
      background: var(--color-surface-2);
      color: var(--color-ink);
      font-size: 0.8125rem;
      font-weight: 700;
    }

    .rail-item[data-active] .rail-mark {
      background: color-mix(in srgb, var(--color-ink-invert) 26%, transparent);
      color: var(--color-ink-invert);
    }

    .rail-item[data-complete]:not([data-active]) .rail-mark {
      background: var(--color-paddy-100);
      color: var(--color-paddy-800);
    }

    .rail-tick {
      inline-size: 1rem;
      block-size: 1rem;
    }

    /* The deck. Every card occupies the same grid area, so the container sizes itself to the
       tallest card in it and nothing collapses the way an absolutely positioned stack would. */
    .deck {
      display: grid;
      margin-block-start: 1rem;
      isolation: isolate;
    }

    .deck-card {
      grid-area: 1 / 1;
      padding: 1.1rem;
      border: 1px solid var(--color-surface-3);
      border-radius: 1.25rem;
      background: var(--color-surface-0);
      transform-origin: 50% 0%;
      transition:
        transform var(--duration-3) var(--ease-settle),
        opacity var(--duration-3) var(--ease-settle),
        box-shadow var(--duration-3) var(--ease-settle);
    }

    .deck-card[data-depth='0'] {
      z-index: 3;
      transform: none;
      opacity: 1;
      box-shadow: var(--shadow-lift);
    }

    /* Behind the active card: offset, shrunk, faded and capped, so they read as the edge of a
       deck rather than as four competing screens. Capped, too, so a tall step further back can
       never dictate the height of a short step in front of it. */
    .deck-card:not([data-depth='0']) {
      max-block-size: 13rem;
      overflow: hidden;
      pointer-events: none;
      box-shadow: var(--shadow-card);
      mask-image: linear-gradient(to bottom, rgb(0 0 0) 55%, transparent 100%);
    }

    .deck-card[data-depth='1'] {
      z-index: 2;
      transform: translateY(10px) scale(0.97);
      opacity: 0.5;
    }

    .deck-card[data-depth='2'] {
      z-index: 1;
      transform: translateY(20px) scale(0.94);
      opacity: 0.28;
    }

    /* Advancing sends the outgoing card down to the back of the deck and out. Going back
       reverses it, because the same rule runs in the opposite direction. */
    .deck-card[data-depth='out'] {
      z-index: 0;
      transform: translateY(32px) scale(0.9);
      opacity: 0;
      transition-timing-function: var(--ease-exit);
    }

    .card-title {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      margin-block-end: 0.35rem;
      font-size: 1.125rem;
    }

    /* WEB-UX-041 — focus lands here on every step change, so the ring must be visible. */
    .card-title:focus-visible {
      outline: 3px solid var(--color-focus);
      outline-offset: 4px;
      border-radius: 0.5rem;
    }

    .card-number {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      inline-size: 1.9rem;
      block-size: 1.9rem;
      flex: none;
      border-radius: 999px;
      background: var(--color-paddy-100);
      color: var(--color-paddy-700);
      font-size: 0.9375rem;
      font-weight: 700;
    }

    .card-help {
      font-size: 0.9375rem;
      color: var(--color-ink-muted);
    }

    .card-body {
      margin-block-start: 0.85rem;
    }

    .deck-nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      margin-block-start: 1rem;
    }

    .nav-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding-inline: 1rem;
      border: 1px solid var(--color-surface-3);
      border-radius: 1rem;
      background: var(--color-surface-0);
      color: var(--color-ink);
      font-weight: 700;
      transition:
        border-color var(--duration-1) var(--ease-settle),
        box-shadow var(--duration-2) var(--ease-settle);
    }

    .nav-btn:hover:not(:disabled) {
      border-color: var(--color-paddy-600);
      box-shadow: var(--shadow-card);
    }

    .nav-btn:disabled {
      color: var(--color-ink-faint);
      cursor: not-allowed;
    }

    .nav-next {
      background: var(--color-paddy-50);
      border-color: var(--color-paddy-300);
    }
  `,
})
export class CaptureStepper {
  private readonly announcer = inject(LiveAnnouncer);
  private readonly injector = inject(Injector);

  protected readonly guide = inject(VoiceGuide);

  readonly activeId = input.required<string>();
  readonly stepSelected = output<string>();

  protected readonly steps = contentChildren(CaptureStep);
  private readonly headings = viewChildren<ElementRef<HTMLElement>>('cardHeading');

  protected readonly activeIndex = computed(() => {
    const index = this.steps().findIndex((step) => step.stepId() === this.activeId());
    return index < FIRST ? FIRST : index;
  });
  protected readonly total = computed(() => this.steps().length);
  protected readonly position = computed(() => this.activeIndex() + ONE_BASED);
  protected readonly isFirst = computed(() => this.activeIndex() === FIRST);
  protected readonly isLast = computed(() => this.activeIndex() >= this.total() - ONE_STEP);

  /**
   * Browsers refuse speech synthesis before a user gesture, and an autoplay attempt that fails
   * silently is worse than none: the farmer waits for a voice that is never coming. So nothing
   * is spoken until the farmer has pressed something — the explicit listen control, or any
   * navigation, which is itself the gesture that unlocks the rest.
   */
  #gestured = false;
  #shownId: string | null = null;

  constructor() {
    effect(() => {
      const id = this.activeId();
      untracked(() => this.#onStepShown(id));
    });
  }

  protected headingId(stepId: string): string {
    return `${HEADING_PREFIX}${stepId}`;
  }

  protected numeralAt(index: number): string {
    return index < STEP_NUMERALS.length ? STEP_NUMERALS[index] : '';
  }

  protected depthAttr(index: number): string {
    const depth = index - this.activeIndex();
    return depth === LEAVING ? LEAVING_ATTR : String(depth);
  }

  /** The active card, the two behind it, and the one on its way out. Nothing else is built. */
  protected inDeck(index: number): boolean {
    const depth = index - this.activeIndex();
    return depth >= LEAVING && depth <= DEEPEST_VISIBLE;
  }

  protected select(stepId: string): void {
    this.#gestured = true;
    this.stepSelected.emit(stepId);
  }

  protected next(): void {
    this.#move(ONE_STEP);
  }

  protected back(): void {
    this.#move(-ONE_STEP);
  }

  protected listen(): void {
    this.#gestured = true;
    const key = this.#guideKeyOf(this.activeId());
    if (key !== null) this.guide.speak(key);
  }

  protected toggleMute(): void {
    this.#gestured = true;
    this.guide.toggleMute();
  }

  #move(delta: number): void {
    const steps = this.steps();
    const target = this.activeIndex() + delta;
    if (target < FIRST || target >= steps.length) return;
    this.select(steps[target].stepId());
  }

  #onStepShown(stepId: string): void {
    if (this.#shownId === stepId) return;
    const firstPaint = this.#shownId === null;
    this.#shownId = stepId;
    // Arriving on the page is not a step change: focus stays where the browser put it and
    // nothing is announced or spoken.
    if (firstPaint) return;

    // WEB-UX-046 — through the one application-wide polite region, never a second one here.
    this.announcer.announce(ANNOUNCE_KEY, { position: this.position(), total: this.total() });

    this.guide.cancel();
    const key = this.#guideKeyOf(stepId);
    if (this.#gestured && key !== null) this.guide.speak(key);

    // WEB-UX-040 — focus follows the card, so a keyboard or screen-reader user is put where
    // the sighted user is looking rather than left behind on the rail.
    afterNextRender(() => this.#focusHeading(stepId), { injector: this.injector });
  }

  #guideKeyOf(stepId: string): string | null {
    for (const step of this.steps()) {
      if (step.stepId() === stepId) return step.guideKey();
    }
    return null;
  }

  #focusHeading(stepId: string): void {
    const id = this.headingId(stepId);
    for (const heading of this.headings()) {
      if (heading.nativeElement.id === id) {
        heading.nativeElement.focus();
        return;
      }
    }
  }
}
