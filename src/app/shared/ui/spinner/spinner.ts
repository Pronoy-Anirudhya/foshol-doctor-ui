import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { APP_CONFIG } from '../../../core/config/app-config';

/**
 * WEB-FR-400 — a request that exceeds `ui.spinnerDelayMs` gets an indicator, and no region is
 * ever left blank.
 *
 * The delay is the whole point and lives HERE rather than in every caller: a request that
 * finishes in 80 ms must not produce a flash of spinner, which reads as jank and makes a fast
 * demo look slow. Bind `[active]` to the loading flag and the timing is handled.
 */
const SIZES = {
  sm: 'h-4 w-4 border-2',
  md: 'h-6 w-6 border-2',
  lg: 'h-9 w-9 border-[3px]',
} as const;

type SpinnerSize = keyof typeof SIZES;

@Component({
  selector: 'foshol-spinner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  host: { class: 'contents' },
  template: `
    @if (visible()) {
      <span class="inline-flex items-center gap-2 text-ink-muted" role="status">
        <span
          class="animate-spin rounded-full border-surface-3 border-t-paddy-600"
          [class]="sizeClass()"
          aria-hidden="true"
        ></span>
        @if (showLabel()) {
          <span class="text-sm">{{ labelKey() | translate }}</span>
        } @else {
          <span class="sr-only">{{ labelKey() | translate }}</span>
        }
      </span>
    }
  `,
})
export class Spinner {
  readonly active = input(true);
  readonly size = input<SpinnerSize>('md');
  readonly showLabel = input(false);
  readonly labelKey = input('shared.loading.label');

  private readonly _visible = signal(false);
  readonly visible = this._visible.asReadonly();

  protected readonly sizeClass = computed(() => SIZES[this.size()]);

  constructor() {
    const destroyRef = inject(DestroyRef);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clear = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };

    effect(() => {
      const active = this.active();
      clear();
      if (!active) {
        this._visible.set(false);
        return;
      }
      timer = setTimeout(() => this._visible.set(true), APP_CONFIG.ui.spinnerDelayMs);
    });

    destroyRef.onDestroy(clear);
  }
}
