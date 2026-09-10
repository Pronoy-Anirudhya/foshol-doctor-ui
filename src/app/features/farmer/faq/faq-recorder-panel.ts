import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { APP_CONFIG } from '../../../core/config/app-config';
import type { DraftAudio } from '../../../core/stores/case-draft-store';
import { HoldToTalk } from '../../../shared/ui/hold-to-talk/hold-to-talk';
import { VoiceRecorder } from '../capture/voice-recorder';
import { WaveformCanvas } from '../capture/waveform-canvas';

/**
 * The FAQ question recorder: hold, speak, hear it back, then send it.
 *
 * This deliberately does NOT own a `MediaRecorder`. `VoiceRecorder` — the capture screen's
 * service — already owns microphone acquisition, container negotiation
 * (`audio/webm;codecs=opus` → `audio/mp4` → `audio/ogg`), the 30 s cap, peak normalisation to
 * 16 kHz mono, and every path that gives the microphone back (`WEB-FR-131`…`146`). A second
 * recorder stack would be a second set of those bugs. The page provides the service; this
 * component is its FAQ-shaped face.
 *
 * Three states, as the brief asks:
 *  - **A · idle** — one 64 px control (`touch-target-lg`, `WEB-UX-021`) saying "hold and speak".
 *    `preparing()` is a sub-state of it, not a fourth card: that is the OS permission sheet
 *    being up, and the button stays where the farmer's thumb already is.
 *  - **B · recording** — clay fill, a pulsing ambient ring, the live elapsed counter, and the
 *    live waveform. `aria-pressed` carries the same fact for a screen reader.
 *  - **C · sending** — the hold is disabled and the control says so; the page renders the
 *    skeleton for the answer. Double-submit is impossible because `askDisabled` covers it.
 *
 * `WEB-FR-136/137/139` — when the microphone cannot work the control is not rendered at all,
 * replaced by ONE line naming the cause. A record button that does nothing when held reads as a
 * broken app; the page's typed disease list is the degraded path and is always reachable.
 */
const PERCENT = 100;

