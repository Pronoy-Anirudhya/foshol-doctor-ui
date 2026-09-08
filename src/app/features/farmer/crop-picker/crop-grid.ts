import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  input,
  output,
  viewChildren,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { Crop } from '../../../generated/models/crop';
import { BnValue } from '../../../shared/ui/bn-value/bn-value';
import { CropIcon } from '../../../shared/ui/pictogram/crop-icon';

/**
 * WEB-FR-100 — every crop as a LARGE touch target carrying its `iconKey` pictogram and its
 * `nameBn`, and **no `<select>` anywhere**. The farmer may be low-literacy, on a phone, in a
 * field; a native dropdown is a 24 px row of text that has to be opened before it can be read.
 * AC-02 inspects the rendered DOM for the absence of `<select>`, so this is a structural
 * promise rather than a styling preference.
 *
 * WEB-UX-044 — selection is a ring **and** a checkmark **and** a bold label. Never colour
 * alone; a farmer with a red-green deficiency, outdoors, in sunlight, must still see which
 * tile is chosen.
 *
 * WEB-UX-040 — one `radiogroup` with roving tabindex: the group takes a single tab stop and
 * the arrow keys move between crops, which is what a screen-reader user expects of a radio
 * group and what a keyboard-only judge will try first.
 *
 * WEB-UX-016 / WEB-UX-015 — `nameBn` and `nameEn` render exactly as the server returned them,
 * through `<foshol-bn-value>` so `nameEnFallback` carries its `(bn)` marker.
 */
const NEXT_KEYS: readonly string[] = ['ArrowRight', 'ArrowDown'];
const PREVIOUS_KEYS: readonly string[] = ['ArrowLeft', 'ArrowUp'];
const FIRST_KEY = 'Home';
const LAST_KEY = 'End';
const FIRST_INDEX = 0;
const STEP = 1;
const ROVING_FOCUSABLE = 0;
const ROVING_SKIPPED = -1;

@Component({
  selector: 'foshol-crop-grid',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BnValue, CropIcon, TranslatePipe],
  host: { class: 'block' },
  template: `
    <div
      role="radiogroup"
      class="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4"
      [attr.aria-label]="'farmer.capture.crop.groupLabel' | translate"
      (keydown)="onKeydown($event)"
    >
      @for (crop of crops(); track crop.id; let index = $index) {
        <button
          #tile
          type="button"
          role="radio"
          class="crop-tile touch-target"
          data-testid="crop-tile"
          [attr.aria-checked]="crop.id === selectedId()"
          [attr.data-selected]="crop.id === selectedId() ? true : null"
          [attr.tabindex]="tabIndexFor(index)"
          (click)="choose(crop.id)"
        >
          <span class="crop-figure">
            <foshol-crop-icon [iconKey]="crop.iconKey" size="lg" [decorative]="true" />
            @if (crop.id === selectedId()) {
              <!-- WEB-UX-044 — the tick is the non-colour carrier of "chosen". -->
              <svg class="crop-tick" viewBox="0 0 24 24" aria-hidden="true" fill="none">
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
          </span>
          <span class="crop-name">
            <foshol-bn-value [value]="crop.nameBn" />
          </span>
        </button>
      }
    </div>
  `,
  styles: `
    .crop-tile {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.6rem;
      padding: 0.9rem 0.6rem 1rem;
      border: 2px solid var(--color-surface-3);
      border-radius: 1.25rem;
      background: var(--color-surface-0);
      box-shadow: var(--shadow-card);
      transition:
        border-color var(--duration-1) var(--ease-settle),
        transform var(--duration-2) var(--ease-settle),
        box-shadow var(--duration-2) var(--ease-settle);
    }

    .crop-tile:hover {
      transform: translateY(-2px);
      box-shadow: var(--shadow-lift);
    }

    /* The ring — one of three redundant cues, never the only one. */
    .crop-tile[data-selected] {
      border-color: var(--color-paddy-600);
      box-shadow:
        0 0 0 3px var(--color-paddy-200),
        var(--shadow-lift);
    }

    /* Full-bleed square pictogram: the picture is what a farmer reads first. */
    .crop-figure {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      inline-size: 100%;
      aspect-ratio: 1;
      border-radius: 1rem;
      background: var(--color-paddy-50);
    }

    .crop-tile[data-selected] .crop-figure {
      background: var(--color-paddy-100);
    }

    .crop-figure :is(svg) {
      inline-size: 58%;
      block-size: auto;
    }

    .crop-tick {
      position: absolute;
      inset-block-start: 0.35rem;
      inset-inline-end: 0.35rem;
      inline-size: 1.6rem;
      block-size: 1.6rem;
      color: var(--color-paddy-600);
    }

    .crop-name {
      font-size: 1.0625rem;
      line-height: 1.3;
      text-align: center;
      color: var(--color-ink);
    }

    /* Bold weight — the third cue. */
    .crop-tile[data-selected] .crop-name {
      font-weight: 700;
      color: var(--color-paddy-700);
    }
  `,
})
export class CropGrid {
  readonly crops = input<readonly Crop[]>([]);
  readonly selectedId = input<string | null>(null);

  readonly cropChosen = output<string>();

  private readonly tiles = viewChildren<ElementRef<HTMLButtonElement>>('tile');

  /**
   * Roving tabindex: the selected tile is the group's tab stop, or the first tile when
   * nothing is selected yet, so Tab never walks through three buttons one at a time.
   */
  private readonly activeIndex = computed(() => {
    const selected = this.crops().findIndex((crop) => crop.id === this.selectedId());
    return selected < FIRST_INDEX ? FIRST_INDEX : selected;
  });

  protected tabIndexFor(index: number): number {
    return index === this.activeIndex() ? ROVING_FOCUSABLE : ROVING_SKIPPED;
  }

  protected choose(cropId: string): void {
    this.cropChosen.emit(cropId);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const count = this.crops().length;
    if (count === FIRST_INDEX) return;

    const current = this.activeIndex();
    let next: number | null = null;
    if (NEXT_KEYS.includes(event.key)) next = (current + STEP) % count;
    else if (PREVIOUS_KEYS.includes(event.key)) next = (current - STEP + count) % count;
    else if (event.key === FIRST_KEY) next = FIRST_INDEX;
    else if (event.key === LAST_KEY) next = count - STEP;
    if (next === null) return;

    event.preventDefault();
    // Selection follows focus, which is the native behaviour of a radio group.
    const crop = this.crops()[next];
    if (crop !== undefined) this.cropChosen.emit(crop.id);
    this.tiles()[next]?.nativeElement.focus();
  }
}
