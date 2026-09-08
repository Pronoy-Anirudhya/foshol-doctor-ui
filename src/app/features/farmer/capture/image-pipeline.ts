import { inject, Injectable } from '@angular/core';
import { APP_CONFIG } from '../../../core/config/app-config';
import { IMAGE_RASTER, type OpenRaster } from './image-raster.port';
import {
  judgeQuality,
  measureQuality,
  QUALITY_ACCEPTED,
  tooLargeVerdict,
  type QualityVerdict,
} from './quality-gate';

/**
 * One chosen photograph, taken from a `File` to something the draft store can hold.
 *
 * The order of operations is the requirement, not an implementation detail:
 *
 *  1. decode once, with EXIF orientation applied (`WEB-FR-112`);
 *  2. judge locally (`WEB-FR-120`–`124`);
 *  3. **only then** re-encode.
 *
 * A rejected image is never encoded and — the point of demo beat 3 — never reaches the
 * network. `WEB-FR-123` asks for the rejection to be visible before an upload for that image
 * has *completed*; doing the judging before the encode makes it visible before one has even
 * begun, on a phone, on field data.
 */
export interface PreparedImage {
  readonly verdict: QualityVerdict;
  /** `null` whenever the verdict is not an acceptance — nothing was encoded. */
  readonly blob: Blob | null;
  readonly width: number;
  readonly height: number;
}

@Injectable({ providedIn: 'root' })
export class ImagePipeline {
  private readonly raster = inject(IMAGE_RASTER);

  /**
   * `overrideVegetation` is the farmer having tapped "send anyway" (`WEB-FR-124`). It reaches
   * only the overridable verdict; a blurred or undersized photograph cannot be forced through,
   * because the server's gate would reject it and the farmer would wait for the round trip to
   * be told what this screen already knew.
   */
  async prepare(source: Blob, overrideVegetation = false): Promise<PreparedImage> {
    const open: OpenRaster = await this.raster.open(source);
    try {
      const measurements = measureQuality(open.width, open.height, open.sample);
      const verdict = judgeQuality(measurements);
      const forced = overrideVegetation && verdict.overridable;

      if (verdict.outcome !== QUALITY_ACCEPTED && !forced) {
        return { verdict, blob: null, width: open.width, height: open.height };
      }

      const blob = await encodeUnderLimit(open);
      if (blob === null) {
        return {
          verdict: tooLargeVerdict(measurements),
          blob: null,
          width: open.width,
          height: open.height,
        };
      }
      return { verdict, blob, width: open.width, height: open.height };
    } finally {
      open.close();
    }
  }
}

/**
 * WEB-FR-112 / WEB-FR-114 — the first rung of the ladder IS `capture.jpegQuality`, so the
 * ordinary path is exactly the requirement's "at most `capture.maxEdgePx` at
 * `capture.jpegQuality`". Only when that still exceeds `intake.maxImageBytes` does quality
 * step down, then the edge, and only after both does the image get rejected — naming the
 * limit, which the caller renders from `intake.maxImageBytes` rather than from a message the
 * server would have sent after a wasted upload.
 */
async function encodeUnderLimit(open: OpenRaster): Promise<Blob | null> {
  const { capture, intake } = APP_CONFIG;

  for (const quality of capture.qualityLadder) {
    const encoded = await open.encode(capture.maxEdgePx, quality);
    if (encoded.size <= intake.maxImageBytes) return encoded;
  }

  const lastRung = capture.qualityLadder[capture.qualityLadder.length - ONE_RUNG];
  const smaller = await open.encode(capture.fallbackEdgePx, lastRung);
  return smaller.size <= intake.maxImageBytes ? smaller : null;
}

const ONE_RUNG = 1;
