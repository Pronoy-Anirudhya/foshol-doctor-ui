import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { ComputedDose } from '../../../generated/models/computed-dose';
import type { Remedy } from '../../../generated/models/remedy';
import { RemedyTypeIcon } from '../../../shared/ui/pictogram/remedy-type-icon';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { remedyId } from '../review-task.adapter';
import { LanguageStore } from '../../../core/i18n/language-store';
import { pickRemedyContent, type RemedyContentView } from '../../../shared/pipes/content-locale';
import { BnMarker } from '../../../shared/ui/bn-value/bn-marker';

/**
 * `WEB-FR-231` — the remedy editor, pre-filled with the active remedies of the selected
 * disease **as the API returned them**, letting the officer add and remove remedies and add a
 * note. `WEB-FR-232` refills it when the officer replaces the disease.
 *
 * **`COMMON-CON-003` — nothing in this component authors agricultural content.** Every step,
 * dosage, pre-harvest interval and source line is human-written, arrives from the knowledge
 * module, and is rendered verbatim as text (`WEB-SEC-005`). The initial value is always the
 * API's. A wrong dosage is not a bug, it is harm, so this editor never invents one and never
 * offers a default.
 *
 * **Step text is shown, not edited, and that is a deliberate limit.** The publish contract
 * (`PublishAdvisoryRequest`) carries `remedyIds` and `officerNoteBn` — there is no field on
 * any endpoint that could carry rewritten step text. Offering an editable step box would let
 * an officer type a corrected dosage that the server would silently discard, which is strictly
 * worse than not offering it. So the officer selects which human-written remedies go out and
 * says what they would change in the note, and the note travels with the advisory. Recorded as
 * an amendment request against `WEB-FR-231`.
 *
 * `WEB-FR-242` / `WEB-FR-243` — `disabled` withdraws submission, never content. The editor
 * stays populated and readable while a claim is expired or held by somebody else, because
 * discarding an officer's typing on a background timer is the worst possible response to it.
 */
const EMPTY_DOSES: ReadonlyMap<string, ComputedDose> = new Map();

@Component({
  selector: 'foshol-remedy-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RemedyTypeIcon, Skeleton, TranslatePipe, BnMarker],
  templateUrl: './remedy-editor.html',
  styleUrl: './remedy-editor.css',
  host: { class: 'block' },
})
export class RemedyEditor {
  private readonly language = inject(LanguageStore);

  readonly remedies = input.required<readonly Remedy[]>();

  /** Both locales ride on each remedy, so the toggle re-reads this without a refetch. */
  protected readonly rows = computed<readonly { remedy: Remedy; content: RemedyContentView }[]>(
    () => {
      const locale = this.language.current();
      return this.remedies().map((remedy) => ({
        remedy,
        content: pickRemedyContent(remedy, locale),
      }));
    },
  );
  readonly selectedIds = input.required<readonly string[]>();
  readonly note = input('');
  /** True while the claim is not live: the text stays, the controls stop. */
  readonly disabled = input(false);
  readonly loading = input(false);
  /** Human-supplied disease name, rendered verbatim; empty when nothing is selected yet. */
  readonly diseaseName = input('');
  /**
   * The server's computed dose per remedy id, already gated to the rank-1 disease by
   * `OfficerFacade.computedDoseById`. Absent for most remedies — the human-owned rate columns
   * are null in the seed data until content-owner C15 — and an absent dose renders as nothing
   * at all, never as a zero or a placeholder (`COMMON-CON-003`).
   */
  readonly doses = input<ReadonlyMap<string, ComputedDose>>(EMPTY_DOSES);

  readonly toggleRemedy = output<string>();
  readonly noteChange = output<string>();

  protected readonly selectedCount = computed(() => this.selectedIds().length);

  protected doseFor(remedy: Remedy): ComputedDose | undefined {
    return this.doses().get(this.identity(remedy));
  }

  /** D-07 — the identity field is `id` or `remedyId` depending on where the object came from. */
  protected identity(remedy: Remedy): string {
    return remedyId(remedy);
  }

  protected isSelected(remedy: Remedy): boolean {
    return this.selectedIds().includes(this.identity(remedy));
  }

  protected onToggle(remedy: Remedy): void {
    if (this.disabled()) return;
    this.toggleRemedy.emit(this.identity(remedy));
  }

  protected onNote(event: Event): void {
    const target = event.target as HTMLTextAreaElement;
    this.noteChange.emit(target.value);
  }
}
