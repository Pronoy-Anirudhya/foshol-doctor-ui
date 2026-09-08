import { APP_CONFIG } from '../../../core/config/app-config';
import { AUDIO_MIME_PREFERENCE, negotiateAudioMime } from './voice-recorder';

/**
 * WEB-FR-138 / WEB-FR-139 — container negotiation is the whole of the mobile audio story, and
 * it is pure, so it is tested directly rather than through a `MediaRecorder` jsdom does not
 * have.
 */
describe('audio container negotiation (WEB-FR-138, WEB-FR-139)', () => {
  const allowed = APP_CONFIG.intake.allowedAudioTypes;

  it('prefers WebM/Opus where the browser supports it', () => {
    expect(negotiateAudioMime(() => true, allowed)).toBe(AUDIO_MIME_PREFERENCE[0]);
  });

  it('falls back to audio/mp4 on Safari, which supports no WebM at all', () => {
    const safari = (type: string): boolean => type.startsWith('audio/mp4');
    expect(negotiateAudioMime(safari, allowed)).toBe('audio/mp4');
  });

  it('falls back to audio/ogg when only that is offered', () => {
    const oggOnly = (type: string): boolean => type.startsWith('audio/ogg');
    expect(negotiateAudioMime(oggOnly, allowed)).toBe('audio/ogg');
  });

  it('returns null when nothing is supported, so the recorder can hide itself', () => {
    expect(negotiateAudioMime(() => false, allowed)).toBeNull();
  });

  it('never negotiates a type the server does not accept, however well supported', () => {
    expect(negotiateAudioMime(() => true, ['audio/wav'])).toBeNull();
  });

  it('offers only candidates whose base type is in the allowed list', () => {
    for (const candidate of AUDIO_MIME_PREFERENCE) {
      expect(allowed).toContain(candidate.split(';')[0]);
    }
  });
});
