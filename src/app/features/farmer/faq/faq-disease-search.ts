import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { APP_CONFIG } from '../../../core/config/app-config';
import type { Disease } from '../../../generated/models/disease';
import { BnValue } from '../../../shared/ui/bn-value/bn-value';
import type { FaqSelection } from './faq-store';

/**
 * The degraded path: read the catalogue with your eyes and your thumb.
 *
 * It appears whenever speaking is not available or did not work — no microphone, an insecure
 * origin, a refused permission, the ASR sidecar returning `503`, or an inconclusive match. The
 * knowledge base is a plain `GET /crops/{cropId}/diseases` away in all of those cases, so the
 * farmer is never left with a dead screen and a suggestion to try again later.
 *
 * Deliberately NOT the Web Speech API. The browser recogniser is a typing aid on the capture
 * screen (`DEVIATIONS.md` D-23); using it as a substitute ASR here would mean two different
 * transcribers producing two different answers from the same sentence, and only one of them is
 * the one the backend matches against.
 *
 * Choosing a row here reaches the same `FaqStore.confirm` as a voice candidate does, so remedy
 * text is still gated behind one deliberate tap.
 */
const EMPTY = 0;

@Component({
  selector: 'foshol-faq-disease-search',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, BnValue],
  host: { class: 'block' },
  template: `
    <div class="faq-ds">
      <label class="faq-ds-label" [attr.for]="inputId">
        {{ 'farmer.faq.browse.label' | translate }}
      </label>
      <input
        type="search"
        class="faq-ds-input touch-target font-latin"
        data-testid="faq-disease-filter"
        [id]="inputId"
        [value]="query()"
        [attr.placeholder]="'farmer.faq.browse.placeholder' | translate"
        [disabled]="disabled()"
        (input)="onQuery($event)"
      />

      @if (loading()) {
        <!-- Deliberately not a live region. WEB-UX-046 allows exactly one, the shell owns it,
             and the recorder panel already carries the one transient status this page needs. -->
        <p class="faq-ds-note">{{ 'farmer.faq.browse.loading' | translate }}</p>
      } @else if (diseases().length === EMPTY) {
        <p class="faq-ds-note">{{ 'farmer.faq.browse.noneForCrop' | translate }}</p>
      } @else if (filtered().length === EMPTY) {
        <p class="faq-ds-note" data-testid="faq-disease-no-match">
          {{ 'farmer.faq.browse.noMatch' | translate }}
        </p>
      } @else {
        <ul class="faq-ds-list" data-testid="faq-disease-list">
          @for (disease of filtered(); track disease.id) {
            <li>
              <button
                type="button"
                class="faq-ds-row touch-target"
                data-testid="faq-disease-row"
                [attr.data-selected]="disease.id === selectedId() ? true : null"
                [attr.aria-pressed]="disease.id === selectedId()"
                [disabled]="disabled()"
                (click)="choose(disease)"
              >
                <span class="faq-ds-name">{{ disease.nameBn }}</span>
                @if (disease.nameEn) {
                  <span class="faq-ds-en">
                    <foshol-bn-value
                      [value]="disease.nameEn"
                      [fallback]="disease.nameEnFallback ?? false"
                    />
                  </span>
                }
                <span class="faq-ds-code font-latin" aria-hidden="true">{{ disease.code }}</span>
              </button>
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: `
    .faq-ds {
      display: grid;
      gap: 0.5rem;
    }

    .faq-ds-label {
      font-size: 0.9375rem;
      font-weight: 600;
      color: var(--color-ink);
    }

    .faq-ds-input {
      inline-size: 100%;
      padding: 0.6rem 0.9rem;
      border: 1px solid var(--color-surface-3);
      border-radius: var(--radius-control);
      background: var(--color-surface-0);
      font-size: 1rem;
      color: var(--color-ink);
    }

    .faq-ds-note {
      margin: 0;
      font-size: 0.9375rem;
      color: var(--color-ink-muted);
    }

    .faq-ds-list {
      display: grid;
      gap: 0.5rem;
      margin: 0.25rem 0 0;
      padding: 0;
      list-style: none;
    }

    .faq-ds-row {
      display: flex;
      inline-size: 100%;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0.25rem 0.6rem;
      padding: 0.7rem 0.9rem;
      border: 2px solid var(--color-surface-3);
      border-radius: var(--radius-chip);
      background: var(--color-surface-0);
      text-align: start;
    }

    .faq-ds-row[data-selected] {
      border-color: var(--color-paddy-600);
      box-shadow: 0 0 0 3px var(--color-paddy-200);
    }

    .faq-ds-row:disabled {
      opacity: 0.6;
    }

    .faq-ds-name {
      font-size: 1.0625rem;
      font-weight: 600;
      color: var(--color-ink);
    }

    .faq-ds-row[data-selected] .faq-ds-name {
      font-weight: 800;
      color: var(--color-paddy-700);
    }

    .faq-ds-en,
    .faq-ds-code {
      font-size: 0.8125rem;
      color: var(--color-ink-muted);
    }

    .faq-ds-code {
      margin-inline-start: auto;
    }
  `,
})
export class FaqDiseaseSearch {
  readonly diseases = input<readonly Disease[]>([]);
  readonly loading = input(false);
  readonly disabled = input(false);
  readonly selectedId = input<string | null>(null);

  readonly confirmed = output<FaqSelection>();

  protected readonly inputId = 'faq-disease-filter';
  protected readonly EMPTY = EMPTY;

  private readonly _query = signal('');
  protected readonly query = this._query.asReadonly();

  /**
   * A local substring filter over rows already in memory — not a search request. The contract
   * has no disease-search parameter, and inventing a URL for one is `WEB-API-001`.
   */
  protected readonly filtered = computed<readonly Disease[]>(() => {
    const needle = this._query().trim().toLocaleLowerCase();
    const rows = this.diseases();
    if (needle.length < APP_CONFIG.faq.diseaseFilterMinChars) return rows;
    return rows.filter((disease) =>
      [disease.nameBn, disease.nameEn ?? '', disease.code]
        .join(' ')
        .toLocaleLowerCase()
        .includes(needle),
    );
  });

  protected onQuery(event: Event): void {
    this._query.set((event.target as HTMLInputElement).value);
  }

  protected choose(disease: Disease): void {
    if (this.disabled()) return;
    this.confirmed.emit({
      diseaseId: disease.id,
      code: disease.code,
      nameBn: disease.nameBn,
    });
  }
}
