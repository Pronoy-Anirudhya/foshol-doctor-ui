import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  resource,
  signal,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import {
  imageRef,
  SecureMediaService,
  type ImageRef,
} from '../../../core/media/secure-media.service';
import {
  IMAGE_VARIANT_DERIVATIVE,
  type ImageVariant,
} from '../../../core/media/out-of-contract/media-url.service';
import { Icon } from '../icon/icon';

/**
 * A case photograph, loaded the only way `WEB-FR-154` permits: through the presigned URL the API
 * returned. The component never sees, builds or logs an object-store path — it asks
 * `SecureMediaService` for a URL and binds it.
 *
 * WEB-UX-042 — `alt` is a REQUIRED input. Making the alternative text mandatory in the type
 * system is the difference between an accessibility rule that is enforced and one that is
 * hoped for: a caller that forgets it does not ship a silent regression, it fails
 * `strictTemplates`. There is deliberately no "decorative" escape hatch; a case photograph is
 * never decorative.
 *
 * WEB-FR-400 — a skeleton occupies the region from the first frame, so there is never a blank
 * box and never a layout shift when the image lands. It is drawn unconditionally rather than
 * after `ui.spinnerDelayMs`, because a placeholder that is already the right SIZE cannot flash:
 * the image simply fades in on top of it.
 *
 * WEB-SEC-003 — the `<img>` carries no `crossorigin` attribute on purpose. That keeps the load
 * a plain no-CORS subresource request: no preflight, no CORS configuration needed on MinIO, and
 * no header of ours travelling to the object store.
 */

type LoadState = 'loading' | 'ready' | 'failed';

@Component({
  selector: 'foshol-secure-image',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, TranslatePipe],
  templateUrl: './secure-image.html',
  styleUrl: './secure-image.css',
  host: {
    '[attr.data-state]': 'state()',
  },
})
export class SecureImage {
  private readonly media = inject(SecureMediaService);

  readonly caseId = input.required<string>();
  readonly imageId = input.required<string>();
  readonly variant = input<ImageVariant>(IMAGE_VARIANT_DERIVATIVE);

  /** WEB-UX-042 — required, and required on purpose. See the class comment. */
  readonly alt = input.required<string>();

  /** `cover` crops to fill a fixed tile; `contain` fits the whole frame inside it. */
  readonly fit = input<'cover' | 'contain'>('cover');

  protected readonly ref = computed<ImageRef>(() =>
    imageRef(this.caseId(), this.imageId(), this.variant()),
  );

  private readonly presigned = resource({
    params: () => this.ref(),
    loader: ({ params }) => this.media.resolve(params),
  });

  /**
   * What is actually bound to `<img [src]>`.
   *
   * It is a writable `linkedSignal` rather than `presigned.value()` read directly, because the
   * retry below has to be able to blank it for a tick. A refreshed presign minted in the same
   * wall-clock second is byte-identical to the one that just failed (the AWS SigV4 signature
   * covers `X-Amz-Date`, which has second granularity), and rebinding an identical `src` makes
   * no request at all. Clearing first guarantees the browser genuinely tries again.
   */
  private readonly _src = linkedSignal<string | null, string | null>({
    // `value()` RETHROWS while the resource is in an error state, so it is guarded rather than
    // read directly — a failed presign must reach `state()`, not escape as an exception.
    source: () => (this.presigned.hasValue() ? this.presigned.value() : null),
    computation: (url) => url,
  });

  private readonly _loaded = linkedSignal<string | null, boolean>({
    source: this._src,
    computation: () => false,
  });

  /** One forced re-presign per set of inputs, then the text placeholder. Never a retry loop. */
  private readonly _retried = linkedSignal<ImageRef, boolean>({
    source: this.ref,
    computation: () => false,
  });

  private readonly _failed = signal(false);

  protected readonly src = this._src.asReadonly();

  protected readonly state = computed<LoadState>(() => {
    if (this._failed() || this.presigned.error() !== undefined) return 'failed';
    return this._loaded() ? 'ready' : 'loading';
  });

  protected onLoad(): void {
    this._loaded.set(true);
  }

  /**
   * An `<img>` reports `error` with no status, so an expired signature, a clock skew and a
   * transient network blip are indistinguishable here. Re-presigning covers the first two and
   * costs one request; after that the region falls back to text, never to the browser's broken
   * image glyph.
   */
  protected async onError(): Promise<void> {
    if (this._retried()) {
      this._failed.set(true);
      return;
    }
    this._retried.set(true);
    this._src.set(null);

    try {
      this._src.set(await this.media.refresh(this.ref()));
    } catch {
      this._failed.set(true);
    }
  }
}
