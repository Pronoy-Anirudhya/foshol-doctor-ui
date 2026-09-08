import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { APP_CONFIG } from '../../../core/config/app-config';
import { CaseReviewStore, CLAIM_EXPIRED } from '../../../core/stores/case-review-store';
import { toPercentString } from '../../../core/util/percent';
import { CountdownPipe } from '../../../shared/pipes/countdown.pipe';
import { Icon } from '../../../shared/ui/icon/icon';

/**
 * `WEB-FR-241` — the claim countdown, as a ring.
 *
 * **This component owns the clock.** `CaseReviewStore` deliberately holds no timer: a store
 * with its own interval is a timer nobody can stop in a test, and the claim countdown is the
 * one piece of state a test has to be able to drive to the exact instant of expiry
 * (`WEB-FR-242`, AC-14). So the ring ticks the store once per `review.claimTickMs`, and a test
 * calls `store.tick(t)` directly with no timer at all.
 *
 * `WEB-FR-356` — this is a display clock. It writes one signal per tick and touches the
 * network never; it is not a poll of any endpoint.
 *
 * `WEB-UX-044` — colour is never the sole carrier. The ring turns dawn-amber under
 * `claimWarnMs` and clay under `claimCriticalMs`, **and** the label underneath changes its
 * words, **and** a warning glyph appears. Any one of the three carries the meaning alone.
 */
type ClaimTone = 'normal' | 'warn' | 'critical' | 'expired';

const TONE_NORMAL: ClaimTone = 'normal';
const TONE_WARN: ClaimTone = 'warn';
const TONE_CRITICAL: ClaimTone = 'critical';
const TONE_EXPIRED: ClaimTone = 'expired';

const NO_TIME_LEFT = 0;

@Component({
  selector: 'foshol-claim-timer-ring',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CountdownPipe, Icon, TranslatePipe],
  host: { class: 'flex items-center gap-3' },
  template: `
    <div
      class="ring"
      data-testid="claim-ring"
      [attr.data-tone]="tone()"
      [style.--ring-sweep]="sweep()"
      role="timer"
      [attr.aria-label]="'officer.claim.timerAria' | translate: { time: remainingMs() | countdown }"
    >
      <span class="face">
        <span class="time tabular" aria-hidden="true">{{ remainingMs() | countdown }}</span>
      </span>
    </div>

    <p class="tone" [attr.data-tone]="tone()" data-testid="claim-tone">
      @if (warned()) {
        <foshol-icon
          class="glyph"
          name="warning"
          size="sm"
          [label]="'officer.claim.warnGlyph' | translate"
        />
      }
      <span class="tone-text">{{ toneKey() | translate }}</span>
      <span class="remaining tabular">
        {{ 'officer.claim.remaining' | translate: { time: remainingMs() | countdown } }}
      </span>
    </p>
  `,
  styles: `
    .ring {
      --ring-size: 3.25rem;
      --ring-track: 0.3rem;
      --ring-colour: var(--color-paddy-600);
      position: relative;
      flex: 0 0 auto;
      inline-size: var(--ring-size);
      block-size: var(--ring-size);
      border-radius: 999px;
      display: grid;
      place-items: center;
      /* One conic sweep driven by one signal. Motion settles rather than bounces, so the
         sweep transitions rather than jumping a whole second at a time. */
      background: conic-gradient(
        var(--ring-colour) var(--ring-sweep, 0%),
        var(--color-surface-2) 0
      );
      transition: background var(--duration-2) var(--ease-settle);
    }

    .ring[data-tone='warn'] {
      --ring-colour: var(--color-dawn-600);
    }

    .ring[data-tone='critical'] {
      --ring-colour: var(--color-clay-600);
    }

    .ring[data-tone='expired'] {
      --ring-colour: var(--color-surface-3);
    }

    .face {
      inline-size: calc(var(--ring-size) - var(--ring-track) * 2);
      block-size: calc(var(--ring-size) - var(--ring-track) * 2);
      border-radius: 999px;
      background: var(--color-surface-0);
      display: grid;
      place-items: center;
      box-shadow: inset 0 0 0 1px var(--color-surface-2);
    }

    .time {
      font-size: 0.75rem;
      font-weight: 700;
      color: var(--color-ink);
    }

    .tone {
      display: flex;
      flex-direction: column;
      gap: 0.05rem;
      margin: 0;
      font-size: 0.8125rem;
    }

    .tone-text {
      font-weight: 700;
      color: var(--color-ink);
    }

    /* The glyph takes the tone's colour with the words, so the two never disagree. */
    .tone[data-tone='warn'] :is(.glyph, .tone-text) {
      color: var(--color-dawn-700);
    }

    .tone[data-tone='critical'] :is(.glyph, .tone-text),
    .tone[data-tone='expired'] :is(.glyph, .tone-text) {
      color: var(--color-clay-700);
    }

    .remaining {
      color: var(--color-ink-muted);
    }
  `,
})
export class ClaimTimerRing {
  private readonly store = inject(CaseReviewStore);

  protected readonly remainingMs = computed(() => this.store.claimRemainingMs() ?? NO_TIME_LEFT);

  /** The ring's sweep, as a fraction of the configured TTL (`foshol.review.claim.ttl`). */
  protected readonly sweep = computed(() =>
    toPercentString(this.remainingMs() / APP_CONFIG.review.claimTtlMs),
  );

  protected readonly tone = computed<ClaimTone>(() => {
    if (this.store.claimState() === CLAIM_EXPIRED) return TONE_EXPIRED;
    const remaining = this.remainingMs();
    if (remaining <= NO_TIME_LEFT) return TONE_EXPIRED;
    if (remaining <= APP_CONFIG.review.claimCriticalMs) return TONE_CRITICAL;
    if (remaining <= APP_CONFIG.review.claimWarnMs) return TONE_WARN;
    return TONE_NORMAL;
  });

  protected readonly toneKey = computed(() => `officer.claim.tone.${this.tone()}`);
  protected readonly warned = computed(() => this.tone() !== TONE_NORMAL);

  constructor() {
    const ticker = setInterval(() => this.store.tick(), APP_CONFIG.review.claimTickMs);
    inject(DestroyRef).onDestroy(() => clearInterval(ticker));
  }
}
