import { InjectionToken } from '@angular/core';
import { APP_CONFIG } from '../../../core/config/app-config';
import type { PixelGrid } from './image-metrics';

/**
 * The one place in the capture pipeline that touches a canvas.
 *
 * Everything downstream — the quality gate, the size ladder, the page — works on a
 * `PixelGrid` and a `Blob`, so the tests replace this port with a fake and jsdom's complete
 * absence of a canvas implementation stops being a problem (WEB-NFR-020: no headless-browser
 * test runner, WEB-NFR-007: no `canvas` native dependency).
 */
export interface OpenRaster {
  /** The decoded dimensions, with EXIF orientation already applied (WEB-FR-112). */
  readonly width: number;
  readonly height: number;
  /** One downscaled RGBA sample, shared by all three local metrics (WEB-FR-120). */
  readonly sample: PixelGrid;
  /** Re-encode to JPEG, longest edge capped, at the given quality (WEB-FR-112/114). */
  encode(maxEdgePx: number, quality: number): Promise<Blob>;
  /** Release the decoded bitmap. A 12 MP bitmap held open is 48 MB of phone memory. */
  close(): void;
}

export interface ImageRasterPort {
  open(source: Blob): Promise<OpenRaster>;
}

/**
 * WEB-FR-112 — `imageOrientation: 'from-image'` IS the EXIF orientation fix: the bitmap comes
 * back already rotated, so `width`/`height` are the dimensions a human sees. And because a
 * canvas re-encode emits a JPEG built from pixels rather than copied from the source file, the
 * output carries no EXIF segment at all — no orientation, and no GPS. Stripping location is
 * therefore unconditional because the re-encode is unconditional: a farmer's coordinates are
 * data this system has no requirement to collect, so it must not be able to collect them by
 * accident on the one photograph that happened to fit under the size limit.
 */
const JPEG_MIME = 'image/jpeg';
const ORIENTATION_FROM_IMAGE = 'from-image';
const CONTEXT_2D = '2d';
const ONE_PIXEL = 1;

export const IMAGE_RASTER = new InjectionToken<ImageRasterPort>('foshol.capture.imageRaster', {
  providedIn: 'root',
  factory: (): ImageRasterPort => new CanvasImageRaster(),
});

class CanvasImageRaster implements ImageRasterPort {
  async open(source: Blob): Promise<OpenRaster> {
    const bitmap = await createImageBitmap(source, { imageOrientation: ORIENTATION_FROM_IMAGE });
    return {
      width: bitmap.width,
      height: bitmap.height,
      sample: sampleOf(bitmap, APP_CONFIG.capture.analysisEdgePx),
      encode: (maxEdgePx: number, quality: number): Promise<Blob> =>
        encodeJpeg(bitmap, maxEdgePx, quality),
      close: (): void => bitmap.close(),
    };
  }
}

/** Fit inside a square of `edgePx` so the sample covers the WHOLE frame, letterbox-free. */
function scaleToFit(width: number, height: number, edgePx: number): { w: number; h: number } {
  const longest = Math.max(width, height);
  const factor = longest <= edgePx ? ONE_PIXEL : edgePx / longest;
  return {
    w: Math.max(ONE_PIXEL, Math.round(width * factor)),
    h: Math.max(ONE_PIXEL, Math.round(height * factor)),
  };
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

/**
 * `OffscreenCanvas` keeps the decode off the layout tree, but iOS Safari only gained it
 * recently and the farmer surface is used on real phones (`WEB-FR-137`–`146`, `COMMON-NFR-047`).
 * The DOM canvas fallback is three lines and removes a whole class of device-specific failure.
 */
function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

interface Painted {
  readonly canvas: AnyCanvas;
  readonly context: CanvasRenderingContext2D;
}

function paint(bitmap: ImageBitmap, w: number, h: number): Painted {
  const canvas = makeCanvas(w, h);
  const context = canvas.getContext(CONTEXT_2D) as CanvasRenderingContext2D | null;
  if (context === null) throw new Error(RASTER_UNAVAILABLE);
  context.drawImage(bitmap, 0, 0, w, h);
  return { canvas, context };
}

function sampleOf(bitmap: ImageBitmap, edgePx: number): PixelGrid {
  const { w, h } = scaleToFit(bitmap.width, bitmap.height, edgePx);
  const image = paint(bitmap, w, h).context.getImageData(0, 0, w, h);
  return { width: image.width, height: image.height, data: image.data };
}

async function encodeJpeg(bitmap: ImageBitmap, maxEdgePx: number, quality: number): Promise<Blob> {
  const { w, h } = scaleToFit(bitmap.width, bitmap.height, maxEdgePx);
  const { canvas } = paint(bitmap, w, h);

  if (canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: JPEG_MIME, quality });
  }
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob === null ? reject(new Error(RASTER_UNAVAILABLE)) : resolve(blob)),
      JPEG_MIME,
      quality,
    );
  });
}

/** Not user-visible: it is caught and reported as a rejection the farmer can act on. */
const RASTER_UNAVAILABLE = 'canvas-2d-unavailable';