@Component({
  selector: 'foshol-faq-recorder-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HoldToTalk, TranslatePipe, WaveformCanvas],
  host: { class: 'block' },
  template: `
    @if (recorder.available()) {
      <div class="faq-rec" data-testid="faq-recorder" [attr.data-recording]="recording() || null">
        <div class="flex items-center gap-4">
          <foshol-hold-to-talk
            testId="faq-record-button"
            labelKey="farmer.faq.mic.holdLabel"
            [active]="recording()"
            [busy]="busy() || recorder.preparing()"
            [holdDisabled]="holdDisabled()"
            (holdStart)="recorder.press()"
            (holdEnd)="recorder.release()"
          />

          <div class="min-w-0 flex-1">
            <p class="faq-rec-state" data-testid="faq-recorder-state">
              {{ stateKey() | translate }}
            </p>
            <p class="faq-rec-clock">
              <span class="tabular font-latin">{{ recorder.elapsedSeconds() }}</span>
              <span aria-hidden="true">&nbsp;/&nbsp;</span>
              <span class="tabular font-latin">{{ maxSeconds }}</span>
              <span>&nbsp;{{ 'farmer.faq.mic.seconds' | translate }}</span>
            </p>
            <div class="faq-rec-track" aria-hidden="true">
              <span class="faq-rec-fill" [style.inline-size.%]="elapsedPercent()"></span>
            </div>
          </div>
        </div>

        <div class="mt-3">
          <foshol-waveform-canvas [analyser]="recorder.analyser()" />
        </div>

        <!-- The recorder's own state changes announce politely, once each (WEB-UX-046). -->
        <p class="sr-only" role="status">{{ stateKey() | translate }}</p>

        @if (recorder.clipUrl(); as clipUrl) {
          <!-- Hear it back before sending it: a mis-hold produces two seconds of wind noise, and
               the farmer should find that out here rather than from an inconclusive answer. -->
          <div class="faq-rec-clip" data-testid="faq-recorder-clip">
            <audio class="w-full" controls [src]="clipUrl"></audio>
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                class="faq-rec-ask touch-target"
                data-testid="faq-ask-button"
                [disabled]="askDisabled()"
                (click)="emitAsk()"
              >
                {{ (busy() ? 'farmer.faq.mic.sending' : 'farmer.faq.mic.ask') | translate }}
              </button>
              <button
                type="button"
                class="faq-rec-discard touch-target"
                data-testid="faq-discard-button"
                [disabled]="busy()"
                (click)="recorder.discard()"
              >
                {{ 'farmer.faq.mic.discard' | translate }}
              </button>
            </div>
          </div>
        }

        @if (disabled() && !busy()) {
          <p class="faq-rec-hint" data-testid="faq-recorder-hint">
            {{ 'farmer.faq.mic.pickCropFirst' | translate }}
          </p>
        }
      </div>
    } @else {
      <!-- One line naming the cause, and no control that could not possibly work. -->
      <p class="faq-rec-diagnostic" data-testid="faq-recorder-diagnostic">
        {{ diagnosticKey() | translate }}
      </p>
    }
  `,
  styles: `
    .faq-rec {
      padding: 1rem;
      border: 1px solid var(--color-surface-3);
      border-radius: var(--radius-panel);
      background: var(--color-surface-0);
      box-shadow: var(--shadow-card);
    }

    .faq-rec-state {
      font-weight: 700;
      color: var(--color-ink);
    }

    .faq-rec-clock {
      font-size: 0.875rem;
      color: var(--color-ink-muted);
    }

    .faq-rec-track {
      margin-block-start: 0.4rem;
      block-size: 0.4rem;
      border-radius: var(--radius-pill);
      background: var(--color-surface-2);
      overflow: hidden;
    }

    .faq-rec-fill {
      display: block;
      block-size: 100%;
      background: var(--color-paddy-600);
      transition: inline-size var(--duration-1) linear;
    }

    .faq-rec-clip {
      display: grid;
      gap: 0.75rem;
      margin-block-start: 0.85rem;
    }

    .faq-rec-ask {
      padding-inline: 1.4rem;
      border-radius: var(--radius-control);
      background: var(--color-paddy-600);
      font-weight: 700;
      color: var(--color-ink-invert);
      box-shadow: var(--shadow-stamp);
    }

    .faq-rec-ask:disabled {
      background: var(--color-surface-3);
      color: var(--color-ink-faint);
      box-shadow: none;
    }

    .faq-rec-discard {
      padding-inline: 1rem;
      border: 1px solid var(--color-surface-3);
      border-radius: var(--radius-control);
      font-weight: 600;
      color: var(--color-ink);
    }

    .faq-rec-hint,
    .faq-rec-diagnostic {
      padding: 0.7rem 0.9rem;
      border: 1px solid var(--color-surface-3);
      border-radius: var(--radius-chip);
      background: var(--color-surface-2);
      font-size: 0.9375rem;
      color: var(--color-ink-faint);
    }

    .faq-rec-hint {
      margin-block-start: 0.85rem;
    }
  `,
})
export class FaqRecorderPanel {
  protected readonly recorder = inject(VoiceRecorder);

  /** No crop chosen yet — the server requires one, so the hold is refused before it starts. */
  readonly disabled = input(false);
  /** A search is in flight: the whole control is inert, which is also the double-submit guard. */
  readonly busy = input(false);

  readonly ask = output<DraftAudio>();

  protected readonly maxSeconds = APP_CONFIG.intake.maxAudioSeconds;
  protected readonly recording = this.recorder.recording;

  protected readonly holdDisabled = computed(() => this.disabled() || this.busy());
  protected readonly askDisabled = computed(() => this.disabled() || this.busy());

  protected readonly diagnosticKey = computed(
    () => `farmer.faq.mic.diagnostic.${this.recorder.status()}`,
  );

  protected readonly stateKey = computed(() => {
    if (this.busy()) return 'farmer.faq.mic.sending';
    if (this.recorder.recording()) return 'farmer.faq.mic.recording';
    if (this.recorder.preparing()) return 'farmer.faq.mic.preparing';
    if (this.recorder.clip() !== null) return 'farmer.faq.mic.captured';
    return 'farmer.faq.mic.idle';
  });

  protected readonly elapsedPercent = computed(() => {
    const capMs = APP_CONFIG.intake.maxAudioSeconds * APP_CONFIG.ui.msPerSecond;
    return Math.min(PERCENT, (this.recorder.elapsedMs() / capMs) * PERCENT);
  });

  protected emitAsk(): void {
    const clip = this.recorder.clip();
    if (clip === null || this.askDisabled()) return;
    this.ask.emit(clip);
  }
}
