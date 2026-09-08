import { InjectionToken } from '@angular/core';
import { APP_CONFIG } from '../../../core/config/app-config';
import { decimate } from './audio-dsp';

/**
 * The one place in the voice pipeline that touches Web Audio. Everything downstream works on
 * `Float32Array`, so `audio-dsp.spec.ts` can assert the RIFF header and the normalised peak
 * on jsdom, which has neither `AudioContext` nor `OfflineAudioContext`.
 */
export interface DecodedAudio {
  readonly channels: readonly Float32Array[];
  readonly sampleRateHz: number;
}

export interface AudioResamplePort {
  /** Decode a `MediaRecorder` container — WebM/Opus, MP4/AAC or Ogg — to raw samples. */
  decode(clip: Blob): Promise<DecodedAudio>;
  /** Render mono `samples` at `toRateHz`. */
  resample(samples: Float32Array, fromRateHz: number, toRateHz: number): Promise<Float32Array>;
}

export const AUDIO_RESAMPLE = new InjectionToken<AudioResamplePort>(
  'foshol.capture.audioResample',
  { providedIn: 'root', factory: (): AudioResamplePort => new WebAudioResample() },
);

const START_AT_ZERO = 0;

class WebAudioResample implements AudioResamplePort {
  async decode(clip: Blob): Promise<DecodedAudio> {
    const bytes = await clip.arrayBuffer();
    const context = new AudioContext();
    try {
      const buffer = await context.decodeAudioData(bytes);
      const channels = Array.from({ length: buffer.numberOfChannels }, (_unused, index) =>
        buffer.getChannelData(index).slice(),
      );
      return { channels, sampleRateHz: buffer.sampleRate };
    } finally {
      await context.close();
    }
  }

  async resample(
    samples: Float32Array,
    fromRateHz: number,
    toRateHz: number,
  ): Promise<Float32Array> {
    if (fromRateHz === toRateHz) return samples;
    try {
      return await render(samples, fromRateHz, toRateHz);
    } catch {
      /**
       * Safari has refused `OfflineAudioContext` below 22.05 kHz. Render high, then decimate
       * — `audio.offlineFallbackRateHz / audio.decimationFactor` is exactly
       * `audio.sampleRateHz`, so the fallback lands on the same rate the ASR expects rather
       * than on an approximation of it.
       */
      const high = await render(samples, fromRateHz, APP_CONFIG.audio.offlineFallbackRateHz);
      return decimate(high, APP_CONFIG.audio.decimationFactor);
    }
  }
}

async function render(
  samples: Float32Array,
  fromRateHz: number,
  toRateHz: number,
): Promise<Float32Array> {
  const frames = Math.max(APP_CONFIG.audio.channels, Math.ceil(samples.length * (toRateHz / fromRateHz)));
  const offline = new OfflineAudioContext(APP_CONFIG.audio.channels, frames, toRateHz);

  const input = offline.createBuffer(APP_CONFIG.audio.channels, samples.length, fromRateHz);
  // `set` rather than `copyToChannel`: the latter's typing pins the backing store to a plain
  // ArrayBuffer, and a Float32Array that reached us from a decoder is not narrowed that far.
  input.getChannelData(START_AT_ZERO).set(samples);

  const source = offline.createBufferSource();
  source.buffer = input;
  source.connect(offline.destination);
  source.start();

  const rendered = await offline.startRendering();
  return rendered.getChannelData(START_AT_ZERO).slice();
}
