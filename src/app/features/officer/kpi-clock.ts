import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { APP_CONFIG } from '../../core/config/app-config';
import { CountdownPipe } from '../../shared/pipes/countdown.pipe';
import { DhakaTimePipe } from '../../shared/pipes/dhaka-time.pipe';
import { Icon } from '../../shared/ui/icon/icon';

/**
 * One operational KPI clock — the officer's own deadline, never the farmer's wait.
 *
 * **There are three clocks on this console and they are not interchangeable.**
 *  - `slaDueAt` (`REVIEW-FR-049`) is the FARMER's wait. It has its own column and its own label
 *    and this component never renders it.
 *  - `assignmentDueAt` (`REVIEW-FR-090`) is one working hour after the task became `PENDING`.
 *  - `resolutionDueAt` (`REVIEW-FR-091`) is two working hours after the first claim, and a
 *    transfer does not reset it.
 *
 * The caller decides which of the two applies from the task's state and passes the matching
 * `labelKey`, so the words on screen always name the clock underneath them.
 *
 * **`WEB-NFR-001` — nothing here computes a due time.** All three are frozen server-side
 * instants. The working calendar is Sunday–Thursday, 10:00–17:00 Asia/Dhaka, so "now plus one
 * hour" is wrong on a Thursday afternoon and wrong again on a Friday; this component renders the
 * instant it is given and compares it to the instant it is given. It holds no holiday calendar
 * and, deliberately, no timer of its own (`WEB-FR-356`): `now` is supplied by the caller, which
 * already has a non-polling clock — the queue's last load, or the claim timer's tick.
 *
 * Both dues are nullable and the running server omits them entirely, so an absent clock renders
 * **nothing at all** — not a dash, not an empty box, not `Invalid Date`.
 *
 * `WEB-UX-044` — colour is never the sole carrier. A clock in trouble changes its colour AND
 * gains a warning glyph AND says in words how much working time is left, or that it is overdue.
 */
type KpiTone = 'normal' | 'warn' | 'critical' | 'overdue';

const TONE_NORMAL: KpiTone = 'normal';
const TONE_WARN: KpiTone = 'warn';
const TONE_CRITICAL: KpiTone = 'critical';
const TONE_OVERDUE: KpiTone = 'overdue';

const NO_TIME_LEFT = 0;

@Component({
  selector: 'foshol-kpi-clock',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CountdownPipe, DhakaTimePipe, Icon, TranslatePipe],
  host: { class: 'contents' },
  template: `
    @if (dueAtMs() !== null) {
      <span class="kpi" [attr.data-tone]="tone()" data-testid="kpi-clock">
        <span class="kpi-label">{{ labelKey() | translate }}</span>
        <span class="kpi-due tabular">
          @if (warned()) {
            <foshol-icon
              class="kpi-glyph"
              name="warning"
              size="xs"
              [label]="'officer.kpi.warnGlyph' | translate"
            />
          }
          {{ dueAt() | dhakaTime }}
        </span>
        @if (warned()) {
          <span class="kpi-tone" data-testid="kpi-tone">
            {{ toneKey() | translate }}
            @if (!overdue()) {
              <span class="tabular">{{ remainingMs() | countdown }}</span>
            }
          </span>
        }
      </span>
    }
  `,
  styles: `
    .kpi {
      display: inline-flex;
      flex-direction: column;
      gap: 0.1rem;
      border-radius: var(--radius-chip);
      padding: 0.2rem 0.5rem;
      background: var(--color-surface-1);
      border: 1px solid var(--color-surface-3);
      white-space: nowrap;
    }

    .kpi-label {
      font-size: 0.6875rem;
      font-weight: 700;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      color: var(--color-ink-faint);
    }

    .kpi-due {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      font-size: 0.8125rem;
      font-weight: 700;
      color: var(--color-ink);
    }

    .kpi-tone {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      font-size: 0.6875rem;
      font-weight: 700;
    }

    /* The three tinted states. Each pairs a 100-level ground with a 700-level ink, which is the
       pairing check-contrast already gates elsewhere on this screen. */
    .kpi[data-tone='warn'] {
      border-color: var(--color-dawn-300);
      background: var(--color-dawn-100);
    }

    .kpi[data-tone='warn'] :is(.kpi-label, .kpi-due, .kpi-tone, .kpi-glyph) {
      color: var(--color-dawn-700);
    }

    .kpi[data-tone='critical'],
    .kpi[data-tone='overdue'] {
      border-color: var(--color-clay-300);
      background: var(--color-clay-100);
    }

    .kpi[data-tone='critical'] :is(.kpi-label, .kpi-due, .kpi-tone, .kpi-glyph),
    .kpi[data-tone='overdue'] :is(.kpi-label, .kpi-due, .kpi-tone, .kpi-glyph) {
      color: var(--color-clay-700);
    }

    /* Overdue is the loudest state on the screen, so it is also the only one with a rule
       underneath it: a second, non-colour difference for anyone reading a washed-out projector. */
    .kpi[data-tone='overdue'] .kpi-due {
      text-decoration: underline;
      text-decoration-thickness: 2px;
      text-underline-offset: 0.15em;
    }
  `,
})
export class KpiClock {
  /** A frozen server instant, or `null`/absent — in which case nothing renders. */
  readonly dueAt = input<string | null | undefined>(null);
  /** Which clock this is, in words. The caller chooses it from the task's state. */
  readonly labelKey = input.required<string>();
  /** The instant the tone is judged against. Supplied, never read from a timer here. */
  readonly now = input.required<number>();
  /**
   * `false` once the task is decided: a finished case's due instant is history, and colouring
   * it red would report a breach that the KPI ledger, not this console, is the record of.
   */
  readonly live = input(true);

  protected readonly dueAtMs = computed<number | null>(() => {
    const parsed = Date.parse(this.dueAt() ?? '');
    return Number.isFinite(parsed) ? parsed : null;
  });

  protected readonly remainingMs = computed(() => (this.dueAtMs() ?? this.now()) - this.now());

  protected readonly tone = computed<KpiTone>(() => {
    if (this.dueAtMs() === null || !this.live()) return TONE_NORMAL;
    const remaining = this.remainingMs();
    if (remaining <= NO_TIME_LEFT) return TONE_OVERDUE;
    if (remaining <= APP_CONFIG.review.kpiCriticalMs) return TONE_CRITICAL;
    if (remaining <= APP_CONFIG.review.kpiWarnMs) return TONE_WARN;
    return TONE_NORMAL;
  });

  protected readonly warned = computed(() => this.tone() !== TONE_NORMAL);
  protected readonly overdue = computed(() => this.tone() === TONE_OVERDUE);
  protected readonly toneKey = computed(() => `officer.kpi.tone.${this.tone()}`);
}
