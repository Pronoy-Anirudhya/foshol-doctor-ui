import { TestBed } from '@angular/core/testing';
import { ErrorBus } from './error-bus';
import type { ProblemView } from './problem';

const view = (correlationId: string): ProblemView => ({
  status: 400,
  code: 'ERR_EXAMPLE',
  title: 'Bad Request',
  detail: null,
  correlationId,
  fieldErrors: [],
  rejectedImages: [],
  retryAfterSeconds: null,
  retryable: false,
  titleKey: 'errors.badRequest.title',
  detailKey: 'errors.badRequest.detail',
});

describe('ErrorBus', () => {
  let bus: ErrorBus;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    bus = TestBed.inject(ErrorBus);
  });

  it('starts empty', () => {
    expect(bus.lastProblem()).toBeNull();
  });

  it('holds the latest problem so one broken interaction shows one banner', () => {
    bus.report(view('first'));
    bus.report(view('second'));
    expect(bus.lastProblem()?.correlationId).toBe('second');
  });

  it('dismiss clears it', () => {
    bus.report(view('first'));
    bus.dismiss();
    expect(bus.lastProblem()).toBeNull();
  });
});
