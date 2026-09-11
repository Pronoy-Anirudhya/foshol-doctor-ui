import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import {
  CASE_IMAGE_DERIVATIVE,
  CaseImageContentService,
  type CaseImageVariant,
} from '../../../core/media/case-image-content.service';
import { Icon } from '../icon/icon';

/**
 * A case photograph on the officer case detail, loaded through the contract operation
 * `GET /api/v1/cases/{caseId}/images/{imageId}/content` (`DEVIATIONS.md` D-38).
 *
 * That operation answers `302` into the object store and needs the bearer, which an `<img src>`
 * cannot carry — so the API path is never an image source. `CaseImageContentService` fetches it,
 * follows the redirect without the bearer (WEB-SEC-003) and hands back a `blob:` object URL that
 * this component owns and revokes when its inputs change or it is destroyed.
 *
 * The same promises as `SecureImage`, which the farmer screens still use: `alt` is required
 * (WEB-UX-042), a skeleton holds the region from the first frame (WEB-FR-400), and a failure is a
 * calm line of text, never the browser's broken-image glyph.
 */

type LoadState = 'loading' | 'ready' | 'failed';

/** The photograph's intrinsic size — what lets a caller line an overlay up with it. */
export interface PhotoSize {
  readonly width: number;
  readonly height: number;
}

@Component({
  selector: 'foshol-case-photo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, TranslatePipe],
  templateUrl: './case-photo.html',
  styleUrl: './case-photo.css',
  host: {
    '[attr.data-state]': 'state()',
  },
})
export class CasePhoto {
  private readonly content = inject(CaseImageContentService);

  readonly caseId = input.required<string>();
  readonly imageId = input.required<string>();
  /** A thumbnail wants the derivative; the officer's primary view asks for the original. */
  readonly variant = input<CaseImageVariant>(CASE_IMAGE_DERIVATIVE);

  /** WEB-UX-042 — required, and required on purpose: a case photograph is never decorative. */
  readonly alt = input.required<string>();

  /** `fill` is for a caller that has already sized the box to the photograph's proportions. */
  readonly fit = input<'cover' | 'contain' | 'fill'>('cover');

  readonly naturalSize = output<PhotoSize>();

  /**
   * Held as a plain field as well as a signal, so revocation bookkeeping never becomes a
   * dependency of the effect that performs it.
   */
  private objectUrl: string | null = null;
  private readonly _src = signal<string | null>(null);
  private readonly _state = signal<LoadState>('loading');
  /** Bumped to fetch again. The API mints a fresh redirect on every request. */
  private readonly _attempt = signal(0);
  /** One refetch per set of inputs, then the text placeholder. Never a retry loop. */
  private retriedFor: string | null = null;

  protected readonly src = this._src.asReadonly();
  protected readonly state = this._state.asReadonly();

  constructor() {
    effect((onCleanup) => {
      const caseId = this.caseId();
      const imageId = this.imageId();
      const variant = this.variant();
      this._attempt();

      let cancelled = false;
      onCleanup(() => {
        cancelled = true;
      });

      this._state.set('loading');
      this.adopt(null);

      this.content.load(caseId, imageId, variant).then(
        (url) => {
          // A component destroyed, or an image switched, mid-flight still owns this object URL.
          if (cancelled) {
            this.content.revoke(url);
            return;
          }
          this.adopt(url);
        },
        () => {
          if (!cancelled) this._state.set('failed');
        },
      );
    });

    // A blob object URL is a document-lifetime root: a leaked one pins the photograph in memory
    // until the tab closes, and an officer working a queue opens dozens of cases.
    inject(DestroyRef).onDestroy(() => this.adopt(null));
  }

  protected onLoad(event: Event): void {
    this._state.set('ready');
    const image = event.target as HTMLImageElement;
    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      this.naturalSize.emit({ width: image.naturalWidth, height: image.naturalHeight });
    }
  }

  /**
   * A blob cannot expire, so an `error` here is a truncated or undecodable body. Fetching again
   * costs one request; after that the region falls back to text.
   */
  protected onError(): void {
    const key = `${this.caseId()}:${this.imageId()}:${this.variant()}`;
    if (this.retriedFor === key) {
      this._state.set('failed');
      return;
    }
    this.retriedFor = key;
    this._attempt.update((attempt) => attempt + 1);
  }

  private adopt(next: string | null): void {
    if (this.objectUrl !== null) this.content.revoke(this.objectUrl);
    this.objectUrl = next;
    this._src.set(next);
  }
}
