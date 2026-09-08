import { Injectable, signal } from '@angular/core';
import type { ProblemView } from './problem';

/**
 * The one place a failure lands so that a banner, a toast or an error page can render it
 * (WEB-FR-005). Signals only — no RxJS subject standing in for state (WEB-NFR-002).
 *
 * The bus holds the LAST problem rather than a queue: a burst of failures during one broken
 * interaction is one thing gone wrong, and showing four stacked banners for it would be noise.
 * The problem interceptor still rethrows, so a caller that wants to handle its own failure
 * inline (a login form showing a wrong OTP) is never forced to read this.
 */
@Injectable({ providedIn: 'root' })
export class ErrorBus {
  private readonly _lastProblem = signal<ProblemView | null>(null);

  readonly lastProblem = this._lastProblem.asReadonly();

  report(problem: ProblemView): void {
    this._lastProblem.set(problem);
  }

  dismiss(): void {
    this._lastProblem.set(null);
  }
}
