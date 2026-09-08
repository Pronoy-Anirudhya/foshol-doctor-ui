import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/** Which glyph and accent colour a tile carries — a purely visual grouping, not a server value. */
export type StatTileKind = 'volume' | 'rate' | 'time' | 'agreement';

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
      class="card flex h-full flex-col gap-1 border-t-4 p-5"
      [class]="accentBorderClass()"
      [attr.data-stale]="stale() || null"
      data-testid="stat-tile"
    >
      <div class="flex items-start justify-between gap-3">
        <div class="flex items-center gap-2">
          <span
            class="grid h-7 w-7 shrink-0 place-items-center rounded-lg"
            [class]="accentBgClass()"
            aria-hidden="true"
          >
            <svg viewBox="0 0 20 20" class="h-4 w-4" [class]="accentIconClass()" fill="none">
              @switch (kind()) {
                @case ('rate') {
                  <path
                    d="M6 14 14 6M7.5 8a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm5 5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                }
                @case ('time') {
                  <circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.5" />
                  <path
                    d="M10 6v4l2.6 2.6"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                }
                @case ('agreement') {
                  <circle cx="7.5" cy="10" r="5" stroke="currentColor" stroke-width="1.5" />
                  <circle cx="12.5" cy="10" r="5" stroke="currentColor" stroke-width="1.5" />
                }
                @default {
                  <path
                    d="M4 16V9M10 16V4M16 16v-6"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                }
              }
            </svg>
          </span>
          <p class="text-xs font-semibold tracking-wide text-ink-faint uppercase">
            {{ labelKey() | translate }}
          </p>
        </div>
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
  /** Purely a glyph + accent-colour grouping (`WEB-UX-044` is unaffected: the label is text). */
  readonly kind = input<StatTileKind>('volume');

  protected readonly accentBorderClass = computed(() => ACCENT_BORDER[this.kind()]);
  protected readonly accentBgClass = computed(() => ACCENT_BG[this.kind()]);
  protected readonly accentIconClass = computed(() => ACCENT_ICON[this.kind()]);
}

const ACCENT_BORDER: Record<StatTileKind, string> = {
  volume: 'border-t-slate-600',
  rate: 'border-t-paddy-600',
  time: 'border-t-dawn-600',
  agreement: 'border-t-slate-800',
};

const ACCENT_BG: Record<StatTileKind, string> = {
  volume: 'bg-surface-2',
  rate: 'bg-paddy-100',
  time: 'bg-dawn-100',
  agreement: 'bg-surface-2',
};

const ACCENT_ICON: Record<StatTileKind, string> = {
  volume: 'text-slate-600',
  rate: 'text-paddy-700',
  time: 'text-dawn-700',
  agreement: 'text-slate-800',
};
