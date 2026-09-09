import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { APP_CONFIG } from '../../core/config/app-config';
import { toProblemView } from '../../core/errors/problem';
import { LanguageStore } from '../../core/i18n/language-store';
import type { FarmerRecord } from '../../generated/models/farmer-record';
import { FarmersService } from '../../generated/services/farmers.service';
import { DhakaDateTimePipe } from '../../shared/pipes/dhaka-date-time.pipe';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { ErrorPanel } from '../../shared/ui/error-panel/error-panel';
import { Icon } from '../../shared/ui/icon/icon';
import { Paginator } from '../../shared/ui/paginator/paginator';
import { FarmerDirectoryStore } from './farmer-directory-store';

const NONE = 0;

/**
 * The district's farmers (`WEB-FR-312`), as `GET /api/v1/farmers` returns them.
 *
 * **No phone number is displayed, because none is available to display.** `FarmerRecord` has no
 * phone field at all — the contract removed the possibility rather than trusting the UI to
 * resist it. The one phone on this screen is the lookup box, which an officer types into and
 * which is sent as a request parameter, never rendered back.
 *
 * **Search by name and search by phone clear each other**, in the store and therefore visibly
 * here. Sending both earns a `400 ERR_BAD_REQUEST`, so the two boxes are built as one choice
 * with two shapes rather than as two independent filters.
 *
 * **Rows appear in the server's order and are never re-sorted** (`WEB-NFR-001`). The contract
 * offers no sort parameter, so the screen offers no sort control — a client-side sort would
 * only reorder the twenty rows in hand while claiming to have ordered the district.
 */
@Component({
  selector: 'foshol-farmer-directory-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, DhakaDateTimePipe, EmptyState, ErrorPanel, Icon, Paginator],
  templateUrl: './farmer-directory-section.html',
  host: { class: 'block' },
})
export class FarmerDirectorySection {
  private readonly farmers = inject(FarmersService);
  private readonly language = inject(LanguageStore);
  protected readonly store = inject(FarmerDirectoryStore);

  protected readonly NONE = NONE;

  /** What is in the two boxes right now — committed to the store only on search. */
  protected readonly nameDraft = signal('');
  protected readonly phoneDraft = signal('');

  protected readonly problem = computed(() => {
    const error = this.store.error();
    return error === null ? null : toProblemView(error);
  });

  /** Told apart on purpose: "nothing here yet" and "nothing MATCHED" are different answers. */
  protected readonly emptyTitleKey = computed(() =>
    this.store.searchActive() ? 'farmers.directory.noMatches.title' : 'farmers.directory.empty.title',
  );
  protected readonly emptyDetailKey = computed(() =>
    this.store.searchActive() ? 'farmers.directory.noMatches.detail' : 'farmers.directory.empty.detail',
  );

  constructor() {
    // The ONLY place a list request starts. Every control writes the store; this reacts.
    // No timer anywhere — refreshing is a button (WEB-FR-356).
    effect(() => {
      const filters = this.store.filters();
      void this.store.load(() =>
        this.farmers.listFarmers({
          // `?? undefined` matters: the store's `null` means "not filtering", and a literal
          // `null` in the params would be serialised as a value.
          q: filters.q ?? undefined,
          phone: filters.phone ?? undefined,
          page: filters.page,
          size: APP_CONFIG.page.defaultSize,
        }),
      );
    });
  }

  /** Re-runs the current filters. `goToPage` on the same page would not re-fire the effect. */
  protected refresh(): void {
    const filters = this.store.filters();
    void this.store.load(() =>
      this.farmers.listFarmers({
        q: filters.q ?? undefined,
        phone: filters.phone ?? undefined,
        page: filters.page,
        size: APP_CONFIG.page.defaultSize,
      }),
    );
  }

  /**
   * The two boxes clear each other AS YOU TYPE, not merely when a search is committed.
   *
   * That is what lets a single button be unambiguous: at most one box ever holds text, so
   * "search" never has to guess which of two filled fields the officer meant. It also makes
   * the contract's `q`-XOR-`phone` rule visible while typing rather than surprising on submit.
   */
  protected onNameInput(event: Event): void {
    this.nameDraft.set((event.target as HTMLInputElement).value);
    this.phoneDraft.set('');
  }

  protected onPhoneInput(event: Event): void {
    this.phoneDraft.set((event.target as HTMLInputElement).value);
    this.nameDraft.set('');
  }

  /**
   * The one search control, reached by the button or by Enter in either box.
   *
   * A phone in hand wins, because it is the exact lookup; otherwise the name is searched. With
   * both boxes empty this commits an empty query, which the store normalises to "no filter" —
   * so pressing search on a cleared form returns the full list rather than doing nothing.
   */
  protected search(): void {
    const phone = this.phoneDraft().trim();
    if (phone.length > NONE) {
      this.store.setPhoneLookup(phone);
      return;
    }
    this.store.setQuery(this.nameDraft());
  }

  protected clearSearch(): void {
    this.nameDraft.set('');
    this.phoneDraft.set('');
    this.store.clearSearch();
  }

  protected goToPage(page: number): void {
    this.store.goToPage(page);
  }

  /**
   * District and division names are nullable on the contract, so the fallback chain ends at the
   * CODE — which is always true — rather than at an invented label. This application carries no
   * district list of its own.
   */
  protected districtLabel(row: FarmerRecord): string {
    const name = this.language.isBangla() ? row.districtNameBn : row.districtNameEn;
    return name ?? row.districtCode;
  }

  protected divisionLabel(row: FarmerRecord): string {
    const name = this.language.isBangla() ? row.divisionNameBn : row.divisionNameEn;
    return name ?? row.divisionCode;
  }
}
