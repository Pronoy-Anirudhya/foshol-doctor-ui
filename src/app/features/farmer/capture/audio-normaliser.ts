import { inject, Injectable } from '@angular/core';
import { APP_CONFIG } from '../../../core/config/app-config';
import type { DraftAudio } from '../../../core/stores/case-draft-store';
import { AUDIO_RESAMPLE } from './audio-resample.port';
import {
  applyGain,
  downmixToMono,
  encodeWav16,
  gainToPeak,
  peakOf,
  WAV_MIME,
} from './audio-dsp';

/**
 * `MediaRecorder` output → the clip the server receives.
 *
 * WEB-FR-131 / WEB-FR-134 / WEB-FR-146 — decode, downmix to mono, resample to
 * `audio.sampleRateHz`, peak-normalise to `audio.targetPeakDbfs`, emit 16-bit PCM WAV. The
 * resample is driven by the rate the decoder actually reports, never by the rate that was
 * asked for: iOS ignores the `sampleRate` constraint and commonly grants 44.1 or 48 kHz, and a
 * clip labelled 16 kHz that is really 48 kHz transcribes as gibberish at triple speed.
 */
@Injectable({ providedIn: 'root' })
export class AudioNormaliser {
  private readonly resampler = inject(AUDIO_RESAMPLE);

  async normalise(clip: Blob, recordedMime: string, recordedMs: number): Promise<DraftAudio> {
    try {
      const decoded = await this.resampler.decode(clip);
      const mono = downmixToMono(decoded.channels);
      const target = APP_CONFIG.audio.sampleRateHz;
      const resampled = await this.resampler.resample(mono, decoded.sampleRateHz, target);

      const gain = gainToPeak(
        peakOf(resampled),
        APP_CONFIG.audio.targetPeakDbfs,
        APP_CONFIG.audio.maxGain,
      );
      const normalised = applyGain(resampled, gain);

      return {
        blob: encodeWav16(normalised, target),
        durationMs: Math.round((normalised.length / target) * APP_CONFIG.ui.msPerSecond),
        mimeType: WAV_MIME,
      };
    } catch {
      /**
       * WEB-FR-144 keeps a clip that was interrupted mid-sentence, and a truncated WebM
       * container routinely fails to decode. Uploading the raw bytes under their negotiated
       * type is worse audio than the normalised path and infinitely better than telling a
       * farmer their recording is gone; the server sniffs magic bytes (`COMMON-SEC-014`) and
       * the negotiated type is in `foshol.intake.allowed-audio-types` either way.
       */
      return { blob: clip, durationMs: recordedMs, mimeType: recordedMime };
    }
  }
}
