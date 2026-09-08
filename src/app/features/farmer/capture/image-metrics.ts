/**
 * The local quality gate's arithmetic — demo beat 3, expressed as pure functions over typed
 * arrays and nothing else.
 *
 * Why pure functions rather than methods on a canvas-owning service: the unit tests run on
 * jsdom, which has no canvas at all, and adding one would be a new dev dependency
 * (WEB-NFR-007) plus a native build step (WEB-NFR-020). Every number that decides whether a
 * farmer's photograph is rejected is therefore computed here, over an `ImageData`-shaped
 * buffer a test can synthesise in three lines, while the canvas lives behind
 * `image-raster.port.ts` where a fake can replace it.
 *
 * WEB-FR-120 — one downscaled sample feeds all three metrics. Rasterising three times to ask
 * three questions is three decodes of a 12 MP photograph on a phone.
 */

/** Exactly the shape of `ImageData`: RGBA, four bytes per pixel, row-major. */
export interface PixelGrid {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/** Hue is in degrees; saturation and value are 0…1. */
export interface VegetationBand {
  readonly hueMinDeg: number;
  readonly hueMaxDeg: number;
  readonly satMin: number;
  readonly valMin: number;
  readonly valMax: number;
}

const CHANNELS = 4;
const RED_OFFSET = 0;
const GREEN_OFFSET = 1;
const BLUE_OFFSET = 2;

/** ITU-R BT.601 luma weights — the definition of the grayscale, not a tunable threshold. */
const LUMA_RED = 0.299;
const LUMA_GREEN = 0.587;
const LUMA_BLUE = 0.114;

const BYTE_MAX = 255;
const ZERO = 0;
const ONE = 1;

/** The 4-neighbour Laplacian `[[0,1,0],[1,-4,1],[0,1,0]]`, so the centre tap is -4. */
const LAPLACIAN_CENTRE_TAP = 4;
/** The kernel needs one pixel of margin on every side, so a 3×3 image is the smallest. */
const BORDER = 1;
const MIN_CONVOLVABLE_EDGE = 3;

const DEGREES_PER_TURN = 360;
const HUE_SECTOR_DEG = 60;
const HUE_SECTORS_RED = 0;
const HUE_SECTORS_GREEN = 2;
const HUE_SECTORS_BLUE = 4;

/**
 * Flatten RGBA to one luma plane at 0…255.
 *
 * `Float32Array` rather than `Uint8ClampedArray` because the Laplacian response is signed and
 * routinely leaves the byte range; clamping it would flatten precisely the high-frequency
 * detail the variance is measuring.
 */
export function toGrayscale(grid: PixelGrid): Float32Array {
  const pixels = grid.width * grid.height;
  const gray = new Float32Array(pixels);
  for (let index = ZERO; index < pixels; index++) {
    const base = index * CHANNELS;
    gray[index] =
      LUMA_RED * grid.data[base + RED_OFFSET] +
      LUMA_GREEN * grid.data[base + GREEN_OFFSET] +
      LUMA_BLUE * grid.data[base + BLUE_OFFSET];
  }
  return gray;
}

/**
 * Variance of the Laplacian — the standard cheap sharpness estimate, and the same family of
 * measure the server's own gate uses (`foshol.intake.quality.blur-variance-min`).
 *
 * `var = E[x²] − E[x]²` over the interior only: the border pixels have no full neighbourhood,
 * and including a half-populated kernel there manufactures edge energy that is an artefact of
 * the crop rather than of the photograph.
 */
export function laplacianVariance(gray: Float32Array, width: number, height: number): number {
  if (width < MIN_CONVOLVABLE_EDGE || height < MIN_CONVOLVABLE_EDGE) return ZERO;

  let sum = ZERO;
  let sumOfSquares = ZERO;
  let count = ZERO;

  for (let y = BORDER; y < height - BORDER; y++) {
    for (let x = BORDER; x < width - BORDER; x++) {
      const index = y * width + x;
      const response =
        gray[index - width] +
        gray[index - BORDER] +
        gray[index + BORDER] +
        gray[index + width] -
        LAPLACIAN_CENTRE_TAP * gray[index];
      sum += response;
      sumOfSquares += response * response;
      count++;
    }
  }

  if (count === ZERO) return ZERO;
  const mean = sum / count;
  return sumOfSquares / count - mean * mean;
}

/**
 * The fraction of the frame that reads as living plant tissue.
 *
 * WEB-FR-124 `[DERIVED]` — there is no client-side model that can answer "is this a crop
 * photograph", so a hue/saturation/value coverage band is the honest approximation. It is
 * weak on purpose and it is never the last word: the caller always offers an override, so a
 * false positive costs a farmer one extra tap rather than a lost case.
 */
export function vegetationCoverage(grid: PixelGrid, band: VegetationBand): number {
  const pixels = grid.width * grid.height;
  if (pixels === ZERO) return ZERO;

  let matched = ZERO;
  for (let index = ZERO; index < pixels; index++) {
    const base = index * CHANNELS;
    const red = grid.data[base + RED_OFFSET] / BYTE_MAX;
    const green = grid.data[base + GREEN_OFFSET] / BYTE_MAX;
    const blue = grid.data[base + BLUE_OFFSET] / BYTE_MAX;

    const value = Math.max(red, green, blue);
    const lowest = Math.min(red, green, blue);
    const chroma = value - lowest;
    const saturation = value === ZERO ? ZERO : chroma / value;

    if (saturation < band.satMin) continue;
    if (value < band.valMin || value > band.valMax) continue;

    const hue = hueOf(red, green, blue, value, chroma);
    if (hue >= band.hueMinDeg && hue <= band.hueMaxDeg) matched++;
  }

  return matched / pixels;
}

/**
 * A separable box blur, used only by the tests: `WEB-TEST-008` demands the blurred fixture be
 * "the same image convolved to blur" and generated inside the test rather than committed as a
 * binary. It lives beside the metric it is measured by so the two can never drift apart, and
 * so the blur that produces the demo-beat-3 rejection is the one this file's own tests use.
 */
export function boxBlur(grid: PixelGrid, radius: number): PixelGrid {
  if (radius < ONE) return grid;
  const horizontal = blurAxis(grid, radius, true);
  return blurAxis(horizontal, radius, false);
}

function blurAxis(grid: PixelGrid, radius: number, alongX: boolean): PixelGrid {
  const { width, height } = grid;
  const out = new Uint8ClampedArray(grid.data.length);

  for (let y = ZERO; y < height; y++) {
    for (let x = ZERO; x < width; x++) {
      let red = ZERO;
      let green = ZERO;
      let blue = ZERO;
      let alpha = ZERO;
      let taps = ZERO;

      for (let offset = -radius; offset <= radius; offset++) {
        const sampleX = alongX ? clamp(x + offset, width) : x;
        const sampleY = alongX ? y : clamp(y + offset, height);
        const base = (sampleY * width + sampleX) * CHANNELS;
        red += grid.data[base + RED_OFFSET];
        green += grid.data[base + GREEN_OFFSET];
        blue += grid.data[base + BLUE_OFFSET];
        alpha += grid.data[base + BLUE_OFFSET + ONE];
        taps++;
      }

      const target = (y * width + x) * CHANNELS;
      out[target + RED_OFFSET] = red / taps;
      out[target + GREEN_OFFSET] = green / taps;
      out[target + BLUE_OFFSET] = blue / taps;
      out[target + BLUE_OFFSET + ONE] = alpha / taps;
    }
  }

  return { width, height, data: out };
}

function clamp(value: number, limit: number): number {
  if (value < ZERO) return ZERO;
  return value >= limit ? limit - ONE : value;
}

function hueOf(
  red: number,
  green: number,
  blue: number,
  value: number,
  chroma: number,
): number {
  if (chroma === ZERO) return ZERO;

  let sectors: number;
  if (value === red) sectors = HUE_SECTORS_RED + (green - blue) / chroma;
  else if (value === green) sectors = HUE_SECTORS_GREEN + (blue - red) / chroma;
  else sectors = HUE_SECTORS_BLUE + (red - green) / chroma;

  const degrees = sectors * HUE_SECTOR_DEG;
  return degrees < ZERO ? degrees + DEGREES_PER_TURN : degrees;
}
