import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

/** Which seeded account a "fill in" button refers to (handover §2). */
export type DemoAccount = 'farmer' | 'officer' | 'admin';

/**
 * The seeded demo credentials, on screen, dismissible.
 *
 * This is a demo build for a room with a presenter and a clock; the credentials are seeded by
 * migration `V100` on the `local` and `demo` profiles and are documented in
 * `docs/handover/frontend-demo-api.md` §2. Putting them here saves a fumble, and dismissing
 * the card is one click when a judge wants the screen clean.
 *
 * They are ordinary user-visible strings, so they live in the catalogue like everything else
 * (`WEB-UX-013`) rather than as literals in this file.
 */
@Component({
  selector: 'foshol-demo-hint',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  template: `
    @if (!dismissed()) {
      <aside class="hint" [class.hint--console]="isConsole()">
        <div class="flex items-start justify-between gap-3">
          <p class="text-xs font-bold uppercase tracking-wider">
            {{ 'auth.demo.title' | translate }}
          </p>
          <button type="button" class="dismiss shrink-0" (click)="dismissed.set(true)">
            {{ 'auth.demo.dismiss' | translate }}
          </button>
        </div>

        <dl class="mt-2 space-y-1.5 text-sm">
          @if (!isConsole()) {
            <div class="row">
              <dt>{{ 'auth.demo.farmerLabel' | translate }}</dt>
              <dd class="font-latin">
                {{ 'auth.demo.farmerPhone' | translate }} · {{ 'auth.demo.farmerOtp' | translate }}
              </dd>
              <button type="button" class="fill" (click)="use.emit('farmer')">
                {{ 'auth.demo.use' | translate }}
              </button>
            </div>
          } @else {
            <div class="row">
              <dt>{{ 'auth.demo.officerLabel' | translate }}</dt>
              <dd class="font-latin">
                {{ 'auth.demo.officerUsername' | translate }} ·
                {{ 'auth.demo.officerPassword' | translate }}
              </dd>
              <button type="button" class="fill" (click)="use.emit('officer')">
                {{ 'auth.demo.use' | translate }}
              </button>
            </div>
            <div class="row">
              <dt>{{ 'auth.demo.adminLabel' | translate }}</dt>
              <dd class="font-latin">
                {{ 'auth.demo.adminUsername' | translate }} ·
                {{ 'auth.demo.adminPassword' | translate }}
              </dd>
              <button type="button" class="fill" (click)="use.emit('admin')">
                {{ 'auth.demo.use' | translate }}
              </button>
            </div>
          }
        </dl>
      </aside>
    }
  `,
  styles: `
    .hint {
      padding: 0.75rem 0.9rem;
      border: 1px dashed var(--color-surface-3);
      border-radius: 0.875rem;
      background: var(--color-surface-1);
      color: var(--color-ink-muted);
    }

    .hint--console {
      background: var(--color-surface-2);
    }

    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0.5rem;
    }

    dt {
      min-inline-size: 5.5rem;
      font-weight: 600;
      color: var(--color-ink);
    }

    dd {
      margin: 0;
      flex: 1 1 auto;
      word-break: break-word;
    }

    /* WEB-UX-033 — 44px even here, where the control is visually a small pill. */
    .fill {
      display: inline-flex;
      align-items: center;
      min-block-size: 44px;
      border-radius: 999px;
      border: 1px solid var(--color-paddy-600);
      padding-inline: 0.75rem;
      font-size: 0.75rem;
      font-weight: 700;
      color: var(--color-paddy-700);
      transition: background-color var(--duration-1) var(--ease-settle);
    }

    .dismiss {
      display: inline-flex;
      align-items: center;
      min-block-size: 44px;
      padding-inline: 0.5rem;
      font-size: 0.75rem;
      font-weight: 700;
      color: var(--color-ink-muted);
      text-decoration: underline;
      text-underline-offset: 3px;
    }

    .fill:hover {
      background: var(--color-paddy-50);
    }
  `,
})
export class DemoHint {
  readonly variant = input<'farmer' | 'console'>('farmer');
  readonly use = output<DemoAccount>();

  protected readonly dismissed = signal(false);
  protected readonly isConsole = computed(() => this.variant() === 'console');
}

/**
 * Reads a demo credential out of the active catalogue so a prefill button and the card it sits
 * on can never disagree. `instant` widens to `StrictTranslation`, so anything but a plain
 * string becomes an empty field rather than `[object Object]` in an input.
 */
export function demoValue(translate: TranslateService, key: string): string {
  const value: unknown = translate.instant(key);
  return typeof value === 'string' ? value : '';
}
