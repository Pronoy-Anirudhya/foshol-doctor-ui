import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type { QueueRowView } from '../../../core/stores/queue-store';
import { Icon } from '../../../shared/ui/icon/icon';
import { taskPath } from '../officer-paths';

/**
 * One queue row's three controls: **view**, **approve**, **reject**.
 *
 * This replaced the stretched link that used to cover the whole row. A `::after { inset: 0 }`
 * overlay makes the row one big click target, which is lovely right up to the moment the row
 * needs a second control — at which point the overlay silently eats every one of them. So the
 * row is no longer clickable and the farmer's name is plain text; the affordances are here,
 * where they can be counted, labelled and reached by keyboard.
 *
 * `WEB-UX-013` — icon-only, and therefore every control carries a real accessible name and a
 * `title`; `WEB-UX-044` — the glyphs differ in shape (eye / tick-in-ring / cross-in-ring), not
 * only in colour; `WEB-UX-033` — each is a 44 px target.
 *
 * The confirmation panels live in `queue-action-panel`, rendered by the page in an expansion
 * row beneath the table row (and inside the card below `md`). They are NOT floated out of this
 * component: the table scrolls inside `.table-wrap`'s `overflow-x: auto`, and an absolutely
 * positioned panel inside a scroll container is a panel with its bottom half cut off.
 */
export type QueuePopoverKind = 'approve' | 'reject';

export const POPOVER_APPROVE: QueuePopoverKind = 'approve';
export const POPOVER_REJECT: QueuePopoverKind = 'reject';

const ICON_BUTTON =
  'touch-target inline-flex w-11 items-center justify-center rounded-xl border transition-colors duration-1 ease-settle disabled:cursor-not-allowed disabled:border-surface-3 disabled:bg-surface-2 disabled:text-ink-faint';

@Component({
  selector: 'foshol-queue-row-actions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, RouterLink, TranslatePipe],
  host: { class: 'inline-flex items-center gap-1.5' },
  template: `
    <a
      [routerLink]="link()"
      [class]="viewClass"
      data-testid="queue-action-view"
      [attr.aria-label]="'officer.queue.action.view.aria' | translate: { farmer: farmer() }"
      [title]="'officer.queue.action.view.title' | translate"
    >
      <foshol-icon name="view" size="sm" />
    </a>

    @if (canApprove()) {
      <button
        type="button"
        [class]="approveClass"
        data-testid="queue-action-approve"
        [attr.aria-expanded]="open() === 'approve'"
        [attr.aria-controls]="panelId('approve')"
        [attr.aria-label]="'officer.queue.action.approve.aria' | translate: { farmer: farmer() }"
        [title]="'officer.queue.action.approve.title' | translate"
        [disabled]="busy()"
        (click)="toggle.emit('approve')"
      >
        <foshol-icon name="approve" size="sm" />
      </button>
    }

    @if (canReject()) {
      <button
        type="button"
        [class]="rejectClass"
        data-testid="queue-action-reject"
        [attr.aria-expanded]="open() === 'reject'"
        [attr.aria-controls]="panelId('reject')"
        [attr.aria-label]="'officer.queue.action.reject.aria' | translate: { farmer: farmer() }"
        [title]="'officer.queue.action.reject.title' | translate"
        [disabled]="busy()"
        (click)="toggle.emit('reject')"
      >
        <foshol-icon name="reject" size="sm" />
      </button>
    }

    <!-- WEB-UX-044 — a row the officer cannot action says so in words, rather than just
         offering fewer buttons and leaving them to notice. -->
    @if (!canApprove() && !canReject()) {
      <span class="text-xs text-ink-faint" data-testid="queue-action-locked">
        {{ lockedKey() | translate }}
      </span>
    }
  `,
})
export class QueueRowActions {
  readonly view = input.required<QueueRowView>();
  /** Which of this row's panels is open, or `null`. The page owns "only one at a time". */
  readonly open = input<QueuePopoverKind | null>(null);
  readonly canApprove = input(false);
  readonly canReject = input(false);
  /** An inline write is in flight somewhere; no second one may be started on top of it. */
  readonly busy = input(false);
  /** Why this row offers nothing — a translation key chosen by the page. */
  readonly lockedKey = input('officer.queue.action.locked.decided');
  /** Matches `QueueActionPanel.scope`: the card copy and the table copy of one row differ. */
  readonly scope = input('row');

  readonly toggle = output<QueuePopoverKind>();

  protected readonly viewClass = `${ICON_BUTTON} border-slate-700 bg-slate-800 text-ink-invert hover:bg-slate-900`;
  protected readonly approveClass = `${ICON_BUTTON} border-paddy-600 bg-paddy-600 text-ink-invert hover:bg-paddy-700`;
  protected readonly rejectClass = `${ICON_BUTTON} border-clay-300 bg-clay-100 text-clay-700 hover:bg-clay-300 hover:text-ink`;

  protected readonly link = computed(() => taskPath(this.view().row.reviewTaskId));
  protected readonly farmer = computed(() => this.view().row.farmerName ?? '');
  protected panelId(kind: QueuePopoverKind): string {
    return `queue-panel-${this.scope()}-${this.view().row.reviewTaskId}-${kind}`;
  }
}
