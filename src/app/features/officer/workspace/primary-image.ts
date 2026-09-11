import type { CaseImage } from '../../../generated/models/case-image';

/**
 * WEB-FR-211 — the image the Grad-CAM belongs to. The server marks it `primary`; when no image
 * carries the mark, the lowest `position` stands in, which is the order the farmer took them.
 */
export function primaryImageOf(images: readonly CaseImage[]): CaseImage | null {
  const marked = images.find((image) => image.primary);
  if (marked !== undefined) return marked;
  return images.reduce<CaseImage | null>(
    (lowest, image) => (lowest === null || image.position < lowest.position ? image : lowest),
    null,
  );
}
