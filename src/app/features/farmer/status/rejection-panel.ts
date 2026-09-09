import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { CaseDraftStore } from '../../../core/stores/case-draft-store';
import { FARMER_PATHS } from '../capture/farmer-paths';

/**
 * `WEB-FR-160` — a rejected case shows the officer's Bangla message and offers "submit a new
 * case", which opens a fresh draft pre-filled with the same crop and carrying `parentCaseId`.
 *
 * Rejection is terminal (ADR-0012): there is no appeal, no retry of the same case, and no
 * "reopen". The one forward move is a new case that names its parent, so the officer sees the
 * resubmission marked as one.
 *
 * The tone is deliberate. A rejection here almost always means the photograph was not good
 * enough to judge safely — that is the human gate doing its job, not the farmer failing. The
 * chrome says so; the officer's own words say the rest, verbatim (`COMMON-CON-003`).
 *
 * The draft is prepared through `CaseDraftStore` rather than by reaching into the capture
 * feature's components: crop and parent are shared state, and the capture surface belongs to
 * another agent (`00-common` §12.1). The capture URL comes from that surface's own
 * `FARMER_PATHS`, so a route rename cannot leave this button pointing at nothing.
 */

@Component({
  selector: 'foshol-rejection-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  host: { class: 'block' },
  template: `
    <section
      class="rounded-2xl border border-clay-300 bg-clay-100 p-5 md:p-6"
      data-testid="rejection-panel"
      aria-labelledby="rj-title"
    >
      <div class="flex items-start gap-3">
        <!-- WEB-UX-044 — a glyph and a heading, not a colour, carry the meaning. -->
        <svg
          viewBox="0 0 24 24"
          class="mt-0.5 h-7 w-7 shrink-0 text-clay-700"
          aria-hidden="true"
          fill="none"
        >
          <circle cx="12" cy="12" r="9.2" stroke="currentColor" stroke-width="1.8" />
          <path d="M12 7.2v5.4" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          <circle cx="12" cy="16.2" r="1.15" fill="currentColor" />
        </svg>

        <div class="min-w-0">
          <h3 id="rj-title" class="m-0 text-xl font-bold text-clay-700">
            {{ 'farmer.rejection.title' | translate }}
          </h3>
          <p class="mt-1.5 mb-0 text-clay-700">{{ 'farmer.rejection.lead' | translate }}</p>
        </div>
      </div>

      @if (messageBn()) {
        <figure class="mt-4 mb-0">
          <figcaption class="text-xs font-bold text-clay-700 uppercase">
            {{ 'farmer.rejection.officerMessage' | translate }}
          </figcaption>
          <!-- The officer's own Bangla, rendered as text exactly as sent (WEB-SEC-005). -->
          <blockquote
            class="mt-1.5 mb-0 rounded-xl border border-clay-300 bg-surface-0 px-4 py-3 text-base text-ink md:text-lg"
            data-testid="rejection-message"
          >
            {{ messageBn() }}
          </blockquote>
        </figure>
      }

      <p class="mt-4 mb-0 text-sm text-clay-700">
        {{ 'farmer.rejection.reassurance' | translate }}
      </p>

      <button
        type="button"
        class="touch-target mt-4 inline-flex items-center justify-center rounded-2xl bg-paddy-600 px-5 py-3 font-bold text-ink-invert shadow-card transition-colors duration-1 ease-settle hover:bg-paddy-700"
        data-testid="rejection-new-case"
        (click)="startResubmission()"
      >
        {{ 'farmer.rejection.newCase' | translate }}
      </button>
    </section>
  `,
})
export class RejectionPanel {
  private readonly draft = inject(CaseDraftStore);
  private readonly router = inject(Router);

  readonly caseId = input.required<string>();
  /** `CaseDetail.cropId`. The new draft opens on the same crop the farmer already chose. */
  readonly cropId = input<string | null>(null);
  /** Server-supplied Bangla from the officer. Null when the projection did not carry it. */
  readonly messageBn = input<string | null>(null);

  protected async startResubmission(): Promise<void> {
    // A fresh draft, not an edit of whatever was left behind (WEB-DATA-022).
    this.draft.discard();
    this.draft.chooseCrop(this.cropId());
    // WEB-FR-160 — the resubmission names the case it replaces.
    this.draft.setParentCase(this.caseId());
    await this.router.navigateByUrl(FARMER_PATHS.newCase);
  }
}
