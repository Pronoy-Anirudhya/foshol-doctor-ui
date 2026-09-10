import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { LanguageStore } from '../../../core/i18n/language-store';
import type { Remedy } from '../../../generated/models/remedy';
import { pickRemedyContent, type RemedyContentView } from '../../../shared/pipes/content-locale';
import { BnMarker } from '../../../shared/ui/bn-value/bn-marker';
import { RemedyTypeIcon } from '../../../shared/ui/pictogram/remedy-type-icon';

/**
 * The registered remedies for a disease the farmer has explicitly confirmed.
 *
 * Every string on screen here is the knowledge base's, rendered **verbatim** — `titleBn`,
 * `stepsBn`, `dosageBn`, `sourceRef`. Nothing is translated, summarised, reworded, reordered or
 * reformatted, and nothing is invented (`COMMON-CON-003`, `WEB-UX-016`): a wrong dose is not a
 * bug, it is harm. When `dosageBn` is null the line is simply absent — never a dash, never a
 * zero, never a plausible-looking default.
 *
 * The chemical rows are separated into their own section rather than interleaved, because they
 * are the ones that carry a pre-harvest interval and a handling obligation. Within each section
 * the server's order is preserved exactly. All four catalogue types keep their own icon and
 * label — collapsing `CULTURAL` and `BIOLOGICAL` into "organic" would be the client inventing
 * an agronomic grouping.
 */
const NONE = 0;

interface RemedyRow {
  readonly remedy: Remedy;
  readonly content: RemedyContentView;
}

interface RemedyGroup {
  readonly key: string;
  readonly titleKey: string;
  readonly chemical: boolean;
  readonly items: readonly RemedyRow[];
}

