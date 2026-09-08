import { APP_CONFIG } from '../../../core/config/app-config';
import {
  blur,
  checkerboard,
  LEAF_DARK,
  LEAF_LIGHT,
  SOIL_DARK,
  SOIL_LIGHT,
} from '../../../../testing/factories/synthetic-images';
import { laplacianVariance, toGrayscale, vegetationCoverage } from './image-metrics';
import {
  judgeQuality,
  measureQuality,
  QUALITY_ACCEPTED,
  QUALITY_BLURRY,
  QUALITY_NOT_CROP,
  QUALITY_TOO_SMALL,
} from './quality-gate';

/**
 * WEB-TEST-008 — every fixture here is generated in the test: a checkerboard for the sharp
 * case, the same buffer convolved by `boxBlur` for the blurred one. No binary is committed.
 */
const LARGE_EDGE = 1024;
const SMALL_EDGE = 120;

const BAND = {
  hueMinDeg: APP_CONFIG.capture.vegHueMinDeg,
  hueMaxDeg: APP_CONFIG.capture.vegHueMaxDeg,
  satMin: APP_CONFIG.capture.vegSatMin,
  valMin: APP_CONFIG.capture.vegValMin,
  valMax: APP_CONFIG.capture.vegValMax,
};

describe('image metrics (WEB-FR-120…124, WEB-TEST-008)', () => {
  it('measures a high-contrast checkerboard as far above the blur gate', () => {
    const sharp = checkerboard(LEAF_LIGHT, LEAF_DARK);
    const variance = laplacianVariance(toGrayscale(sharp), sharp.width, sharp.height);

    expect(variance).toBeGreaterThan(APP_CONFIG.intake.quality.blurVarianceMin);
  });

  it('measures the SAME image convolved to blur as far below it', () => {
    const sharp = checkerboard(LEAF_LIGHT, LEAF_DARK);
    const blurred = blur(sharp);

    const sharpVariance = laplacianVariance(toGrayscale(sharp), sharp.width, sharp.height);
    const blurredVariance = laplacianVariance(
      toGrayscale(blurred),
      blurred.width,
      blurred.height,
    );

    expect(blurredVariance).toBeLessThan(APP_CONFIG.intake.quality.blurVarianceMin);
    expect(blurredVariance).toBeLessThan(sharpVariance);
  });

  it('returns zero variance for an image too small to convolve', () => {
    expect(laplacianVariance(new Float32Array([1, 2, 3, 4]), 2, 2)).toBe(0);
  });

  it('reads two greens as full vegetation coverage and two earth tones as none', () => {
    expect(vegetationCoverage(checkerboard(LEAF_LIGHT, LEAF_DARK), BAND)).toBe(1);
    expect(vegetationCoverage(checkerboard(SOIL_LIGHT, SOIL_DARK), BAND)).toBe(0);
  });
});

describe('quality gate verdicts (WEB-FR-121, WEB-FR-122, WEB-FR-124)', () => {
  const verdictFor = (sample: ReturnType<typeof checkerboard>, edge: number) =>
    judgeQuality(measureQuality(edge, edge, sample));

  it('accepts a sharp, large, green photograph', () => {
    const verdict = verdictFor(checkerboard(LEAF_LIGHT, LEAF_DARK), LARGE_EDGE);
    expect(verdict.outcome).toBe(QUALITY_ACCEPTED);
  });

  it('rejects on the ORIGINAL short edge, not on the analysis sample', () => {
    // The sample is 96 px square either way; only the original dimensions differ.
    const verdict = verdictFor(checkerboard(LEAF_LIGHT, LEAF_DARK), SMALL_EDGE);
    expect(verdict.outcome).toBe(QUALITY_TOO_SMALL);
    expect(verdict.overridable).toBe(false);
  });

  it('rejects a blurred photograph naming blur, with no override', () => {
    const verdict = judgeQuality(
      measureQuality(LARGE_EDGE, LARGE_EDGE, blur(checkerboard(LEAF_LIGHT, LEAF_DARK))),
    );
    expect(verdict.outcome).toBe(QUALITY_BLURRY);
    expect(verdict.overridable).toBe(false);
  });

  it('offers an override for the vegetation heuristic and only for it', () => {
    const verdict = verdictFor(checkerboard(SOIL_LIGHT, SOIL_DARK), LARGE_EDGE);
    expect(verdict.outcome).toBe(QUALITY_NOT_CROP);
    expect(verdict.overridable).toBe(true);
  });

  it('carries both the local and the server blur thresholds for the bar to draw', () => {
    const measurements = measureQuality(
      LARGE_EDGE,
      LARGE_EDGE,
      checkerboard(LEAF_LIGHT, LEAF_DARK),
    );
    expect(measurements.serverBlurThreshold).toBe(APP_CONFIG.intake.quality.blurVarianceMin);
    expect(measurements.blurThreshold).toBe(
      APP_CONFIG.intake.quality.blurVarianceMin * APP_CONFIG.capture.blurVarianceClientMargin,
    );
  });
});
