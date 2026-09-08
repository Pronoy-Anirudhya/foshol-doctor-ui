import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { CaseStatus } from '../../../generated/models/case-status';

type StepState = 'done' | 'current' | 'upcoming';
type ConnectorState = 'done' | 'active' | 'idle';
type StepGlyph = 'check' | 'dot' | 'hollow' | 'cross' | 'warn';

interface Step {
  readonly key: string;
  /** `null` only on the outcome node while the case is still in flight. */
  readonly status: CaseStatus | null;
  readonly labelKey: string;
  readonly stateKey: string;
  readonly state: StepState;
  readonly connector: ConnectorState;
  readonly glyph: StepGlyph;
  readonly outcome: boolean;
}

/**
 * The four statuses a case moves through before a human decides anything. Typed against the
 * generated `CaseStatus` union (WEB-DATA-001) so a schema change breaks the build here rather
 * than showing a farmer a step that no longer exists.
 */
const PROGRESS_STATUSES: readonly CaseStatus[] = [
  'SUBMITTED',
  'ANALYSING',
  'ANALYSED',
  'IN_REVIEW',
];

/** The three ways a case ends. All terminal: nothing follows them (ADR-0012). */
const TERMINAL_STATUSES: readonly CaseStatus[] = ['ADVISED', 'REJECTED', 'FAILED'];

const OUTCOME_KEY = 'OUTCOME';

function outcomeGlyph(status: CaseStatus): StepGlyph {
  switch (status) {
    case 'ADVISED':
      return 'check';
    case 'REJECTED':
      return 'cross';
    default:
      return 'warn';
  }
}

function connectorFor(state: StepState, terminal: boolean): ConnectorState {
  if (state === 'done') return 'done';
  if (state === 'current') return terminal ? 'done' : 'active';
  return 'idle';
}

/**
 * WEB-FR-152 — the `CaseStatus` machine as a stepper:
 * `SUBMITTED → ANALYSING → ANALYSED → IN_REVIEW → ADVISED | REJECTED | FAILED`.
 *
 * The status is rendered exactly as the server sent it and the client invents no transition
 * (WEB-NFR-001): the final node shows a neutral "outcome" placeholder until a terminal status
 * actually arrives, because predicting which of the three it will be is precisely the human
 * decision this product exists to protect.
 *
 * The connector flowing INTO the current node shimmers — a `linear-gradient` moved by a
 * `background-position` keyframe, with no JavaScript and no timer (WEB-FR-356 forbids one
 * anyway). A terminal status stops it, because a case that has ended is not still working.
 */
@Component({
  selector: 'foshol-status-stepper',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  templateUrl: './status-stepper.html',
  styleUrl: './status-stepper.css',
  host: {
    class: 'block',
    '[attr.data-terminal]': 'isTerminal()',
    '[attr.data-status]': 'status()',
    'data-testid': 'status-stepper',
  },
})
export class StatusStepper {
  /** The server's `CaseStatus`, rendered as received (WEB-NFR-001). */
  readonly status = input.required<CaseStatus>();

  readonly isTerminal = computed(() => TERMINAL_STATUSES.includes(this.status()));

  readonly steps = computed<readonly Step[]>(() => {
    const current = this.status();
    const terminal = this.isTerminal();
    const currentIndex = PROGRESS_STATUSES.indexOf(current);

    const progress = PROGRESS_STATUSES.map((status, index): Step => {
      const state: StepState =
        terminal || index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'upcoming';
      return {
        key: status,
        status,
        labelKey: `badge.status.${status}`,
        stateKey: `badge.status.state.${state}`,
        state,
        connector: connectorFor(state, terminal),
        glyph: state === 'done' ? 'check' : state === 'current' ? 'dot' : 'hollow',
        outcome: false,
      };
    });

    const state: StepState = terminal ? 'current' : 'upcoming';
    const outcome: Step = {
      key: OUTCOME_KEY,
      status: terminal ? current : null,
      labelKey: terminal ? `badge.status.${current}` : 'badge.status.pending',
      stateKey: `badge.status.state.${state}`,
      state,
      connector: connectorFor(state, terminal),
      glyph: terminal ? outcomeGlyph(current) : 'hollow',
      outcome: true,
    };

    return [...progress, outcome];
  });
}
