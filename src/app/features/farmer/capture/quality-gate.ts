import { APP_CONFIG } from '../../../core/config/app-config';
import { laplacianVariance, toGrayscale, vegetationCoverage, type PixelGrid } from './image-metrics';

/**
 * The local verdict — demo beat 3.
 *
 * WEB-FR-120…122 — minimum edge and blur are evaluated locally, before any upload begins.
 * WEB-FR-123 — because this is synchronous arithmetic over one already-decoded sample, the
 * rejection is on screen before a request could have been *started*, let alone completed. A
 * rejection that arrives after a round trip is a server rejection wearing a client's clothes.
 * WEB-FR-125 — none of this is authoritative. The server gate in `11-intake.ears.md` remains
 * the decision of record; this exists to save a farmer on field data a pointless upload.
 */

export const QUALITY_ACCEPTED = 'ACCEPTED';
export const QUALITY_TOO_SMALL = 'TOO_SMALL';
export const QUALITY_BLURRY = 'BLURRY';
export const QUALITY_NOT_CROP = 'NOT_CROP';
export const QUALITY_TOO_LARGE = 'TOO_LARGE';
/** The browser could not decode the file at all — a corrupt capture, or a mislabelled type. */
export const QUALITY_UNREADABLE = 'UNREADABLE';

export type QualityOutcome =
  | typeof QUALITY_ACCEPTED
  | typeof QUALITY_TOO_SMALL
  | typeof QUALITY_BLURRY
  | typeof QUALITY_NOT_CROP
  | typeof QUALITY_TOO_LARGE
  | typeof QUALITY_UNREADABLE;

/**
 * WEB-FR-124 — the vegetation heuristic, and ONLY the vegetation heuristic, may be overridden.
 * Blur and size get no override because the server's own gate would reject those anyway, so an
 * override there would buy a farmer a slow upload and the same answer.
 */
const OVERRIDABLE: ReadonlySet<QualityOutcome> = new Set<QualityOutcome>([QUALITY_NOT_CROP]);

export interface QualityMeasurements {
  /** Measured on the ORIGINAL dimensions, never on the downscaled analysis sample. */
  readonly shortEdgePx: number;
  readonly minEdgePx: number;
  readonly blurVariance: number;
  /** The local gate: the server's minimum times `capture.blurVarianceClientMargin`. */
  readonly blurThreshold: number;
  /** The server's own minimum, carried through so the bar can show both lines. */
  readonly serverBlurThreshold: number;
  readonly vegetationCoverage: number;
  readonly vegetationThreshold: number;
}

export interface QualityVerdict {
  readonly outcome: QualityOutcome;
  readonly overridable: boolean;
  readonly measurements: QualityMeasurements;
}

/**
 * WEB-FR-121 — the short edge is measured on the image as decoded, not on the 224 px analysis
 * canvas. Measuring the sample would pass every photograph ever taken, because the sample is
 * by construction exactly `capture.analysisEdgePx` on its longest edge.
 */
export function measureQuality(
  width: number,
  height: number,
  sample: PixelGrid,
): QualityMeasurements {
  const gray = toGrayscale(sample);
  const { quality } = APP_CONFIG.intake;
  const { capture } = APP_CONFIG;

  return {
    shortEdgePx: Math.min(width, height),
    minEdgePx: quality.minEdgePx,
    blurVariance: laplacianVariance(gray, sample.width, sample.height),
    blurThreshold: quality.blurVarianceMin * capture.blurVarianceClientMargin,
    serverBlurThreshold: quality.blurVarianceMin,
    vegetationCoverage: vegetationCoverage(sample, {
      hueMinDeg: capture.vegHueMinDeg,
      hueMaxDeg: capture.vegHueMaxDeg,
      satMin: capture.vegSatMin,
      valMin: capture.vegValMin,
      valMax: capture.vegValMax,
    }),
    vegetationThreshold: capture.vegetationCoverageMin,
  };
}

/**
 * Order matters and is not arbitrary: a photograph too small to analyse produces a meaningless
 * blur figure, and a blurred photograph produces a meaningless vegetation figure. The first
 * reason that fires is the only one a farmer is told, because a list of three faults is not
 * advice about what to do next.
 */
export function judgeQuality(measurements: QualityMeasurements): QualityVerdict {
  const outcome = outcomeOf(measurements);
  return { outcome, overridable: OVERRIDABLE.has(outcome), measurements };
}

function outcomeOf(m: QualityMeasurements): QualityOutcome {
  if (m.shortEdgePx < m.minEdgePx) return QUALITY_TOO_SMALL;
  if (m.blurVariance < m.blurThreshold) return QUALITY_BLURRY;
  if (m.vegetationCoverage < m.vegetationThreshold) return QUALITY_NOT_CROP;
  return QUALITY_ACCEPTED;
}

/** WEB-FR-114 — the size failure is a verdict too, so one surface reports every rejection. */
export function tooLargeVerdict(measurements: QualityMeasurements): QualityVerdict {
  return { outcome: QUALITY_TOO_LARGE, overridable: false, measurements };
}

/** A file the browser refused to decode never got as far as being measured. */
export function unreadableVerdict(): QualityVerdict {
  return {
    outcome: QUALITY_UNREADABLE,
    overridable: false,
    measurements: {
      shortEdgePx: UNMEASURED,
      minEdgePx: APP_CONFIG.intake.quality.minEdgePx,
      blurVariance: UNMEASURED,
      blurThreshold: APP_CONFIG.intake.quality.blurVarianceMin,
      serverBlurThreshold: APP_CONFIG.intake.quality.blurVarianceMin,
      vegetationCoverage: UNMEASURED,
      vegetationThreshold: APP_CONFIG.capture.vegetationCoverageMin,
    },
  };
}

const UNMEASURED = 0;
