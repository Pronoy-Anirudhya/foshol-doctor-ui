import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { APP_CONFIG } from '../../../core/config/app-config';
import type { DraftImage } from '../../../core/stores/case-draft-store';
import { Spinner } from '../../../shared/ui/spinner/spinner';

/**
 * The chosen photographs, as a horizontal strip within thumb reach at 360 px.
 *
 * WEB-FR-111 — a tile appears the instant a file is chosen, showing the `URL.createObjectURL`
 * preview while the local gate runs. Nothing here waits on a network call, because at this
 * point in the flow there has been none.
 * WEB-FR-115 — removal AND reordering before submission. Order matters to a reviewing officer,
 * who reads image 1 first; a farmer who photographed the whole plant last should be able to put
 * it first without retaking everything.
 * WEB-UX-040 — reordering is two ordinary buttons, not a drag handle. Drag-and-drop is
 * unreachable by keyboard, fiddly on a phone and impossible with wet hands.
 */
export interface StripTile {
  readonly id: string;
  readonly previewUrl: string;
  /** False while the local quality gate is still running on this pick. */
  readonly ready: boolean;
  /**
   * WEB-FR-150 — a `422` rejected this position. `serverMessage` is the server's own Bangla,
   * rendered verbatim and never translated (`WEB-UX-016`); `serverReasonKey` is the fallback
   * for the live server's `message`/`messageBn` divergence, which carries a reason code but no
   * Bangla sentence per image.
   */
  readonly serverMessage: string | null;
  readonly serverReasonKey: string | null;
}

const ONE = 1;
const FIRST = 0;

@Component({
  selector: 'foshol-image-strip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Spinner, TranslatePipe],
  host: { class: 'block' },
  template: `
    <ol
      class="flex snap-x gap-3 overflow-x-auto pb-2"
      [attr.aria-label]="'farmer.capture.images.stripLabel' | translate"
    >
      @for (tile of tiles(); track tile.id; let index = $index; let count = $count) {
        <li class="strip-item snap-start" data-testid="strip-item">
          <div
            class="strip-frame"
            [attr.data-rejected]="tile.serverMessage || tile.serverReasonKey ? true : null"
          >
            <img
              class="strip-preview"
              [src]="tile.previewUrl"
              [alt]="
                'farmer.capture.images.previewAlt'
                  | translate: { position: index + one, total: count }
              "
            />
            @if (!tile.ready) {
              <span class="strip-veil">
                <foshol-spinner size="sm" labelKey="farmer.capture.images.checking" />
              </span>
            }
            <span class="strip-index" aria-hidden="true">{{ index + one }}</span>
          </div>

          @if (tile.serverMessage) {
            <p class="strip-server" data-testid="strip-server-reject">{{ tile.serverMessage }}</p>
          } @else if (tile.serverReasonKey; as reasonKey) {
            <p class="strip-server" data-testid="strip-server-reject">
              {{ reasonKey | translate }}
            </p>
          }

          <div class="strip-actions">
            <button
              type="button"
              class="strip-button touch-target"
              data-testid="strip-move-back"
              [disabled]="index === first"
              [attr.aria-label]="
                'farmer.capture.images.moveEarlier' | translate: { position: index + one }
              "
              (click)="moved.emit({ id: tile.id, delta: -one })"
            >
              <span aria-hidden="true">←</span>
            </button>
            <button
              type="button"
              class="strip-button touch-target"
              data-testid="strip-remove"
              [attr.aria-label]="
                'farmer.capture.images.remove' | translate: { position: index + one }
              "
              (click)="removed.emit(tile.id)"
            >
              <span aria-hidden="true">✕</span>
            </button>
            <button
              type="button"
              class="strip-button touch-target"
              data-testid="strip-move-forward"
              [disabled]="index === count - one"
              [attr.aria-label]="
                'farmer.capture.images.moveLater' | translate: { position: index + one }
              "
              (click)="moved.emit({ id: tile.id, delta: one })"
            >
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </li>
      }
    </ol>

    <p class="mt-1 text-sm text-ink-muted" data-testid="strip-count">
      {{ 'farmer.capture.images.count' | translate: { chosen: tiles().length, max: maxImages } }}
    </p>
  `,
  styles: `
    .strip-item {
      flex: none;
      inline-size: 8.5rem;
    }

    .strip-frame {
      position: relative;
      inline-size: 100%;
      aspect-ratio: 1;
      overflow: hidden;
      border: 1px solid var(--color-surface-3);
      border-radius: 1rem;
      background: var(--color-surface-2);
      box-shadow: var(--shadow-card);
    }

    .strip-frame[data-rejected] {
      border-color: var(--color-clay-600);
      border-width: 2px;
    }

    .strip-preview {
      inline-size: 100%;
      block-size: 100%;
      object-fit: cover;
    }

    .strip-veil {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: color-mix(in srgb, var(--color-surface-0) 72%, transparent);
    }

    .strip-index {
      position: absolute;
      inset-block-end: 0.35rem;
      inset-inline-start: 0.35rem;
      min-inline-size: 1.5rem;
      padding-inline: 0.4rem;
      border-radius: 999px;
      background: var(--color-paddy-600);
      color: var(--color-ink-invert);
      font-size: 0.8125rem;
      font-weight: 700;
      text-align: center;
    }

    .strip-server {
      margin-block-start: 0.4rem;
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--color-clay-700);
    }

    .strip-actions {
      display: flex;
      justify-content: space-between;
      gap: 0.25rem;
      margin-block-start: 0.4rem;
    }

    .strip-button {
      flex: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--color-surface-3);
      border-radius: 0.7rem;
      background: var(--color-surface-0);
      color: var(--color-ink);
      font-weight: 700;
      transition: border-color var(--duration-1) var(--ease-settle);
    }

    .strip-button:hover:not(:disabled) {
      border-color: var(--color-paddy-600);
    }

    .strip-button:disabled {
      color: var(--color-ink-faint);
      cursor: not-allowed;
    }
  `,
})
export class ImageStrip {
  readonly tiles = input<readonly StripTile[]>([]);

  readonly removed = output<string>();
  readonly moved = output<{ id: string; delta: number }>();

  protected readonly one = ONE;
  protected readonly first = FIRST;
  protected readonly maxImages = APP_CONFIG.intake.maxImages;
}

/** One server rejection, already reduced from the `422` body (`LIVE-API-NOTES` §4). */
export interface ServerImageRejection {
  readonly message: string | null;
  readonly reasonKey: string | null;
}

/** The accepted images, as the strip wants them. Kept here so the page stays about flow. */
export function tilesOf(
  images: readonly DraftImage[],
  rejections: ReadonlyMap<number, ServerImageRejection>,
): readonly StripTile[] {
  return images.map((image, index) => {
    const rejection = rejections.get(index);
    return {
      id: image.id,
      previewUrl: image.previewUrl,
      ready: true,
      serverMessage: rejection?.message ?? null,
      serverReasonKey: rejection?.reasonKey ?? null,
    };
  });
}
