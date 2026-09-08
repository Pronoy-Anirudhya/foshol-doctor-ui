import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { SessionStore } from '../../../core/auth/session-store';
import { LanguageStore } from '../../../core/i18n/language-store';
import { Icon } from '../icon/icon';

/**
 * Where the signed-in person's work is filed — read-only, always, everywhere.
 *
 * Region is an **identity attribute**. The server reads the farmer's division and district from
 * their identity, snapshots them onto the case at submit, and scopes every officer and admin
 * read to their own district. So this chip renders what `/me` said and offers no control: there
 * is no picker, the codes never reach a request body, and a client that could change its own
 * region would be claiming a case belongs somewhere the server says it does not.
 *
 * **The labels are the server's.** `nameBn` / `nameEn` come from the same catalogue the backend
 * routes on, so a district is spelled here exactly as it is spelled there. This application
 * carries no district list of its own — inventing one would put 64 names in the client that
 * could drift from the 64 the server actually uses. When a name is null the code is shown
 * instead, which is ugly but true.
 *
 * **District first, division only when it adds something.** For Dhaka the district and the
 * division are both "ঢাকা", and for Chattogram both are "চট্টগ্রাম" — printing the same word
 * twice with a separator looks like a rendering bug rather than a hierarchy. So the division is
 * appended only when its label actually differs.
 */
@Component({
  selector: 'foshol-region-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, TranslatePipe],
  // No display utility on the host on purpose. `hidden` and `inline-flex` are the same
  // specificity, so a host class would fight any responsive display class a caller passes and
  // the winner would be decided by Tailwind's output order rather than by the caller. The inner
  // span carries the layout; call sites say where and at which breakpoints the chip appears.
  template: `
    @if (districtLabel(); as district) {
      <span
        class="inline-flex items-center gap-1.5 rounded-pill px-2.5 py-0.5 text-xs font-semibold"
        [class]="toneClass()"
        data-testid="region-chip"
        [attr.data-district]="region()?.districtCode"
      >
        <foshol-icon name="pin" size="xs" />
        <!-- The label is server content, rendered verbatim: never translated, never invented. -->
        <span data-testid="region-district">{{ district }}</span>
        @if (divisionLabel(); as division) {
          <span aria-hidden="true" [class]="separatorClass()">·</span>
          <span data-testid="region-division">{{ division }}</span>
        }
        <span class="sr-only">{{ 'shared.region.aria' | translate }}</span>
      </span>
    }
  `,
})
export class RegionChip {
  private readonly session = inject(SessionStore);
  private readonly language = inject(LanguageStore);

  /** Slate chrome carries the console tone; the farmer's warm surfaces take the light one. */
  readonly tone = input<'light' | 'dark'>('light');

  protected readonly region = this.session.region;

  protected readonly districtLabel = computed(() => {
    const region = this.region();
    if (region === null) return '';
    return this.#label(region.districtNameBn, region.districtNameEn, region.districtCode);
  });

  /**
   * Empty when the division would only repeat the district. Comparison is on the rendered
   * label rather than the codes, because the codes are NOT globally unique across the two
   * catalogues — Chattogram is `CTG` as a division and `CTG` as a district, while Dhaka is
   * `DHK` and `DHA`. Comparing codes would collapse one and not the other.
   */
  protected readonly divisionLabel = computed(() => {
    const region = this.region();
    if (region === null) return '';
    const division = this.#label(region.divisionNameBn, region.divisionNameEn, region.divisionCode);
    return division === this.districtLabel() ? '' : division;
  });

  protected readonly toneClass = computed(() =>
    this.tone() === 'dark' ? 'bg-slate-900/70 text-slate-200' : 'bg-surface-2 text-ink-muted',
  );

  protected readonly separatorClass = computed(() =>
    this.tone() === 'dark' ? 'text-slate-500' : 'text-ink-faint',
  );

  /** The active language first, then the other one, then the code. Never a made-up name. */
  #label(bn: string | null, en: string | null, code: string | null): string {
    const preferred = this.language.isBangla() ? bn : en;
    return preferred ?? bn ?? en ?? code ?? '';
  }
}
