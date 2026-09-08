import { APP_CONFIG } from '../../../core/config/app-config';
import { parseWav16, tone } from '../../../../testing/factories/synthetic-audio';
import {
  applyGain,
  decimate,
  downmixToMono,
  encodeWav16,
  gainToPeak,
  peakOf,
  WAV_MIME,
} from './audio-dsp';

/**
 * WEB-TEST-008 — a synthesised tone, asserted against the RIFF header and the normalised peak.
 * Nothing here needs Web Audio, which is the point: jsdom has none, and the numbers that decide
 * what the ASR receives must still be tested (`WEB-FR-131`, `WEB-FR-134`).
 */
const TONE_HZ = 440;
const TONE_SECONDS = 0.25;
const QUIET_AMPLITUDE = 0.1;
const DECIBEL_TOLERANCE = 0.01;
const DECIBEL_FACTOR = 20;

const dbfs = (amplitude: number): number => DECIBEL_FACTOR * Math.log10(amplitude);

describe('audio DSP (WEB-FR-131, WEB-FR-134, WEB-TEST-008)', () => {
  it('averages every channel into one rather than dropping any', () => {
    const left = new Float32Array([1, 0, -1]);
    const right = new Float32Array([0, 0, 1]);
    expect([...downmixToMono([left, right])]).toEqual([0.5, 0, 0]);
  });

  it('normalises a quiet tone to exactly the target peak, within 0.01 dB', () => {
    const quiet = tone(TONE_HZ, TONE_SECONDS, APP_CONFIG.audio.sampleRateHz, QUIET_AMPLITUDE);
    const gain = gainToPeak(
      peakOf(quiet),
      APP_CONFIG.audio.targetPeakDbfs,
      APP_CONFIG.audio.maxGain,
    );
    const normalised = applyGain(quiet, gain);

    const wav = encodeWav16(normalised, APP_CONFIG.audio.sampleRateHz);
    // The decoded peak is what the server receives, so that is what is asserted — not the
    // float peak before quantisation.
    return wav.arrayBuffer().then((buffer) => {
      const parsed = parseWav16(buffer);
      expect(Math.abs(dbfs(peakOf(parsed.samples)) - APP_CONFIG.audio.targetPeakDbfs)).toBeLessThan(
        DECIBEL_TOLERANCE,
      );
    });
  });

  it('caps the gain so a near-silent clip is not amplified into hiss', () => {
    const silence = 1e-9;
    expect(gainToPeak(silence, APP_CONFIG.audio.targetPeakDbfs, APP_CONFIG.audio.maxGain)).toBe(
      APP_CONFIG.audio.maxGain,
    );
    expect(gainToPeak(0, APP_CONFIG.audio.targetPeakDbfs, APP_CONFIG.audio.maxGain)).toBe(1);
  });

  it('clamps rather than wrapping when a gain would exceed full scale', () => {
    expect([...applyGain(new Float32Array([0.9, -0.9]), 4)]).toEqual([1, -1]);
  });

  it('writes a canonical 16-bit mono RIFF header at the ASR rate', async () => {
    const samples = tone(TONE_HZ, TONE_SECONDS, APP_CONFIG.audio.sampleRateHz, 0.5);
    const wav = encodeWav16(samples, APP_CONFIG.audio.sampleRateHz);

    expect(wav.type).toBe(WAV_MIME);
    // WEB-FR-135 — the declared type must be one the server accepts.
    expect(APP_CONFIG.intake.allowedAudioTypes).toContain(WAV_MIME);

    const parsed = parseWav16(await wav.arrayBuffer());
    expect(parsed.riff).toBe('RIFF');
    expect(parsed.wave).toBe('WAVE');
    expect(parsed.fmt).toBe('fmt ');
    expect(parsed.dataTag).toBe('data');
    expect(parsed.formatTag).toBe(1);
    expect(parsed.channels).toBe(APP_CONFIG.audio.channels);
    expect(parsed.sampleRateHz).toBe(APP_CONFIG.audio.sampleRateHz);
    expect(parsed.bitsPerSample).toBe(16);
    expect(parsed.declaredDataSize).toBe(samples.length * 2);
    expect(parsed.declaredRiffSize).toBe(wav.size - 8);
    expect(parsed.samples.length).toBe(samples.length);
  });

  it('decimates the Safari fallback rate down to the ASR rate exactly', () => {
    const high = tone(TONE_HZ, TONE_SECONDS, APP_CONFIG.audio.offlineFallbackRateHz, 0.5);
    const decimated = decimate(high, APP_CONFIG.audio.decimationFactor);

    expect(APP_CONFIG.audio.offlineFallbackRateHz / APP_CONFIG.audio.decimationFactor).toBe(
      APP_CONFIG.audio.sampleRateHz,
    );
    expect(decimated.length).toBe(Math.floor(high.length / APP_CONFIG.audio.decimationFactor));
  });
});
