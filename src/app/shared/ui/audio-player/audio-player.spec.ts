import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { SecureMediaService } from '../../../core/media/secure-media.service';
import { AudioPlayer } from './audio-player';

const AUDIO_URL = 'https://store.example/case.wav?X-Amz-Signature=a';
/** A farmer's own words. Rendered exactly as received, never translated (WEB-UX-016). */
const TRANSCRIPT = 'আমার ধানের পাতায় বাদামি দাগ পড়েছে';

class FakeSecureMediaService {
  calls = 0;
  /** A flag rather than a stored rejected promise: an eagerly rejected one that nothing has
   *  awaited yet is reported as an unhandled rejection and poisons the whole run. */
  failing = false;

  resolve(): Promise<string> {
    this.calls += 1;
    return this.failing ? Promise.reject(new Error('no audio')) : Promise.resolve(AUDIO_URL);
  }
}

@Component({
  imports: [AudioPlayer],
  template: `
    <foshol-audio-player
      caseId="c-1"
      [hasAudio]="hasAudio()"
      [transcriptBn]="transcript()"
      [durationMs]="durationMs()"
    />
  `,
})
class Host {
  readonly hasAudio = signal(true);
  readonly transcript = signal<string | null>(TRANSCRIPT);
  readonly durationMs = signal<number | null>(9_000);
}

describe('AudioPlayer', () => {
  let media: FakeSecureMediaService;

  const create = async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    return fixture;
  };

  beforeEach(() => {
    media = new FakeSecureMediaService();
    TestBed.configureTestingModule({
      providers: [provideTranslateService(), { provide: SecureMediaService, useValue: media }],
    });
  });

  /** A photograph-only case is the normal case, not an error state. */
  it('renders nothing at all when the case has no audio', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.hasAudio.set(false);
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.player')).toBeNull();
    expect(media.calls).toBe(0);
  });

  /** WEB-FR-154 — played from the presigned URL, never a constructed object-store path. */
  it('plays the presigned URL the API returned', async () => {
    const fixture = await create();
    const clip = (fixture.nativeElement as HTMLElement).querySelector<HTMLAudioElement>('audio');

    expect(clip?.getAttribute('src')).toBe(AUDIO_URL);
  });

  /** The whole point of the custom transport: no native chrome. */
  it('does not use the browser default controls', async () => {
    const fixture = await create();
    const clip = (fixture.nativeElement as HTMLElement).querySelector<HTMLAudioElement>('audio');

    expect(clip?.hasAttribute('controls')).toBe(false);
    expect(fixture.nativeElement.querySelector('.play')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.scrub')).not.toBeNull();
  });

  it('shows elapsed and total time', async () => {
    const fixture = await create();
    expect(fixture.nativeElement.querySelector('.clock')?.textContent?.trim()).toBe('0:00 / 0:09');
  });

  /** WEB-UX-016 — verbatim, in Bangla, and marked as Bangla for assistive technology. */
  it('renders the transcript exactly as received', async () => {
    const fixture = await create();
    const body = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '.transcriptBody',
    );

    expect(body?.textContent).toBe(TRANSCRIPT);
    expect(body?.getAttribute('lang')).toBe('bn');
  });

  it('says so plainly when there is audio but no transcript', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.transcript.set(null);
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.transcriptBody')).toBeNull();
    expect(fixture.nativeElement.querySelector('.notice')?.textContent?.trim()).toBe(
      'media.audio.transcriptMissing',
    );
  });

  /** WEB-UX-040 — the scrub is a range input, so arrows, Home and End work for free. */
  it('exposes a labelled, keyboard-operable scrub control', async () => {
    const fixture = await create();
    const scrub = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('.scrub');

    expect(scrub?.type).toBe('range');
    expect(scrub?.getAttribute('aria-label')).not.toBeNull();
    expect(scrub?.getAttribute('aria-valuetext')).not.toBeNull();
  });

  /** WEB-FR-404 — a calm translated sentence, never a raw browser media error. */
  it('shows a calm message when the clip fails to load', async () => {
    const fixture = await create();

    fixture.nativeElement.querySelector('audio')?.dispatchEvent(new Event('error'));
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.notice')?.textContent?.trim()).toBe(
      'media.audio.unavailable',
    );
    expect(fixture.nativeElement.querySelector('.transport')).toBeNull();
  });

  it('shows the same message when the presign fails', async () => {
    media.failing = true;

    const fixture = await create();

    expect(fixture.nativeElement.querySelector('.notice')?.textContent?.trim()).toBe(
      'media.audio.unavailable',
    );
  });
});
