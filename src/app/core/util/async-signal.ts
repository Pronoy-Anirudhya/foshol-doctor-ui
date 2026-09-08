import { computed, signal, type Signal } from '@angular/core';

/**
 * A tiny promise → signals adapter for the reads that Angular's `resource()` does not fit:
 * a load the caller triggers explicitly (a manual refresh control, `WEB-FR-205` /
 * `WEB-FR-304`) rather than one derived from route params.
 *
 * Three behaviours are the reason this exists rather than each store rolling its own:
 *
 *  - **A failure never blanks the last good value.** `value` survives an error and `stale`
 *    becomes true, which is what `WEB-FR-305` asks for and what every other view wants anyway.
 *  - **Out-of-order responses are dropped.** Two overlapping reloads race; without a sequence
 *    number the slower one wins and the view shows older data than it did a moment ago.
 *  - **No timer of any kind.** Nothing here reloads on its own (`WEB-FR-356`).
 */
export interface AsyncSignal<T> {
  readonly value: Signal<T | null>;
  readonly loading: Signal<boolean>;
  readonly error: Signal<unknown>;
  readonly loadedAt: Signal<number | null>;
  /** True when values are on screen but the most recent attempt to refresh them failed. */
  readonly stale: Signal<boolean>;
  reload(): Promise<void>;
  set(value: T, at?: number): void;
  clear(): void;
}

export function asyncSignal<T>(loader: () => Promise<T>, now: () => number = Date.now): AsyncSignal<T> {
  const value = signal<T | null>(null);
  const loading = signal(false);
  const error = signal<unknown>(null);
  const loadedAt = signal<number | null>(null);
  let sequence = 0;

  const reload = async (): Promise<void> => {
    const attempt = ++sequence;
    loading.set(true);
    try {
      const result = await loader();
      if (attempt !== sequence) return;
      value.set(result);
      loadedAt.set(now());
      error.set(null);
    } catch (caught: unknown) {
      if (attempt !== sequence) return;
      error.set(caught);
    } finally {
      if (attempt === sequence) loading.set(false);
    }
  };

  return {
    value: value.asReadonly(),
    loading: loading.asReadonly(),
    error: error.asReadonly(),
    loadedAt: loadedAt.asReadonly(),
    stale: computed(() => error() !== null && value() !== null),
    reload,
    set: (next: T, at: number = now()): void => {
      value.set(next);
      loadedAt.set(at);
      error.set(null);
    },
    clear: (): void => {
      sequence++;
      value.set(null);
      loadedAt.set(null);
      error.set(null);
      loading.set(false);
    },
  };
}
