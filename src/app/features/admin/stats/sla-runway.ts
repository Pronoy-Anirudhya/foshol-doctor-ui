import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslatePipe, translate } from '@ngx-translate/core';
import { formatDhakaDateTime } from '../../../core/time/dhaka-time';
import { toPercentString } from '../../../core/util/percent';
import { DhakaDateTimePipe } from '../../../shared/pipes/dhaka-date-time.pipe';
import type { SlaRunwayView } from '../queue-insight.adapter';

/**
 * How much runway the loaded review tasks have left against their own `slaDueAt`.
 *
 * **"Now" is sampled once, at load, and stated.** `WEB-FR-356` forbids polling and the
 * architecture lint forbids `setInterval` outright, so this meter does not tick: it says
 * "as of {time}" and means it. A segmented meter that silently reclassified a case from
 * "due soon" to "overdue" while nobody was looking would also make the timestamp beside it a
 * lie, which is the same reason the stats page has no auto-refresh.
 *
 * The four bands are ordinal and their colours are close in lightness by construction (a
 * warning and a danger fill sit within 1.5:1 of each other in this palette), so colour is
 * carried by NOTHING here on its own: every band has a glyph, a label, a count and a share,
 * all as text, and the overdue band additionally carries a hatch.
 */

type BandKey = 'overdue' | 'dueSoon' | 'onTime' | 'unknown';

interface Band {
  readonly key: BandKey;
  readonly count: number;
  readonly width: string;
  readonly share: string;
}

const BAND_ORDER: readonly BandKey[] = ['overdue', 'dueSoon', 'onTime', 'unknown'];

@Component({
  selector: 'foshol-sla-runway',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, DhakaDateTimePipe],
  templateUrl: './sla-runway.html',
  styleUrl: './sla-runway.css',
  host: { class: 'block', 'data-testid': 'sla-runway' },
})
export class SlaRunway {
  /** `null` while the queue sample has never loaded. */
  readonly sla = input<SlaRunwayView | null>(null);

  protected readonly total = computed(() => {
    const view = this.sla();
    return view === null ? 0 : view.overdue + view.dueSoon + view.onTime + view.unknown;
  });

  protected readonly hasRows = computed(() => this.total() > 0);

  protected readonly asOf = computed(() => {
    const ms = this.sla()?.asOfMs ?? null;
    return ms === null ? null : new Date(ms);
  });

  protected readonly bands = computed<readonly Band[]>(() => {
    const view = this.sla();
    const total = this.total();
    if (view === null || total === 0) return [];
    const counts: Record<BandKey, number> = {
      overdue: view.overdue,
      dueSoon: view.dueSoon,
      onTime: view.onTime,
      unknown: view.unknown,
    };
    return BAND_ORDER.map((key) => ({
      key,
      count: counts[key],
      width: toPercentString(counts[key] / total),
      share: toPercentString(counts[key] / total),
    }));
  });

  private readonly ariaText = translate('admin.sla.aria', () => {
    const view = this.sla();
    return {
      overdue: view?.overdue ?? 0,
      dueSoon: view?.dueSoon ?? 0,
      onTime: view?.onTime ?? 0,
      asOf: formatDhakaDateTime(this.asOf()),
    };
  });

  protected readonly ariaLabel = computed(() => String(this.ariaText()));
}