@Component({
  selector: 'foshol-faq-remedy-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, RemedyTypeIcon, BnMarker],
  host: { class: 'block' },
  template: `
    @for (group of groups(); track group.key) {
      @if (group.items.length > NONE) {
        <section
          class="mt-6 first:mt-0"
          [attr.aria-labelledby]="group.key + '-heading'"
          [attr.data-testid]="'faq-' + group.key + '-section'"
        >
          <h3 class="faq-rem-heading" [id]="group.key + '-heading'">
            {{ group.titleKey | translate }}
          </h3>

          @if (group.chemical) {
            <!-- Not a warning about the catalogue: a reminder that a chemical carries handling
                 rules whichever entry it came from. -->
            <p class="faq-rem-caution" data-testid="faq-chemical-caution">
              {{ 'farmer.faq.remedy.chemicalCaution' | translate }}
            </p>
          }

          <ul class="grid list-none gap-4 p-0">
            @for (row of group.items; track row.remedy.id) {
              <li
                class="faq-rem-card"
                data-testid="faq-remedy"
                [attr.data-chemical]="group.chemical ? true : null"
              >
                <div class="flex items-center gap-3">
                  <foshol-remedy-type-icon [type]="row.remedy.type" size="md" />
                  <div class="min-w-0">
                    <h4 class="faq-rem-title">
                      {{ row.content.title.text }}
                      @if (row.content.title.marked) {
                        <foshol-bn-marker />
                      }
                    </h4>
                    <p class="faq-rem-type">
                      {{ 'farmer.faq.remedy.type.' + row.remedy.type | translate }}
                    </p>
                  </div>
                </div>

                <div class="mt-3.5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_17rem] xl:gap-7">
                  <ol class="faq-rem-steps" data-testid="faq-remedy-steps">
                    @for (step of row.content.steps.items; track $index) {
                      <li class="faq-rem-step text-base md:text-lg">
                        {{ step }}
                        <!-- One flag covers the whole array, so it is marked once, on the last
                             line, rather than on every step. -->
                        @if (row.content.steps.marked && $last) {
                          <foshol-bn-marker />
                        }
                      </li>
                    }
                  </ol>

                  <dl class="m-0 grid content-start gap-2.5">
                    @if (row.content.dosage; as dosage) {
                      <div class="faq-rem-meta" data-testid="faq-remedy-dosage">
                        <dt class="faq-rem-meta-label">
                          {{ 'farmer.faq.remedy.dosage' | translate }}
                        </dt>
                        <!-- The units are the catalogue's. Never recalculated, never converted. -->
                        <dd class="faq-rem-meta-value">
                          {{ dosage.text }}
                          @if (dosage.marked) {
                            <foshol-bn-marker />
                          }
                        </dd>
                      </div>
                    }

                    @if (row.remedy.phiDays !== null && row.remedy.phiDays !== undefined) {
                      <div
                        class="faq-rem-meta faq-rem-meta-phi"
                        data-testid="faq-remedy-phi"
                      >
                        <dt class="faq-rem-meta-label">
                          {{ 'farmer.faq.remedy.phiLabel' | translate }}
                        </dt>
                        <dd class="faq-rem-meta-value">
                          {{
                            'farmer.faq.remedy.phiValue' | translate: { days: row.remedy.phiDays }
                          }}
                        </dd>
                      </div>
                    }

                    @if (row.remedy.sourceRef) {
                      <div class="faq-rem-meta" data-testid="faq-remedy-source">
                        <dt class="faq-rem-meta-label">
                          {{ 'farmer.faq.remedy.source' | translate }}
                        </dt>
                        <dd class="faq-rem-meta-value faq-rem-meta-source">
                          {{ row.remedy.sourceRef }}
                        </dd>
                      </div>
                    }
                  </dl>
                </div>
              </li>
            }
          </ul>
        </section>
      }
    }
  `,
  styles: `
    .faq-rem-heading {
      margin-block: 0 0.75rem;
      font-size: 1rem;
      font-weight: 700;
      color: var(--color-ink);
    }

    .faq-rem-caution {
      margin-block-end: 0.9rem;
      padding: 0.7rem 0.9rem;
      border: 1px solid var(--color-dawn-300);
      border-radius: var(--radius-chip);
      background: var(--color-dawn-100);
      font-size: 0.9375rem;
      color: var(--color-dawn-700);
    }

    .faq-rem-card {
      padding: 1rem;
      border: 1px solid var(--color-surface-3);
      border-radius: var(--radius-card);
      background: var(--color-surface-0);
    }

    /* A hairline edge, not a fill: the section heading and the icon already say "chemical". */
    .faq-rem-card[data-chemical] {
      border-inline-start: 4px solid var(--color-clay-300);
    }

    .faq-rem-title {
      margin: 0;
      font-size: 1.125rem;
      font-weight: 700;
      color: var(--color-ink);
    }

    .faq-rem-type {
      margin: 0.1rem 0 0;
      font-size: 0.8125rem;
      color: var(--color-ink-muted);
    }

    /* A CSS counter rather than a native marker, so the number sits in a fixed gutter and a long
       Bangla step wraps flush instead of hanging under its own digit. The twin of this rule lives
       in advisory-card.css — change one and look at the other. */
    .faq-rem-steps {
      counter-reset: faq-step;
      display: grid;
      gap: 0.625rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .faq-rem-step {
      position: relative;
      min-block-size: 2rem;
      padding-inline-start: 2.5rem;
      line-height: 1.7;
      color: var(--color-ink);
    }

    .faq-rem-step::before {
      counter-increment: faq-step;
      content: counter(faq-step);
      position: absolute;
      inset-block-start: 0;
      inset-inline-start: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      inline-size: 1.75rem;
      block-size: 1.75rem;
      border-radius: var(--radius-pill);
      background: var(--color-paddy-100);
      font-size: 0.875rem;
      font-weight: 700;
      color: var(--color-paddy-700);
    }

    .faq-rem-meta {
      padding: 0.6rem 0.75rem;
      border-radius: var(--radius-chip);
      background: var(--color-surface-1);
    }

    .faq-rem-meta-phi {
      background: var(--color-dawn-100);
    }

    .faq-rem-meta-label {
      font-size: 0.75rem;
      font-weight: 700;
      color: var(--color-ink-muted);
    }

    .faq-rem-meta-phi .faq-rem-meta-label,
    .faq-rem-meta-phi .faq-rem-meta-value {
      color: var(--color-dawn-700);
    }

    .faq-rem-meta-value {
      margin: 0.25rem 0 0;
      font-size: 1rem;
      font-weight: 600;
      color: var(--color-ink);
    }

    .faq-rem-meta-source {
      font-size: 0.875rem;
      font-weight: 400;
      color: var(--color-ink-muted);
      overflow-wrap: break-word;
    }
  `,
})
export class FaqRemedyList {
  private readonly language = inject(LanguageStore);

  readonly remedies = input<readonly Remedy[]>([]);

  protected readonly NONE = NONE;

  /** Both locales are already on each remedy, so the toggle re-reads this — no refetch. */
  private readonly rows = computed<readonly RemedyRow[]>(() => {
    const locale = this.language.current();
    return this.remedies().map((remedy) => ({ remedy, content: pickRemedyContent(remedy, locale) }));
  });

  /**
   * Non-chemical first. Not a ranking of efficacy — the catalogue's own order is preserved
   * inside each section — but the order a farmer should read them in, with the section that
   * carries a pre-harvest interval arriving under its own heading rather than in a mixed list.
   */
  protected readonly groups = computed<readonly RemedyGroup[]>(() => {
    const all = this.rows();
    return [
      {
        key: 'nonchemical',
        titleKey: 'farmer.faq.remedy.nonChemicalTitle',
        chemical: false,
        items: all.filter((row) => row.remedy.type !== 'CHEMICAL'),
      },
      {
        key: 'chemical',
        titleKey: 'farmer.faq.remedy.chemicalTitle',
        chemical: true,
        items: all.filter((row) => row.remedy.type === 'CHEMICAL'),
      },
    ];
  });
}
