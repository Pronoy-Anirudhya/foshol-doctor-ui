import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  resource,
  signal,
  viewChild,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { audioRef, SecureMediaService } from '../../../core/media/secure-media.service';

/**
 * WEB-FR-213 — the case audio player, with the Bangla transcript alongside it.
 *
 * WEB-FR-154 — the clip is fetched through the presigned URL the API returned, resolved by
 * `SecureMediaService`; nothing here builds an object-store path.
 *
 * WEB-UX-016 — the transcript arrives as an input and is rendered EXACTLY as received, as text,
 * in Bangla, never translated and never summarised. It is a farmer's own words about their own
 * crop; a translated or tidied version of it is agent-authored agricultural content
 * (COMMON-CON-003).
 *
 * The transport is hand-built rather than `<audio controls>` because native chrome is a
 * different visual language on every platform — it would be the one Chrome-grey rectangle in an
 * otherwise warm interface, it cannot be sized to the 44 px touch floor (WEB-UX-033), and its
 * labels ignore the language toggle. The native element is still doing all the work; only its
 * controls are replaced.
 *
 * WEB-FR-356 — position comes from the element's own `timeupdate` event, never from a polling
 * timer.
 */

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const CLOCK_PAD_LENGTH = 2;
const CLOCK_PAD_CHAR = '0';
const ZERO_SECONDS = 0;
/** The scrub track needs a non-zero range before the duration is known, or it renders inert. */
const UNKNOWN_DURATION = 1;
/** `<input type="range">` defaults to whole numbers, which would make scrubbing 1 s-granular. */
const SEEK_STEP_SECONDS = 0.1;

function formatClock(totalSeconds: number): string {
  const safe =
    Number.isFinite(totalSeconds) && totalSeconds > ZERO_SECONDS
      ? Math.floor(totalSeconds)
      : ZERO_SECONDS;
  const minutes = Math.floor(safe / SECONDS_PER_MINUTE);
  const seconds = safe % SECONDS_PER_MINUTE;
  return `${minutes}:${String(seconds).padStart(CLOCK_PAD_LENGTH, CLOCK_PAD_CHAR)}`;
}

@Component({
  selector: 'foshol-audio-player',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  templateUrl: './audio-player.html',
  styleUrl: './audio-player.css',
})
export class AudioPlayer {
  private readonly media = inject(SecureMediaService);
  private readonly element = viewChild<ElementRef<HTMLAudioElement>>('clip');

  readonly caseId = input.required<string>();

  /**
   * `CaseDetail.audio !== null`, or `OfficerQueueRow.hasAudio`. A photograph-only case is the
   * normal case, not an error — when this is false the component renders NOTHING at all rather
   * than an empty player or a "no audio" notice nobody asked for.
   */
  readonly hasAudio = input.required<boolean>();

  /** `CaseDetail.audio.transcriptBn` or `AnalysisDetail.transcriptBn`. Rendered verbatim. */
  readonly transcriptBn = input<string | null>(null);

  /** `CaseDetail.audio.durationMs`. A fallback only — see `durationSeconds`. */
  readonly durationMs = input<number | null>(null);

  private readonly _playing = signal(false);
  private readonly _position = signal(ZERO_SECONDS);
  private readonly _elementDuration = signal(ZERO_SECONDS);
  private readonly _failed = signal(false);

  /**
   * `params` returning undefined leaves the resource idle, which is how a case with no audio
   * avoids making a request that would answer 404 `ERR_AUDIO_NOT_FOUND` by design.
   */
  private readonly presigned = resource({
    params: () => (this.hasAudio() ? audioRef(this.caseId()) : undefined),
    loader: ({ params }) => this.media.resolve(params),
  });

  /** `value()` RETHROWS while the resource is in an error state, so it is guarded, not `??`-ed. */
  protected readonly src = computed(() =>
    this.presigned.hasValue() ? this.presigned.value() : null,
  );
  protected readonly playing = this._playing.asReadonly();
  protected readonly loading = computed(() => this.presigned.isLoading());

  protected readonly failed = computed(
    () => this._failed() || this.presigned.error() !== undefined,
  );

  /**
   * WEB-NFR-010 — the element's own metadata wins once it exists; `durationMs` from the API is
   * the fallback that keeps the total from reading `0:00` before the clip has loaded.
   */
  protected readonly durationSeconds = computed(() => {
    const fromElement = this._elementDuration();
    if (fromElement > ZERO_SECONDS) return fromElement;
    const declared = this.durationMs();
    return declared === null ? ZERO_SECONDS : declared / MS_PER_SECOND;
  });

  protected readonly seekMax = computed(() => {
    const duration = this.durationSeconds();
    return duration > ZERO_SECONDS ? duration : UNKNOWN_DURATION;
  });

  protected readonly seekStep = SEEK_STEP_SECONDS;
  protected readonly position = this._position.asReadonly();
  protected readonly elapsedLabel = computed(() => formatClock(this._position()));
  protected readonly totalLabel = computed(() => formatClock(this.durationSeconds()));

  /** Rendered exactly as received (WEB-UX-016); only emptiness is decided here. */
  protected readonly transcript = computed(() => {
    const text = this.transcriptBn();
    return text !== null && text.trim().length > ZERO_SECONDS ? text : null;
  });

  protected async toggle(): Promise<void> {
    const clip = this.element()?.nativeElement;
    if (clip === undefined) return;

    if (this._playing()) {
      clip.pause();
      return;
    }
    try {
      await clip.play();
    } catch {
      // A rejected play() is an autoplay-policy or decode failure, and either way the officer
      // needs a calm sentence rather than a console trace (WEB-FR-404).
      this._failed.set(true);
    }
  }

  protected onSeek(event: Event): void {
    const input = event.target;
    const clip = this.element()?.nativeElement;
    if (!(input instanceof HTMLInputElement) || clip === undefined) return;

    clip.currentTime = input.valueAsNumber;
    this._position.set(input.valueAsNumber);
  }

  protected onTimeUpdate(): void {
    const clip = this.element()?.nativeElement;
    if (clip === undefined) return;
    this._position.set(clip.currentTime);
  }

  protected onLoadedMetadata(): void {
    const clip = this.element()?.nativeElement;
    if (clip === undefined) return;
    // A streamed clip with no Content-Length reports Infinity until it has been played through.
    this._elementDuration.set(Number.isFinite(clip.duration) ? clip.duration : ZERO_SECONDS);
  }

  protected onPlay(): void {
    this._playing.set(true);
  }

  protected onPause(): void {
    this._playing.set(false);
  }

  protected onEnded(): void {
    this._playing.set(false);
    this._position.set(ZERO_SECONDS);
  }

  protected onError(): void {
    this._failed.set(true);
    this._playing.set(false);
  }
}
