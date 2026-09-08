import { TestBed } from '@angular/core/testing';
import type { Principal } from '../../generated/models/principal';
import { SessionStore } from '../auth/session-store';
import { APP_CONFIG } from '../config/app-config';
import { CaseStatusStore } from '../stores/case-status-store';
import { QueueStore } from '../stores/queue-store';
import { createFakeSseFetch, type FakeSseFetch } from '../../../testing/harness/fake-sse';
import { SseClient } from './sse-client';
import { SSE_CLOSED, SSE_OPEN, SSE_RETRYING, SseStore } from './sse-store';
import { SSE_FETCH, SSE_RANDOM } from './sse-tokens';

const FARMER: Principal = { id: 'farmer-1', name: 'Demo Farmer', role: 'FARMER' };
const TOKEN = 'header.payload.signature';

interface Harness {
  readonly fetcher: FakeSseFetch;
  readonly session: SessionStore;
  readonly store: SseStore;
  readonly client: SseClient;
}

function setup(): Harness {
  const fetcher = createFakeSseFetch();
  TestBed.configureTestingModule({
    providers: [
      { provide: SSE_FETCH, useValue: fetcher.fetch },
      // WEB-TEST-005 — 0.5 puts the jitter term at exactly zero, so delays are equalities.
      { provide: SSE_RANDOM, useValue: (): number => 0.5 },
    ],
  });

  const session = TestBed.inject(SessionStore);
  const store = TestBed.inject(SseStore);
  const client = TestBed.inject(SseClient);
  return { fetcher, session, store, client };
}

/**
 * Advance fake time, then drain the microtask queue that the stream machinery runs on. Fake
 * timers do not fake promises, so both have to be pumped for the loop to make progress.
 */
