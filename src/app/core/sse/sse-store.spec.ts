import { TestBed } from '@angular/core/testing';
import { SSE_CLOSED, SSE_CONNECTING, SSE_OPEN, SSE_RETRYING, SseStore } from './sse-store';

function store(): SseStore {
  TestBed.configureTestingModule({});
  return TestBed.inject(SseStore);
}

describe('SseStore', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('starts closed', () => {
    const sse = store();
    expect(sse.connectionState()).toBe(SSE_CLOSED);
    expect(sse.isDegraded()).toBe(true);
    expect(sse.lastEventId()).toBeNull();
  });

  it('moves only between the four declared states', () => {
    const sse = store();
    sse.markConnecting();
    expect(sse.connectionState()).toBe(SSE_CONNECTING);
    sse.markOpen(1000);
    expect(sse.connectionState()).toBe(SSE_OPEN);
    expect(sse.isOpen()).toBe(true);
    sse.markRetrying(2, 4000);
    expect(sse.connectionState()).toBe(SSE_RETRYING);
    sse.markClosed();
    expect(sse.connectionState()).toBe(SSE_CLOSED);
  });

  it('resets the retry counter when a connection actually opens (WEB-FR-355)', () => {
    const sse = store();
    sse.markRetrying(3, 8000);
    expect(sse.retryAttempt()).toBe(3);
    expect(sse.nextRetryDelayMs()).toBe(8000);

    sse.markOpen(1000);
    expect(sse.retryAttempt()).toBe(0);
    expect(sse.nextRetryDelayMs()).toBeNull();
    expect(sse.lastEventAt()).toBe(1000);
  });

  it('stamps last-byte-seen from a heartbeat as readily as from an event', () => {
    const sse = store();
    sse.noteBytes(500);
    expect(sse.lastEventAt()).toBe(500);
  });

  it('counts unknown events without changing the connection state (WEB-FR-352)', () => {
    const sse = store();
    sse.markOpen();
    sse.noteUnknownEvent();
    sse.noteUnknownEvent();

    expect(sse.unknownEventCount()).toBe(2);
    expect(sse.connectionState()).toBe(SSE_OPEN);
  });

  it('bumps a monotonic resync tick (WEB-FR-358)', () => {
    const sse = store();
    sse.requestResync();
    sse.requestResync();
    expect(sse.resyncTick()).toBe(2);
  });

  it('drops the resume position and the counters on sign-out (WEB-SEC-004)', () => {
    const sse = store();
    sse.markOpen();
    sse.noteEventId('e-1');
    sse.noteUnknownEvent();

    sse.clearSession();

    expect(sse.connectionState()).toBe(SSE_CLOSED);
    expect(sse.lastEventId()).toBeNull();
    expect(sse.lastEventAt()).toBeNull();
    expect(sse.unknownEventCount()).toBe(0);
    expect(sse.retryAttempt()).toBe(0);
  });
});
