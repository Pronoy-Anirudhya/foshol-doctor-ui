import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * WEB-API-003 — every list request is paginated with `page` and `size`, and the response
 * envelope's `content`, `page`, `size`, `totalElements` and `totalPages` (`00-common` §8.2)
 * are read rather than inferred. This component takes the four envelope numbers straight and
 * derives nothing the server did not say: `totalPages` is the server's, not
 * `ceil(totalElements / size)`, because WEB-NFR-001 forbids re-implementing a backend rule.
 *
 * `page` is zero-based on the wire (OpenAPI `Page` parameter, `minimum: 0`) and one-based on
 * screen. That translation happens here, once.
 */
const FIRST_PAGE = 0;
const HUMAN_PAGE_OFFSET = 1;

@Component({
  selector: 'foshol-paginator',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  host: { class: 'block' },
  template: `
    @if (totalPages() > 1 || totalElements() > 0) {
      <nav
        class="flex flex-wrap items-center justify-between gap-3"
        [attr.aria-label]="'shared.paginator.label' | translate"
      >
        <p class="text-sm text-ink-muted tabular">
          {{
            'shared.paginator.status'
              | translate
                : {
                    page: humanPage(),
                    totalPages: displayTotalPages(),
                    totalElements: totalElements(),
                  }
          }}
        </p>

        <div class="flex items-center gap-2">
          <button
            type="button"
            class="touch-target inline-flex items-center gap-1.5 rounded-xl border border-surface-3 bg-surface-0 px-4 text-sm font-medium text-ink transition-colors duration-1 ease-settle hover:bg-surface-1 disabled:cursor-not-allowed disabled:text-ink-faint disabled:opacity-60"
            [disabled]="!hasPrevious()"
            (click)="goTo(page() - 1)"
          >
            <svg viewBox="0 0 16 16" class="h-4 w-4 shrink-0" aria-hidden="true" fill="none">
              <path
                d="M10 3.5L5.5 8l4.5 4.5"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            {{ 'shared.paginator.previous' | translate }}
          </button>

          <button
            type="button"
            class="touch-target inline-flex items-center gap-1.5 rounded-xl border border-surface-3 bg-surface-0 px-4 text-sm font-medium text-ink transition-colors duration-1 ease-settle hover:bg-surface-1 disabled:cursor-not-allowed disabled:text-ink-faint disabled:opacity-60"
            [disabled]="!hasNext()"
            (click)="goTo(page() + 1)"
          >
            {{ 'shared.paginator.next' | translate }}
            <svg viewBox="0 0 16 16" class="h-4 w-4 shrink-0" aria-hidden="true" fill="none">
              <path
                d="M6 3.5L10.5 8 6 12.5"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        </div>
      </nav>
    }
  `,
})
export class Paginator {
  readonly page = input(FIRST_PAGE);
  /** Part of the envelope (WEB-API-003); held so a caller can bind all four and round-trip. */
  readonly size = input(0);
  readonly totalElements = input(0);
  readonly totalPages = input(0);

  /** Emits the zero-based page index the caller should request next. */
  readonly pageChange = output<number>();

  protected readonly humanPage = computed(() => this.page() + HUMAN_PAGE_OFFSET);
  /** A server that reports zero pages for an empty list still reads as "page 1 of 1". */
  protected readonly displayTotalPages = computed(() =>
    Math.max(this.totalPages(), HUMAN_PAGE_OFFSET),
  );
  protected readonly hasPrevious = computed(() => this.page() > FIRST_PAGE);
  protected readonly hasNext = computed(() => this.page() + HUMAN_PAGE_OFFSET < this.totalPages());

  protected goTo(target: number): void {
    if (target < FIRST_PAGE || target >= this.totalPages()) return;
    this.pageChange.emit(target);
  }
}
