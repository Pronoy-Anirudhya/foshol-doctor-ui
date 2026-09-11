import type { CaseImage } from '../../../generated/models/case-image';
import { primaryImageOf } from './primary-image';

const image = (imageId: string, position: number, primary = false): CaseImage => ({
  imageId,
  position,
  primary,
});

describe('primaryImageOf (WEB-FR-211)', () => {
  it('takes the image the server marked primary, wherever it sits', () => {
    expect(primaryImageOf([image('a', 0), image('b', 1, true), image('c', 2)])?.imageId).toBe('b');
  });

  it('falls back to the lowest position when none is marked', () => {
    expect(primaryImageOf([image('c', 2), image('a', 0), image('b', 1)])?.imageId).toBe('a');
  });

  it('has nothing to offer for a case with no images', () => {
    expect(primaryImageOf([])).toBeNull();
  });
});
