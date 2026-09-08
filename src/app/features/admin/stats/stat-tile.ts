import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * One number on the stats page (`WEB-FR-301`).
 *
 * The tile exists mainly to make ONE decision in one place: **an absent value is rendered as
 * "not enough data yet", never as `0`.** `approvalRate`, `medianReviewMinutes` and
 * `agreementRate` are all `null` on this endpoint until there is data
 * (`LIVE-API-NOTES.md` Divergence 2), and a zero in a tile is not a neutral placeholder — it
 * reads as "we measured, and the answer is none", which is a lie about the system
 * (`WEB-NFR-001`).
 *
 * The value arrives already formatted, because the units differ per tile (a count, a
 * percentage, minutes) and formatting is the page's business, not the tile's.
 *
 * `WEB-UX-044` — the stale state is a text marker, not a colour change.
 */
@Component({
  selector: 'foshol-stat-tile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  host: { class: 'block' },
  template: `
    <div
      class="card flex h-full flex-col gap-1 p-5"
      [attr.data-stale]="stale() || null"
      data-testid="stat-tile"
    >
      <div class="flex items-start justify-between gap-3">
        <p class="text-xs font-semibold tracking-wide text-ink-faint uppercase">
          {{ labelKey() | translate }}
        </p>
        @if (stale()) {
          <span
            class="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-ink-muted"
            data-testid="tile-stale-marker"
            >{{ 'admin.stats.stale.marker' | translate }}</span
          >
        }
      </div>

      @if (value(); as shown) {
        <p
          class="mt-1 text-4xl leading-none font-bold text-ink tabular-nums"
          data-testid="stat-value"
        >
          {{ shown }}
        </p>
      } @else {
        <!-- The honest empty answer. Never a zero. -->
        <p
          class="mt-2 text-lg leading-tight font-semibold text-ink-muted"
          data-testid="stat-no-data"
        >
          {{ 'admin.stats.noData' | translate }}
        </p>
      }

      @if (captionKey()) {
        <p class="mt-1.5 text-xs text-ink-faint" data-testid="stat-caption">
          {{ captionKey() | translate: captionParams() }}
        </p>
      }

      @if (hintKey()) {
        <p class="mt-auto pt-3 text-sm text-ink-muted">{{ hintKey() | translate }}</p>
      }
    </div>
  `,
})
export class StatTile {
  readonly labelKey = input.required<string>();
  /** Formatted for display, or `null` when the server has nothing to report yet. */
  readonly value = input<string | null>(null);
  /** Qualifies the number — the evidence it rests on, where that matters. */
  readonly captionKey = input('');
  readonly captionParams = input<Record<string, unknown>>({});
  readonly hintKey = input('');
  /** WEB-FR-305 — the value is the last one that loaded, not the current one. */
  readonly stale = input(false);
}
