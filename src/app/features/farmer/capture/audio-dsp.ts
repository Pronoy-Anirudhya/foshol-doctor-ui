/**
 * Voice-clip arithmetic, as pure functions over `Float32Array`.
 *
 * Same reasoning as `image-metrics.ts`: jsdom has neither `AudioContext` nor
 * `OfflineAudioContext`, so every number that decides what gets uploaded is computed here
 * where a test can synthesise a tone and assert the result, and the Web Audio API sits behind
 * `audio-resample.port.ts` where a fake replaces it (`WEB-TEST-008`).
 *
 * WEB-FR-131 / WEB-FR-134 — the clip is ALWAYS delivered as 16-bit PCM WAV, mono, at
 * `audio.sampleRateHz`, peak-normalised to `audio.targetPeakDbfs`. `audio/wav` is in
 * `foshol.intake.allowed-audio-types`, and a hand-written RIFF header is the only way to
 * actually deliver 16 kHz mono at −3 dBFS with zero new runtime dependencies (`WEB-NFR-007`):
 * `MediaRecorder` gives whatever the platform's Opus or AAC encoder feels like, at whatever
 * rate the device granted.
 */

const ZERO = 0;
const ONE = 1;

/** 16-bit signed PCM: full scale is ±32767 (−32768 is never emitted, so the scale is symmetric). */
const INT16_PEAK = 32767;
const BYTES_PER_SAMPLE = 2;
const BITS_PER_SAMPLE = 16;
const PCM_FORMAT_TAG = 1;
const FMT_CHUNK_BYTES = 16;
const HEADER_BYTES = 44;
/** `RIFF`, `WAVE`, `fmt `, `data` — the four ASCII tags, and the two size fields' offsets. */
const RIFF_SIZE_OFFSET = 4;
const RIFF_PREAMBLE_BYTES = 8;

/** dB = 20·log10(amplitude), so amplitude = 10^(dB/20). */
const DECIBEL_FACTOR = 20;
const DECIBEL_BASE = 10;

export const WAV_MIME = 'audio/wav';

/**
 * Average every channel into one.
 *
 * Averaging rather than taking channel 0: a laptop's stereo capture routinely puts most of the
 * energy in one channel, and dropping the other loses half the farmer's voice.
 */
export function downmixToMono(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === ZERO) return new Float32Array(ZERO);
  const first = channels[0];
  if (channels.length === ONE) return first;

  const mono = new Float32Array(first.length);
  for (let index = ZERO; index < mono.length; index++) {
    let sum = ZERO;
    for (const channel of channels) sum += channel[index] ?? ZERO;
    mono[index] = sum / channels.length;
  }
  return mono;
}

export function peakOf(samples: Float32Array): number {
  let peak = ZERO;
  for (const sample of samples) {
    const magnitude = Math.abs(sample);
    if (magnitude > peak) peak = magnitude;
  }
  return peak;
}

/**
 * WEB-FR-134 — the gain that brings `peak` to `targetDbfs`, capped at `maxGain`.
 *
 * The cap is what stops a silent clip — a farmer who held the button but never spoke — from
 * being amplified into a wall of room hiss and handed to the ASR as if it were speech.
 */
export function gainToPeak(peak: number, targetDbfs: number, maxGain: number): number {
  if (peak <= ZERO) return ONE;
  const target = Math.pow(DECIBEL_BASE, targetDbfs / DECIBEL_FACTOR);
  return Math.min(target / peak, maxGain);
}

export function applyGain(samples: Float32Array, gain: number): Float32Array {
  const out = new Float32Array(samples.length);
  for (let index = ZERO; index < samples.length; index++) {
    const scaled = samples[index] * gain;
    out[index] = scaled > ONE ? ONE : scaled < -ONE ? -ONE : scaled;
  }
  return out;
}

/**
 * Drop every `factor`-th sample. Used only on the Safari path, where `OfflineAudioContext`
 * has refused rates below 22.05 kHz: render at `audio.offlineFallbackRateHz` and decimate by
 * `audio.decimationFactor` to land on `audio.sampleRateHz`.
 */
export function decimate(samples: Float32Array, factor: number): Float32Array {
  if (factor <= ONE) return samples;
  const out = new Float32Array(Math.floor(samples.length / factor));
  for (let index = ZERO; index < out.length; index++) out[index] = samples[index * factor];
  return out;
}

/** A canonical 44-byte RIFF/WAVE header followed by little-endian signed 16-bit mono PCM. */
export function encodeWav16(samples: Float32Array, sampleRateHz: number, channels = ONE): Blob {
  const dataBytes = samples.length * BYTES_PER_SAMPLE;
  const buffer = new ArrayBuffer(HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);

  const byteRate = sampleRateHz * channels * BYTES_PER_SAMPLE;
  const blockAlign = channels * BYTES_PER_SAMPLE;

  writeTag(view, 0, 'RIFF');
  view.setUint32(RIFF_SIZE_OFFSET, HEADER_BYTES - RIFF_PREAMBLE_BYTES + dataBytes, true);
  writeTag(view, 8, 'WAVE');
  writeTag(view, 12, 'fmt ');
  view.setUint32(16, FMT_CHUNK_BYTES, true);
  view.setUint16(20, PCM_FORMAT_TAG, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRateHz, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  writeTag(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = HEADER_BYTES;
  for (const sample of samples) {
    const clamped = sample > ONE ? ONE : sample < -ONE ? -ONE : sample;
    view.setInt16(offset, Math.round(clamped * INT16_PEAK), true);
    offset += BYTES_PER_SAMPLE;
  }

  return new Blob([buffer], { type: WAV_MIME });
}

function writeTag(view: DataView, offset: number, tag: string): void {
  for (let index = ZERO; index < tag.length; index++) {
    view.setUint8(offset + index, tag.charCodeAt(index));
  }
}
