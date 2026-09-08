import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ADMIN_PATHS } from './admin-paths';

/** Which failure a tile counts. The same two values the API filters on — not a UI invention. */
export type BreachKind = 'ASSIGNMENT' | 'RESOLUTION';

/**
 * One district failure total.
 *
 * **This tile is not `StatTile`, and the difference is the point.** `StatTile` renders an absent
 * value as "not enough data yet" because every number on the stats strip is `null` until the
 * server has something to say. Here the two totals are *counts*: the server either answered —
 * in which case `0` means "we counted, and there were none" — or it did not answer at all. Those
 * are different facts, so they get different renderings and different words. A zero is printed
 * as a zero; a missing answer says it is missing. Neither is ever a dash.
 *
 * `WEB-UX-044` — the accent is decoration. The scope, the count and the stale state are all text.
 */
@Component({
  selector: 'foshol-kpi-count-tile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, RouterLink],
  host: { class: 'block' },
  template: `
    <div
      class="card relative isolate flex h-full flex-col gap-1 overflow-hidden border-t-4 p-5 transition-transform duration-2 ease-settle hover:-translate-y-0.5 hover:shadow-lift"
      [class]="accentBorderClass()"
      [attr.data-stale]="stale() || null"
      [attr.data-kind]="kind()"
      data-testid="kpi-tile"
    >
      <svg
        viewBox="0 0 20 20"
        class="pointer-events-none absolute -top-3 -right-3 h-20 w-20 opacity-[0.06]"
        [class]="accentIconClass()"
        aria-hidden="true"
        fill="none"
      >
        @if (kind() === 'ASSIGNMENT') {
          <path
            d="M3 17V8l7-4 7 4v9M3 17h14M3 17v-6h4v6M13 17v-6h4v6M8 10h.01"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        } @else {
          <path
            d="M10 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 8c0-3.3 2.7-6 6-6s6 2.7 6 6"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        }
      </svg>

      <div class="relative flex items-center gap-2">
        <span
          class="grid h-7 w-7 shrink-0 place-items-center rounded-lg"
          [class]="accentBgClass()"
          aria-hidden="true"
        >
          <svg viewBox="0 0 20 20" class="h-4 w-4" [class]="accentIconClass()" fill="none">
            @if (kind() === 'ASSIGNMENT') {
              <path
                d="M3 17V8l7-4 7 4v9M3 17h14M3 17v-6h4v6M13 17v-6h4v6M8 10h.01"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            } @else {
              <path
                d="M10 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 8c0-3.3 2.7-6 6-6s6 2.7 6 6"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            }
          </svg>
        </span>
        <p class="flex-1 text-xs font-semibold tracking-wide text-ink-faint uppercase">
          {{ labelKey() | translate }}
        </p>
        @if (stale()) {
          <span
            class="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-ink-muted"
            data-testid="kpi-tile-stale-marker"
            >{{ 'admin.stats.stale.marker' | translate }}</span
          >
        }
      </div>

      <!-- The attribution label travels with the number, always. A count with no scope beside
           it is the one thing this dashboard must never put on screen. -->
      <p class="text-xs font-semibold" [class]="scopeClass()" data-testid="kpi-tile-scope">
        {{ scopeKey() | translate }}
      </p>

      @if (count() !== null) {
        <!-- A counted zero prints as a zero. It is an answer, not a blank. -->
        <p
          class="mt-1 text-4xl leading-none font-bold text-ink tabular-nums"
          data-testid="kpi-count"
        >
          {{ count() }}
        </p>
      } @else {
        <p class="mt-2 text-lg leading-tight font-semibold text-ink-muted" data-testid="kpi-no-data">
          {{ 'admin.kpi.tile.notLoaded' | translate }}
        </p>
      }

      @if (count() !== null) {
        <p class="mt-1.5 text-xs text-ink-faint" data-testid="kpi-tile-counted">
          {{ 'admin.kpi.tile.counted' | translate }}
        </p>
      }

      <p class="mt-3 max-w-prose text-sm text-ink-muted">{{ hintKey() | translate }}</p>

      <a
        class="touch-target mt-auto inline-flex items-center pt-2 text-sm font-semibold text-ink-muted underline underline-offset-2 hover:text-ink"
        [routerLink]="breachesPath"
        [queryParams]="{ kind: kind() }"
        data-testid="kpi-tile-drilldown"
      >
        {{ 'admin.kpi.tile.drillDown' | translate }}
      </a>
    </div>
  `,
})
export class KpiCountTile {
  readonly labelKey = input.required<string>();
  /** Names WHO the number belongs to — a district, or the officers listed below it. */
  readonly scopeKey = input.required<string>();
  readonly hintKey = input('');
  /** `null` only when nothing has loaded. A server-counted zero is `0`, and prints as `0`. */
  readonly count = input<number | null>(null);
  readonly kind = input.required<BreachKind>();
  /** `WEB-FR-305` — the count is the last that loaded, not the current one. */
  readonly stale = input(false);

  protected readonly breachesPath = ADMIN_PATHS.breaches;

  /** Dawn for the pool failure, clay for the claimed one — a grouping, never the meaning. */
  protected readonly accentBorderClass = computed(() =>
    this.kind() === 'ASSIGNMENT' ? 'border-t-dawn-600' : 'border-t-clay-600',
  );

  protected readonly scopeClass = computed(() =>
    this.kind() === 'ASSIGNMENT' ? 'text-dawn-700' : 'text-clay-700',
  );

  protected readonly accentBgClass = computed(() =>
    this.kind() === 'ASSIGNMENT' ? 'bg-dawn-100' : 'bg-clay-100',
  );

  protected readonly accentIconClass = computed(() =>
    this.kind() === 'ASSIGNMENT' ? 'text-dawn-700' : 'text-clay-700',
  );
}
