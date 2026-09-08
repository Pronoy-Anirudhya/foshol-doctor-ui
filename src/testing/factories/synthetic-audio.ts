import type {
  AudioResamplePort,
  DecodedAudio,
} from '../../app/features/farmer/capture/audio-resample.port';

/**
 * WEB-TEST-008 — the audio fixture is a tone SYNTHESISED INSIDE THE TEST rather than a
 * committed clip, so what is asserted is arithmetic with a known answer: a sine at a known
 * amplitude has a known peak, and after normalisation it must have exactly the peak
 * `audio.targetPeakDbfs` names.
 */
const TAU = Math.PI * 2;
const INT16_PEAK = 32767;
const HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 2;

export function tone(
  frequencyHz: number,
  seconds: number,
  sampleRateHz: number,
  amplitude: number,
): Float32Array {
  const samples = new Float32Array(Math.round(seconds * sampleRateHz));
  for (let index = 0; index < samples.length; index++) {
    samples[index] = amplitude * Math.sin((TAU * frequencyHz * index) / sampleRateHz);
  }
  return samples;
}

export interface ParsedWav {
  readonly riff: string;
  readonly wave: string;
  readonly fmt: string;
  readonly dataTag: string;
  readonly formatTag: number;
  readonly channels: number;
  readonly sampleRateHz: number;
  readonly bitsPerSample: number;
  readonly declaredRiffSize: number;
  readonly declaredDataSize: number;
  readonly samples: Float32Array;
}

/** Reads back what `encodeWav16` wrote, so the header is asserted rather than assumed. */
export function parseWav16(buffer: ArrayBuffer): ParsedWav {
  const view = new DataView(buffer);
  const count = (buffer.byteLength - HEADER_BYTES) / BYTES_PER_SAMPLE;
  const samples = new Float32Array(count);
  for (let index = 0; index < count; index++) {
    samples[index] = view.getInt16(HEADER_BYTES + index * BYTES_PER_SAMPLE, true) / INT16_PEAK;
  }
  return {
    riff: tag(view, 0),
    wave: tag(view, 8),
    fmt: tag(view, 12),
    dataTag: tag(view, 36),
    formatTag: view.getUint16(20, true),
    channels: view.getUint16(22, true),
    sampleRateHz: view.getUint32(24, true),
    bitsPerSample: view.getUint16(34, true),
    declaredRiffSize: view.getUint32(4, true),
    declaredDataSize: view.getUint32(40, true),
    samples,
  };
}

function tag(view: DataView, offset: number): string {
  let out = '';
  for (let index = 0; index < 4; index++) out += String.fromCharCode(view.getUint8(offset + index));
  return out;
}

/**
 * `OfflineAudioContext`, replaced. Linear interpolation is not the browser's resampler and is
 * not trying to be — the port exists so the WAV writer and the normaliser can be tested at
 * all, and rate conversion quality is the platform's problem, not this project's.
 */
export class FakeAudioResample implements AudioResamplePort {
  readonly decodeCalls: Blob[] = [];
  readonly resampleCalls: { fromRateHz: number; toRateHz: number }[] = [];

  constructor(private readonly decoded: DecodedAudio | null) {}

  async decode(clip: Blob): Promise<DecodedAudio> {
    this.decodeCalls.push(clip);
    if (this.decoded === null) throw new Error('undecodable clip');
    return this.decoded;
  }

  async resample(
    samples: Float32Array,
    fromRateHz: number,
    toRateHz: number,
  ): Promise<Float32Array> {
    this.resampleCalls.push({ fromRateHz, toRateHz });
    if (fromRateHz === toRateHz) return samples;

    const ratio = toRateHz / fromRateHz;
    const out = new Float32Array(Math.round(samples.length * ratio));
    for (let index = 0; index < out.length; index++) {
      const position = index / ratio;
      const left = Math.floor(position);
      const right = Math.min(samples.length - 1, left + 1);
      const fraction = position - left;
      out[index] = samples[left] * (1 - fraction) + samples[right] * fraction;
    }
    return out;
  }
}
