import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { APP_CONFIG } from '../../../core/config/app-config';
import { HoldToTalk } from '../../../shared/ui/hold-to-talk/hold-to-talk';
import { VoiceRecorder } from './voice-recorder';
import { WaveformCanvas } from './waveform-canvas';

/**
 * Hold to describe the problem out loud.
 *
 * WEB-FR-130 / WEB-FR-143 — hold-to-record only, driven by `PointerHoldDirective`, which owns
 * pointer capture and treats `pointercancel`, `pointerleave` and a hidden page as a release.
 * WEB-FR-142 — `holdStart` is emitted synchronously inside `pointerdown`, so `press()` resumes
 * the `AudioContext` from within the user gesture, which is the only thing iOS accepts.
 * WEB-FR-136/137/139 — when the microphone cannot work the recorder is not rendered at all,
 * replaced by ONE line naming the cause. A record control that does nothing when held reads as
 * a broken app; the text box below it is the described path and is always there.
 * WEB-UX-021 — the control is at least `ui.recordTargetPx` square with an unambiguous held
 * state: it grows, it reddens, it says "recording", and the waveform moves.
 */
const PERCENT = 100;

@Component({
  selector: 'foshol-voice-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HoldToTalk, TranslatePipe, WaveformCanvas],
  host: { class: 'block' },
  template: `
    @if (recorder.available()) {
      <div class="voice-card" data-testid="voice-panel">
        <div class="flex items-center gap-4">
          <foshol-hold-to-talk
            testId="record-button"
            labelKey="farmer.capture.voice.holdLabel"
            [active]="recorder.recording()"
            [busy]="recorder.preparing()"
            (holdStart)="recorder.press()"
            (holdEnd)="recorder.release()"
          />

          <div class="min-w-0 flex-1">
            <p class="voice-state" data-testid="voice-state">{{ stateKey() | translate }}</p>
            <p class="voice-clock">
              <span class="tabular">{{ recorder.elapsedSeconds() }}</span>
              <span aria-hidden="true">&nbsp;/&nbsp;</span>
              <span class="tabular">{{ maxSeconds }}</span>
              <span>&nbsp;{{ 'farmer.capture.voice.seconds' | translate }}</span>
            </p>
            <div class="voice-track" aria-hidden="true">
              <span class="voice-fill" [style.inline-size.%]="elapsedPercent()"></span>
            </div>
          </div>
        </div>

        <div class="mt-3">
          <foshol-waveform-canvas [analyser]="recorder.analyser()" />
        </div>

        <!-- WEB-UX-046 — the recorder's state changes announce politely, once each. -->
        <p class="sr-only" role="status">{{ stateKey() | translate }}</p>

        @if (recorder.clipUrl(); as clipUrl) {
          <!-- WEB-FR-135 — playback, discard and re-record before submission. -->
          <div class="voice-clip" data-testid="voice-clip">
            <audio class="w-full" controls [src]="clipUrl"></audio>
            <button
              type="button"
              class="voice-discard touch-target"
              data-testid="voice-discard"
              (click)="recorder.discard()"
            >
              {{ 'farmer.capture.voice.discard' | translate }}
            </button>
          </div>
        }
      </div>
    } @else {
      <!-- WEB-FR-136/137/139 — one line, naming the cause, and no control that cannot work. -->
      <p class="voice-diagnostic" data-testid="voice-diagnostic">
        {{ diagnosticKey() | translate }}
      </p>
    }
  `,
  styles: `
    .voice-card {
      padding: 1rem;
      border: 1px solid var(--color-surface-3);
      border-radius: 1.25rem;
      background: var(--color-surface-0);
      box-shadow: var(--shadow-card);
    }

    .voice-state {
      font-weight: 700;
      color: var(--color-ink);
    }

    .voice-clock {
      font-size: 0.875rem;
      color: var(--color-ink-muted);
    }

    .voice-track {
      margin-block-start: 0.4rem;
      block-size: 0.4rem;
      border-radius: 999px;
      background: var(--color-surface-2);
      overflow: hidden;
    }

    .voice-fill {
      display: block;
      block-size: 100%;
      background: var(--color-paddy-600);
      transition: inline-size var(--duration-1) linear;
    }

    .voice-clip {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-block-start: 0.85rem;
    }

    .voice-discard {
      flex: none;
      padding-inline: 1rem;
      border: 1px solid var(--color-surface-3);
      border-radius: 0.8rem;
      font-weight: 600;
      color: var(--color-ink);
    }

    .voice-diagnostic {
      padding: 0.7rem 0.9rem;
      border: 1px solid var(--color-surface-3);
      border-radius: 0.9rem;
      background: var(--color-surface-2);
      font-size: 0.9375rem;
      color: var(--color-ink-faint);
    }
  `,
})
export class VoicePanel {
  protected readonly recorder = inject(VoiceRecorder);

  protected readonly maxSeconds = APP_CONFIG.intake.maxAudioSeconds;

  protected readonly diagnosticKey = computed(
    () => `farmer.capture.voice.diagnostic.${this.recorder.status()}`,
  );

  protected readonly stateKey = computed(() => {
    if (this.recorder.recording()) return 'farmer.capture.voice.recording';
    if (this.recorder.preparing()) return 'farmer.capture.voice.preparing';
    if (this.recorder.clip() !== null) return 'farmer.capture.voice.captured';
    return 'farmer.capture.voice.idle';
  });

  protected readonly elapsedPercent = computed(() => {
    const capMs = APP_CONFIG.intake.maxAudioSeconds * APP_CONFIG.ui.msPerSecond;
    return Math.min(PERCENT, (this.recorder.elapsedMs() / capMs) * PERCENT);
  });
}