async function settle(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

async function signIn(h: Harness): Promise<void> {
  h.session.signIn(TOKEN, FARMER, new Date(Date.now() + APP_CONFIG.auth.jwtTtlMs));
  TestBed.tick();
  await settle();
}

const headersOf = (h: Harness, index: number): Record<string, string> =>
  h.fetcher.connections[index].init?.headers as Record<string, string>;

describe('SseClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('opens exactly one connection when the session becomes authenticated (WEB-FR-351)', async () => {
    const h = setup();
    expect(h.fetcher.connections).toHaveLength(0);

    await signIn(h);

    expect(h.fetcher.connections).toHaveLength(1);
    expect(h.store.connectionState()).toBe(SSE_OPEN);

    // A further effect run must not open a second stream.
    TestBed.tick();
    await settle();
    expect(h.fetcher.connections).toHaveLength(1);
  });

  it('carries the bearer in a header and never in the URL (AC-19, WEB-SEC-002)', async () => {
    const h = setup();
    await signIn(h);

    const connection = h.fetcher.connections[0];
    const headers = headersOf(h, 0);

    expect(connection.url).toBe(APP_CONFIG.api.origin + APP_CONFIG.api.streamPath);
    expect(connection.url).not.toContain(TOKEN);
    expect(headers['Authorization']).toBe(`Bearer ${TOKEN}`);
    expect(headers['Accept']).toBe('text/event-stream');
    // No id has been seen yet, so no resume header is sent.
    expect(headers['Last-Event-ID']).toBeUndefined();
  });

  it('applies a case-status frame with no additional request (AC-21, WEB-FR-353)', async () => {
    const h = setup();
    await signIn(h);
    const caseStatus = TestBed.inject(CaseStatusStore);

    h.fetcher.connections[0].sse.push(
      'event: case-status\nid: e-1\ndata: {"caseId":"c-1","fromStatus":"SUBMITTED","toStatus":"ANALYSING"}\n\n',
    );
    await settle();

    expect(caseStatus.statusOf('c-1')).toBe('ANALYSING');
    expect(h.store.lastEventId()).toBe('e-1');
    expect(h.fetcher.connections).toHaveLength(1);
  });

  it('ignores an unknown event name without disconnecting (WEB-FR-352)', async () => {
    const h = setup();
    await signIn(h);

    h.fetcher.connections[0].sse.push('event: nonsense-from-the-future\ndata: {}\n\n');
    await settle();

    expect(h.store.unknownEventCount()).toBe(1);
    expect(h.store.connectionState()).toBe(SSE_OPEN);
    expect(h.fetcher.connections).toHaveLength(1);
  });

  it('reconnects on the documented backoff schedule and resets after success (AC-20)', async () => {
    const h = setup();
    await signIn(h);

    // The open stream drops, then three reconnect attempts are refused outright, so the
    // exponential actually has room to climb.
    h.fetcher.connections[0].sse.fail();
    await settle();
    expect(h.store.connectionState()).toBe(SSE_RETRYING);
    expect(h.store.nextRetryDelayMs()).toBe(1000);

    for (const [waited, next] of [
      [1000, 2000],
      [2000, 4000],
      [4000, 8000],
    ]) {
      h.fetcher.failNextConnect();
      await settle(waited - 1);
      expect(h.store.nextRetryDelayMs()).toBe(waited);
      await settle(1);
      expect(h.store.nextRetryDelayMs()).toBe(next);
      expect(h.store.connectionState()).toBe(SSE_RETRYING);
    }

    // Let the next attempt succeed: WEB-FR-355's reset puts the schedule back to the start.
    await settle(8000);
    expect(h.store.connectionState()).toBe(SSE_OPEN);

    h.fetcher.connections[h.fetcher.connections.length - 1].sse.fail();
    await settle();
    expect(h.store.nextRetryDelayMs()).toBe(APP_CONFIG.sse.initialRetryMs);
  });

  it('resumes with Last-Event-ID and asks visible views to refetch after a gap (WEB-FR-358)', async () => {
    const h = setup();
    await signIn(h);
    const queue = TestBed.inject(QueueStore);
    const before = h.store.resyncTick();

    h.fetcher.connections[0].sse.push('event: queue\nid: e-7\ndata: {"caseId":"c-1","toStatus":"IN_REVIEW"}\n\n');
    await settle();

    h.fetcher.connections[0].sse.fail();
    await settle(APP_CONFIG.sse.initialRetryMs);

    expect(h.fetcher.connections).toHaveLength(2);
    expect(headersOf(h, 1)['Last-Event-ID']).toBe('e-7');
    expect(h.store.resyncTick()).toBeGreaterThan(before);
    expect(queue.needsReload()).toBe(true);
  });

  it('aborts and reconnects when no byte arrives within staleAfterMs', async () => {
    const h = setup();
    await signIn(h);

    // A heartbeat comment is a byte, and rearms the watchdog just as an event would.
    await settle(APP_CONFIG.sse.staleAfterMs - APP_CONFIG.sse.initialRetryMs);
    h.fetcher.connections[0].sse.push(': heartbeat\n');
    await settle(APP_CONFIG.sse.staleAfterMs - APP_CONFIG.sse.initialRetryMs);
    expect(h.fetcher.connections).toHaveLength(1);
    expect(h.store.connectionState()).toBe(SSE_OPEN);

    // Now go quiet for longer than the watchdog tolerates.
    await settle(APP_CONFIG.sse.staleAfterMs);
    await settle(APP_CONFIG.sse.initialRetryMs);

    expect(h.fetcher.connections.length).toBeGreaterThan(1);
  });

  it('clears the session and stops on 401 rather than looping', async () => {
    const h = setup();
    await signIn(h);

    h.fetcher.respondWithStatus(401);
    h.fetcher.connections[0].sse.fail();
    await settle(APP_CONFIG.sse.initialRetryMs);
    await settle();

    expect(h.session.isAuthenticated()).toBe(false);
    expect(h.store.connectionState()).toBe(SSE_CLOSED);

    const attempts = h.fetcher.connections.length;
    await settle(APP_CONFIG.sse.maxRetryMs * 2);
    expect(h.fetcher.connections).toHaveLength(attempts);
  });

  it('closes the stream and forgets the resume position on sign-out (WEB-SEC-004)', async () => {
    const h = setup();
    await signIn(h);
    h.fetcher.connections[0].sse.push(
      'event: case-status\nid: e-3\ndata: {"caseId":"c-1","toStatus":"ANALYSED"}\n\n',
    );
    await settle();
    expect(h.store.lastEventId()).toBe('e-3');

    h.session.clear();
    TestBed.tick();
    await settle();

    expect(h.store.connectionState()).toBe(SSE_CLOSED);
    expect(h.store.lastEventId()).toBeNull();

    const attempts = h.fetcher.connections.length;
    await settle(APP_CONFIG.sse.maxRetryMs * 2);
    expect(h.fetcher.connections).toHaveLength(attempts);
  });

  it('collapses a pending backoff when the browser comes back online', async () => {
    const h = setup();
    await signIn(h);

    h.fetcher.connections[0].sse.fail();
    await settle();
    expect(h.store.connectionState()).toBe(SSE_RETRYING);

    globalThis.dispatchEvent(new Event('online'));
    await settle();

    expect(h.fetcher.connections).toHaveLength(2);
    expect(h.store.connectionState()).toBe(SSE_OPEN);
  });
});
