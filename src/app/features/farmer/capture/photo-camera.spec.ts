import { describe, expect, it } from 'vitest';
import {
  CAMERA_DENIED,
  CAMERA_NO_DEVICE,
  CAMERA_INSECURE,
  mapCameraError,
} from './photo-camera';

/**
 * `getUserMedia` and a live `<video>` stream are not automatable without a device — this
 * mirrors `voice-recorder.spec.ts`'s scope, which likewise tests only the pure error-mapping
 * function and leaves the full permission/stream lifecycle to manual verification.
 */
describe('camera error mapping', () => {
  it('maps NotFoundError to NO_DEVICE — no camera on the machine', () => {
    expect(mapCameraError(Object.assign(new Error(), { name: 'NotFoundError' }))).toBe(
      CAMERA_NO_DEVICE,
    );
  });

  it('maps SecurityError to INSECURE', () => {
    expect(mapCameraError(Object.assign(new Error(), { name: 'SecurityError' }))).toBe(
      CAMERA_INSECURE,
    );
  });

  it('maps NotAllowedError to DENIED — the farmer said no', () => {
    expect(mapCameraError(Object.assign(new Error(), { name: 'NotAllowedError' }))).toBe(
      CAMERA_DENIED,
    );
  });

  it('defaults an unrecognised failure to DENIED rather than crashing the panel', () => {
    expect(mapCameraError(new Error('AbortError'))).toBe(CAMERA_DENIED);
    expect(mapCameraError('not even an Error')).toBe(CAMERA_DENIED);
    expect(mapCameraError(undefined)).toBe(CAMERA_DENIED);
  });
});
