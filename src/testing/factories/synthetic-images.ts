import { boxBlur, type PixelGrid } from '../../app/features/farmer/capture/image-metrics';

/**
 * WEB-TEST-008 — image fixtures are GENERATED INSIDE THE TEST, never committed as binaries.
 *
 * jsdom has no canvas, so "canvas-drawn" is satisfied by writing the RGBA buffer a canvas
 * would have produced: a high-contrast checkerboard for the sharp case, the same buffer run
 * through `boxBlur` for the blurred one. The blur is the real convolution the blur metric is
 * measured against, so the two can never drift apart, and there is no binary in the repository
 * whose provenance nobody can explain.
 */
export interface SyntheticImage {
  /** Stands in for the chosen `File`; the fake raster looks it up by identity. */
  readonly blob: Blob;
  /** The ORIGINAL decoded dimensions — what `WEB-FR-121` measures. */
  readonly width: number;
  readonly height: number;
  readonly sample: PixelGrid;
  /** What the fake encoder reports, so the `WEB-FR-114` size ladder can be driven. */
  readonly encodedBytes: number;
}

export type Rgb = readonly [number, number, number];

/** Two greens: both land inside the vegetation hue band, so the frame reads as foliage. */
export const LEAF_LIGHT: Rgb = [63, 143, 47];
export const LEAF_DARK: Rgb = [23, 58, 18];
/** Two earth tones: hue ~30°, well outside the band, so the frame reads as "not a crop". */
export const SOIL_LIGHT: Rgb = [138, 122, 106];
export const SOIL_DARK: Rgb = [58, 48, 40];

const CHANNELS = 4;
const OPAQUE = 255;
const SAMPLE_EDGE = 96;
const CELL_PX = 4;
const BLUR_RADIUS = 6;
const SMALL_EDGE = 120;
const FULL_EDGE = 1024;
const NOMINAL_BYTES = 220_000;
const PLACEHOLDER_MIME = 'image/jpeg';

/** A checkerboard: maximum high-frequency energy, which is what "sharp" means to a Laplacian. */
export function checkerboard(
  light: Rgb,
  dark: Rgb,
  edge = SAMPLE_EDGE,
  cell = CELL_PX,
): PixelGrid {
  const data = new Uint8ClampedArray(edge * edge * CHANNELS);
  for (let y = 0; y < edge; y++) {
    for (let x = 0; x < edge; x++) {
      const light2 = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
      const [r, g, b] = light2 ? light : dark;
      const base = (y * edge + x) * CHANNELS;
      data[base] = r;
      data[base + 1] = g;
      data[base + 2] = b;
      data[base + 3] = OPAQUE;
    }
  }
  return { width: edge, height: edge, data };
}

/** The same image, convolved to blur — twice, so the variance lands well under the gate. */
export function blur(grid: PixelGrid, radius = BLUR_RADIUS): PixelGrid {
  return boxBlur(boxBlur(grid, radius), radius);
}

function synthesise(
  name: string,
  sample: PixelGrid,
  width: number,
  height: number,
  encodedBytes = NOMINAL_BYTES,
): SyntheticImage {
  return {
    blob: new Blob([name], { type: PLACEHOLDER_MIME }),
    width,
    height,
    sample,
    encodedBytes,
  };
}

/** Sharp, large enough, and green: the one photograph the local gate accepts. */
export function passingImage(): SyntheticImage {
  return synthesise('sharp-leaf', checkerboard(LEAF_LIGHT, LEAF_DARK), FULL_EDGE, FULL_EDGE);
}

/** WEB-FR-122 — below the blur gate. No override may be offered for this one. */
export function blurredImage(): SyntheticImage {
  return synthesise(
    'blurred-leaf',
    blur(checkerboard(LEAF_LIGHT, LEAF_DARK)),
    FULL_EDGE,
    FULL_EDGE,
  );
}

/** WEB-FR-121 — the shorter ORIGINAL edge is below `intake.quality.minEdgePx`. */
export function undersizedImage(): SyntheticImage {
  return synthesise(
    'small-leaf',
    checkerboard(LEAF_LIGHT, LEAF_DARK),
    SMALL_EDGE,
    SMALL_EDGE,
  );
}

/** WEB-FR-124 — sharp and large, but no foliage: the one case that gets "send anyway". */
export function nonCropImage(): SyntheticImage {
  return synthesise('sharp-soil', checkerboard(SOIL_LIGHT, SOIL_DARK), FULL_EDGE, FULL_EDGE);
}

/** WEB-FR-114 — an image no rung of the ladder can bring under `intake.maxImageBytes`. */
export function oversizedImage(limitBytes: number): SyntheticImage {
  return synthesise(
    'huge-leaf',
    checkerboard(LEAF_LIGHT, LEAF_DARK),
    FULL_EDGE,
    FULL_EDGE,
    limitBytes * 2,
  );
}
