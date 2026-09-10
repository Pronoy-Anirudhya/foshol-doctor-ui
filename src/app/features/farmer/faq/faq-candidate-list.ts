import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { VoiceSearchCandidate } from '../../../generated/models/voice-search-candidate';
import { Percent1Pipe } from '../../../shared/pipes/percent1.pipe';
import { BnValue } from '../../../shared/ui/bn-value/bn-value';
import type { FaqSelection } from './faq-store';

/**
 * What the server matched, offered as a choice — never as an answer.
 *
 * This is the confirmation step, and it exists for a safety reason. Speech recognition
 * mishears; the top-ranked candidate of a mishearing still looks like a confident, plausible
 * disease name. So the ranking is shown, and nothing else happens until the farmer taps one.
 * No remedy text, no dosage, no chemical name is fetched from this component — `FaqStore.confirm`
 * is the only door to that, and only a tap opens it.
 *
 * `WEB-UX-016` — the name renders verbatim in whichever locale the catalogue supplied;
 * the `code` is the catalogue's Latin identifier and gets `font-latin` tracking rather than
 * being translated or hidden. The `matcher` enum is NOT shown raw: `NAME` / `VECTOR` / `FUZZY`
 * mean nothing to a farmer, so each maps to one plain-language line.
 *
 * `WEB-UX-044` — the confirmed chip carries a ring, a tick and a bold label, never colour alone.
 */
@Component({
  selector: 'foshol-faq-candidate-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, Percent1Pipe, BnValue],
  host: { class: 'block' },
  template: `
    <ul class="grid list-none gap-3 p-0" data-testid="faq-candidates">
      <!-- Server order is render order; nothing here re-ranks (WEB-NFR-001). -->
      @for (candidate of candidates(); track candidate.diseaseId) {
        <li>
          <button
            type="button"
            class="faq-cand touch-target"
            data-testid="faq-candidate"
            [attr.data-selected]="candidate.diseaseId === selectedId() ? true : null"
            [attr.aria-pressed]="candidate.diseaseId === selectedId()"
            [disabled]="disabled()"
            (click)="choose(candidate)"
          >
            <span class="faq-cand-main">
              <span class="faq-cand-name">
                <foshol-bn-value
                  [bn]="candidate.nameBn"
                  [en]="candidate.nameEn"
                  [fallback]="candidate.nameEnFallback"
                />
              </span>
              <span class="faq-cand-meta">
                <span class="font-latin">{{ candidate.code }}</span>
                <span aria-hidden="true">&nbsp;·&nbsp;</span>
                <span>{{ 'farmer.faq.matcher.' + candidate.matcher | translate }}</span>
              </span>
            </span>

            <span class="faq-cand-score font-latin" aria-hidden="true">
              {{ candidate.score | percent1 }}%
            </span>
            <span class="sr-only">
              {{ 'farmer.faq.candidate.scoreLabel' | translate: { score: candidate.score | percent1 } }}
            </span>

            @if (candidate.diseaseId === selectedId()) {
              <svg class="faq-cand-tick" viewBox="0 0 24 24" aria-hidden="true" fill="none">
                <circle cx="12" cy="12" r="11" fill="currentColor" />
                <path
                  d="M7 12.4l3.3 3.3L17 9"
                  stroke="var(--color-ink-invert)"
                  stroke-width="2.4"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            }
          </button>
        </li>
      }
    </ul>
  `,
  styles: `
    .faq-cand {
      display: flex;
      inline-size: 100%;
      align-items: center;
      gap: 0.75rem;
      padding: 0.85rem 1rem;
      border: 2px solid var(--color-surface-3);
      border-radius: var(--radius-card);
      background: var(--color-surface-0);
      text-align: start;
      box-shadow: var(--shadow-card);
      transition:
        border-color var(--duration-1) var(--ease-settle),
        box-shadow var(--duration-2) var(--ease-settle);
    }

    .faq-cand:hover:not(:disabled) {
      box-shadow: var(--shadow-lift);
    }

    .faq-cand:disabled {
      opacity: 0.6;
    }

    .faq-cand[data-selected] {
      border-color: var(--color-paddy-600);
      box-shadow:
        0 0 0 3px var(--color-paddy-200),
        var(--shadow-lift);
    }

    .faq-cand-main {
      display: grid;
      gap: 0.15rem;
      min-inline-size: 0;
      flex: 1;
    }

    .faq-cand-name {
      font-size: 1.125rem;
      font-weight: 600;
      color: var(--color-ink);
    }

    .faq-cand[data-selected] .faq-cand-name {
      font-weight: 800;
      color: var(--color-paddy-700);
    }

    .faq-cand-meta {
      font-size: 0.8125rem;
      color: var(--color-ink-muted);
    }

    .faq-cand-score {
      flex: none;
      font-size: 0.875rem;
      font-weight: 700;
      color: var(--color-ink-muted);
    }

    .faq-cand-tick {
      flex: none;
      inline-size: 1.6rem;
      block-size: 1.6rem;
      color: var(--color-paddy-600);
    }
  `,
})
export class FaqCandidateList {
  readonly candidates = input<readonly VoiceSearchCandidate[]>([]);
  readonly selectedId = input<string | null>(null);
  readonly disabled = input(false);

  readonly confirmed = output<FaqSelection>();

  protected choose(candidate: VoiceSearchCandidate): void {
    if (this.disabled()) return;
    this.confirmed.emit({
      diseaseId: candidate.diseaseId,
      code: candidate.code,
      nameBn: candidate.nameBn,
      nameEn: candidate.nameEn,
      nameEnFallback: candidate.nameEnFallback,
    });
  }
}
