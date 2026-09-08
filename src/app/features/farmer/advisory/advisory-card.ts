import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  resource,
  signal,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { Advisory } from '../../../generated/models/advisory';
import type { Remedy } from '../../../generated/models/remedy';
import { KnowledgeService } from '../../../generated/services/knowledge.service';
import { ReviewService } from '../../../generated/services/review.service';
import { DhakaDateTimePipe } from '../../../shared/pipes/dhaka-date-time.pipe';
import { RemedyTypeIcon } from '../../../shared/ui/pictogram/remedy-type-icon';
import { SeverityBadge } from '../../../shared/ui/severity-badge/severity-badge';
import { VerifiedStamp } from './verified-stamp';

/**
 * Demo beat 5, and the screen the whole system exists to produce.
 *
 * `WEB-FR-155` — disease name, severity, officer name, `publishedAt` in Asia/Dhaka, and the
 * visible verified-by stamp.
 * `WEB-FR-156` — every remedy's `stepsBn` as an ordered numbered list, one step per line, IN
 * THE ORDER RECEIVED, with a pictogram chosen by `RemedyType`.
 * `WEB-FR-157` — `phiDays`, where present, as a labelled field.
 * `WEB-FR-158` — `version > 1` carries a "revised" marker and access to the prior version.
 *
 * **Every agronomic field on this card is rendered exactly as the server returned it**
 * (`COMMON-CON-003`, `WEB-UX-016`). No translation, no reformatting of a dosage or an
 * interval, and no authored fallback for a missing one: a null field simply omits its row. A
 * wrong dosage is not a bug, it is harm.
 *
 * `Advisory` itself carries no severity — the contract puts it on `Disease` — so it is read
 * from the knowledge module rather than inferred from anything on the advisory
 * (`WEB-NFR-001`). If it cannot be read, the badge is omitted rather than guessed.
 */

/**
 * `DEVIATIONS.md` D-07 — a remedy nested inside an `Advisory` keys its identity `remedyId`,
 * while the same object fetched standalone keys it `id`. Both are read; neither is assumed.
 */
type RemedyIdentity = { readonly id?: string; readonly remedyId?: string };

/** The first published version. Anything above it is a revision (`WEB-FR-158`). */
const FIRST_VERSION = 1;

@Component({
  selector: 'foshol-advisory-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, DhakaDateTimePipe, RemedyTypeIcon, SeverityBadge, VerifiedStamp],
  host: { class: 'block' },
  templateUrl: './advisory-card.html',
  styleUrl: './advisory-card.css',
})
export class AdvisoryCard {
  private readonly knowledge = inject(KnowledgeService);
  private readonly review = inject(ReviewService);

  readonly advisory = input.required<Advisory>();

  /** `WEB-FR-158` — the prior versions are fetched only when the farmer asks for them. */
  private readonly _historyOpen = signal(false);
  protected readonly historyOpen = this._historyOpen.asReadonly();

  protected readonly isRevised = computed(() => this.advisory().version > FIRST_VERSION);

  /**
   * The severity of the disease the officer settled on. `diseaseId` is nullable in the
   * contract, so the request is simply not made when it is absent.
   */
  private readonly disease = resource({
    params: () => {
      const diseaseId = this.advisory().diseaseId;
      return diseaseId === null || diseaseId === undefined ? undefined : { diseaseId };
    },
    loader: ({ params }) => this.knowledge.getDisease({ diseaseId: params.diseaseId }),
  });

  protected readonly severity = computed(() =>
    this.disease.hasValue() ? this.disease.value().severity : null,
  );

  private readonly history = resource({
    params: () =>
      this._historyOpen() && this.isRevised() ? { caseId: this.advisory().caseId } : undefined,
    loader: ({ params }) => this.review.getAdvisoryHistory({ caseId: params.caseId }),
  });

  protected readonly historyLoading = computed(() => this.history.isLoading());
  protected readonly historyFailed = computed(() => this.history.error() !== undefined);

  /**
   * `GET /cases/{caseId}/advisories` returns every version newest first (handover §7.7). The
   * order is the server's and is rendered as received; only the version already on screen is
   * dropped, so what remains is exactly "what I was told before".
   */
  protected readonly priorVersions = computed<readonly Advisory[]>(() => {
    if (!this.history.hasValue()) return [];
    const current = this.advisory().advisoryId;
    return this.history.value().filter((entry) => entry.advisoryId !== current);
  });

  protected toggleHistory(): void {
    this._historyOpen.update((open) => !open);
  }

  protected remedyKey(remedy: Remedy, index: number): string {
    const identity = remedy as Remedy & RemedyIdentity;
    return identity.id ?? identity.remedyId ?? String(index);
  }
}
