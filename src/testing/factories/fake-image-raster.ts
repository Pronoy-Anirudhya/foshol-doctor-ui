import type {
  ImageRasterPort,
  OpenRaster,
} from '../../app/features/farmer/capture/image-raster.port';
import type { SyntheticImage } from './synthetic-images';

/**
 * The canvas, replaced.
 *
 * It stands in for exactly one thing — decoding and re-encoding — and for nothing else: the
 * grid it hands back is the fixture's own pixels, and every metric, threshold and verdict is
 * still computed by the production code under test. A fake that decided the outcome would test
 * the fake (`WEB-TEST-002`).
 */
export class FakeImageRaster implements ImageRasterPort {
  /** Every `encode` the size ladder asked for, in order (`WEB-FR-114`). */
  readonly encodeCalls: { maxEdgePx: number; quality: number }[] = [];
  /** How many times a source was decoded at all — zero for a file never chosen. */
  readonly openCalls: Blob[] = [];
  readonly closed: string[] = [];

  constructor(private readonly images: readonly SyntheticImage[]) {}

  async open(source: Blob): Promise<OpenRaster> {
    this.openCalls.push(source);
    const image = this.images.find((candidate) => candidate.blob === source);
    if (image === undefined) throw new Error('no synthetic image registered for this blob');

    return {
      width: image.width,
      height: image.height,
      sample: image.sample,
      encode: async (maxEdgePx: number, quality: number): Promise<Blob> => {
        this.encodeCalls.push({ maxEdgePx, quality });
        // Quality and edge both shrink the file, which is what the ladder is stepping through.
        const scale = quality * (maxEdgePx / Math.max(image.width, image.height));
        return blobOfSize(Math.max(1, Math.round(image.encodedBytes * scale)));
      },
      close: (): void => {
        this.closed.push(String(image.width));
      },
    };
  }
}

function blobOfSize(bytes: number): Blob {
  return new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });
}
