import { ChangeDetectionStrategy, Component, computed, inject, input, model } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ErrorPanel } from '../../shared/ui/error-panel/error-panel';
import { OfficerFacade } from './officer-facade';

/**
 * Who a claim may be handed to — the one control both the single and the bulk transfer use.
 *
 * **`WEB-NFR-001` — this list is not filtered here.** `GET /api/v1/review/officers`
 * (`REVIEW-FR-097`) already returns exactly the active `OFFICER`s in the caller's district with
 * the caller removed, and eligibility is the server's rule. Re-checking it in the browser would
 * be a second, lagging copy of that rule; a target the server refuses comes back as
 * `ERR_TRANSFER_TARGET_INVALID` and is said in those words instead.
 *
 * An empty list is a real, useful answer — a single-officer district — so it is stated rather
 * than rendered as a select with nothing in it.
 */
const EMPTY = 0;

@Component({
  selector: 'foshol-colleague-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ErrorPanel, TranslatePipe],
  host: { class: 'block' },
  template: `
    <label class="block text-sm font-bold text-ink" [attr.for]="selectId()">
      {{ 'officer.transfer.target' | translate }}
    </label>

    @if (facade.colleaguesLoading()) {
      <p class="mt-1.5 text-sm text-ink-muted" data-testid="colleague-loading">
        {{ 'officer.transfer.loading' | translate }}
      </p>
    } @else if (facade.colleaguesProblem(); as problem) {
      <foshol-error-panel class="mt-2 block" [problem]="problem" (retry)="reload()" />
    } @else if (colleagues().length === EMPTY) {
      <p class="mt-1.5 text-sm text-ink-muted" data-testid="colleague-empty">
        {{ 'officer.transfer.none' | translate }}
      </p>
    } @else {
      <select
        [attr.id]="selectId()"
        class="touch-target mt-1.5 w-full rounded-xl border border-surface-3 bg-surface-0 px-3 text-sm text-ink disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-muted"
        data-testid="colleague-select"
        [disabled]="disabled()"
        (change)="onPick($event)"
      >
        <option value="">{{ 'officer.transfer.targetPlaceholder' | translate }}</option>
        @for (officer of colleagues(); track officer.officerId) {
          <option [value]="officer.officerId" [selected]="officer.officerId === target()">
            {{ officer.name }}
          </option>
        }
      </select>
    }
  `,
})
export class ColleaguePicker {
  /** Several pickers can be on one page at once; duplicate `id`s would break every label. */
  readonly idPrefix = input.required<string>();
  readonly target = model<string | null>(null);
  readonly disabled = input(false);

  protected readonly facade = inject(OfficerFacade);
  protected readonly colleagues = this.facade.colleagues;
  protected readonly EMPTY = EMPTY;

  protected readonly selectId = computed(() => `${this.idPrefix()}-target`);

  constructor() {
    // Mounted only when a transfer panel is opened, so this read costs nothing until an
    // officer asks the question it answers.
    void this.facade.loadColleagues();
  }

  protected reload(): void {
    void this.facade.loadColleagues(true);
  }

  protected onPick(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.target.set(value === '' ? null : value);
  }
}
