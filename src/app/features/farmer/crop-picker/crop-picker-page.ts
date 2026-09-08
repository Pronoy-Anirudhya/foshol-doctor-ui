import { ChangeDetectionStrategy, Component, computed, inject, resource } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { CaseDraftStore } from '../../../core/stores/case-draft-store';
import { toProblemView } from '../../../core/errors/problem';
import { KnowledgeService } from '../../../generated/services/knowledge.service';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { ErrorPanel } from '../../../shared/ui/error-panel/error-panel';
import { PageHeading } from '../../../shared/ui/page-heading/page-heading';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { FARMER_PATHS } from '../capture/farmer-paths';
import { CropGrid } from './crop-grid';

/**
 * Step one of a new case: which crop.
 *
 * WEB-FR-100 — icon tiles, never a dropdown. WEB-FR-101 — the capture step stays disabled
 * while nothing is chosen, which here is the whole screen's one forward control.
 *
 * The chosen crop goes straight into `CaseDraftStore`, so a farmer who reloads the page comes
 * back to the crop they picked (`WEB-DATA-020` persists `cropId` and `noteBn`, and nothing
 * else).
 */
@Component({
  selector: 'foshol-crop-picker-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CropGrid, EmptyState, ErrorPanel, PageHeading, Skeleton, TranslatePipe],
  template: `
    <div class="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 md:py-10">
      <foshol-page-heading
        eyebrowKey="farmer.capture.eyebrow"
        titleKey="farmer.capture.crop.title"
        subtitleKey="farmer.capture.crop.subtitle"
      />

      <div class="mt-6">
        @if (crops.isLoading()) {
          <foshol-skeleton variant="media" [count]="cropSkeletonCount" />
        } @else if (problem(); as failure) {
          <foshol-error-panel [problem]="failure" (retry)="crops.reload()" />
        } @else if (available().length === 0) {
          <foshol-empty-state
            titleKey="farmer.capture.crop.emptyTitle"
            detailKey="farmer.capture.crop.emptyDetail"
          />
        } @else {
          <foshol-crop-grid
            [crops]="available()"
            [selectedId]="draft.cropId()"
            (cropChosen)="choose($event)"
          />
        }
      </div>

      <div class="mt-8">
        <button
          type="button"
          class="continue touch-target"
          data-testid="crop-continue"
          [disabled]="draft.cropId() === null"
          (click)="continueToCapture()"
        >
          {{ 'farmer.capture.crop.continue' | translate }}
        </button>
        @if (draft.cropId() === null) {
          <p class="mt-2 text-sm text-ink-muted" data-testid="crop-required">
            {{ 'farmer.capture.crop.required' | translate }}
          </p>
        }
      </div>
    </div>
  `,
  styles: `
    .continue {
      inline-size: 100%;
      padding: 0.9rem 1.5rem;
      border-radius: 1rem;
      background: var(--color-paddy-600);
      color: var(--color-ink-invert);
      font-size: 1.0625rem;
      font-weight: 700;
      box-shadow: var(--shadow-card);
      transition:
        background-color var(--duration-1) var(--ease-settle),
        box-shadow var(--duration-2) var(--ease-settle);
    }

    .continue:hover:not(:disabled) {
      background: var(--color-paddy-700);
      box-shadow: var(--shadow-lift);
    }

    .continue:disabled {
      background: var(--color-surface-3);
      color: var(--color-ink-muted);
      box-shadow: none;
      cursor: not-allowed;
    }
  `,
})
export class CropPickerPage {
  private readonly knowledge = inject(KnowledgeService);
  private readonly router = inject(Router);

  protected readonly draft = inject(CaseDraftStore);

  /** The skeleton's shape, not a limit on crops — the grid renders whatever the API returns. */
  protected readonly cropSkeletonCount = SKELETON_TILES;

  protected readonly crops = resource({ loader: () => this.knowledge.listCrops() });

  protected readonly available = computed(() => this.crops.value() ?? []);
  protected readonly problem = computed(() => {
    const failure = this.crops.error();
    return failure ? toProblemView(failure) : null;
  });

  protected choose(cropId: string): void {
    this.draft.chooseCrop(cropId);
  }

  protected continueToCapture(): void {
    if (this.draft.cropId() === null) return;
    void this.router.navigateByUrl(FARMER_PATHS.capture);
  }
}

/** Three crops are seeded (rice, tomato, potato); the placeholder holds their layout. */
const SKELETON_TILES = 3;
